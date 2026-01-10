#!/usr/bin/env python3
"""
SERVICO OMR - Versao Limpa
==========================

Servico Flask simples para leitura de gabaritos ENEM.
Porta: 5002

Autor: GabaritAI / X-TRI
"""

from flask import Flask, request, jsonify
from flask_cors import CORS
import cv2
import numpy as np
from PIL import Image
import io
import os
import time
import logging

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

app = Flask(__name__)
CORS(app)
app.config['MAX_CONTENT_LENGTH'] = 100 * 1024 * 1024  # 100MB


# ============================================================
# CONFIGURACAO DO TEMPLATE ENEM (90 questoes, 6 colunas x 15 linhas)
# ============================================================

# Dimensoes de referencia (A4 300dpi) - imagem completa
REF_WIDTH_FULL = 2481
REF_HEIGHT_FULL = 3509

# Dimensoes da area alinhada pelos marcadores
# Marcadores: TL(83,2306) TR(2396,2306) BL(83,3397) BR(2396,3397)
MARKER_TL = (83, 2306)
MARKER_BR = (2396, 3397)
REF_WIDTH = MARKER_BR[0] - MARKER_TL[0]   # 2313
REF_HEIGHT = MARKER_BR[1] - MARKER_TL[1]  # 1091

# Posicoes Y das linhas RELATIVAS aos marcadores (15 linhas)
# Original: [2432, 2492, ...] -> Subtrair MARKER_TL[1] (2306)
Y_POSITIONS = [126, 186, 246, 306, 366, 426, 486, 546, 606, 666, 726, 786, 846, 906, 966]

# Posicoes X das colunas RELATIVAS aos marcadores (6 colunas)
# Original: [180, 562, 946, 1328, 1714, 2096] -> Subtrair MARKER_TL[0] (83)
COLUMNS_X = [97, 479, 863, 1245, 1631, 2013]

# Espacamento entre opcoes A-B-C-D-E
OPTION_SPACING = 61

# Raio da bolha
BUBBLE_RADIUS = 19

# Thresholds (CALIBRADOS para gabaritos digitais/escaneados)
# METODO RELATIVO: compara bolhas entre si na mesma questao
MARKED_THRESHOLD = 50.0      # % escuro absoluto para considerar marcado
BLANK_THRESHOLD = 45.0       # Se a mais escura < 45%, questao em branco
RELATIVE_DIFF = 8.0          # Diferenca minima entre 1a e 2a para ser marcacao clara
DOUBLE_MARK_DIFF = 5.0       # Se diff < 5% entre 1a e 2a (ambas altas), dupla marcacao
DARK_PIXEL_THRESHOLD = 195   # Valor alto = mais tolerante a marcações leves (0-255, quanto maior mais tolerante)

# Flag para salvar imagens de debug
DEBUG_MODE = os.getenv('OMR_DEBUG', 'false').lower() == 'true'
DEBUG_OUTPUT_DIR = os.getenv('OMR_DEBUG_DIR', '/tmp/omr_debug')


# ============================================================
# FUNCOES DE PROCESSAMENTO
# ============================================================

def find_corner_markers(gray):
    """Encontra os 4 quadrados pretos de alinhamento."""
    h, w = gray.shape

    # MELHORIA: Usar binarizacao adaptativa (Otsu) em vez de threshold fixo
    # Isso funciona melhor com diferentes qualidades de scan e iluminacao
    _, binary = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)

    # Aplicar operacoes morfologicas para limpar ruido
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3))
    binary = cv2.morphologyEx(binary, cv2.MORPH_CLOSE, kernel)
    binary = cv2.morphologyEx(binary, cv2.MORPH_OPEN, kernel)

    # Encontrar contornos
    contours, _ = cv2.findContours(binary, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

    # Filtrar quadrados
    squares = []
    for cnt in contours:
        area = cv2.contourArea(cnt)
        if area < 800 or area > 80000:  # Ampliado range de area
            continue

        x, y, cw, ch = cv2.boundingRect(cnt)
        aspect = cw / ch if ch > 0 else 0

        # Quadrado tem aspect ratio ~1 (ampliado para scans rotacionados)
        if 0.5 < aspect < 2.0:
            peri = cv2.arcLength(cnt, True)
            approx = cv2.approxPolyDP(cnt, 0.05 * peri, True)  # Tolerancia aumentada

            if len(approx) >= 4:
                center_x = x + cw // 2
                center_y = y + ch // 2
                squares.append({
                    'center': (center_x, center_y),
                    'area': area,
                    'bbox': (x, y, cw, ch)
                })

    if len(squares) < 4:
        return None

    # Ordenar por área e pegar os maiores
    squares.sort(key=lambda s: s['area'], reverse=True)

    # Pegar os 4 maiores que formam um retângulo
    candidates = squares[:min(8, len(squares))]

    # Separar por posição (superior/inferior, esquerda/direita)
    top_left = None
    top_right = None
    bottom_left = None
    bottom_right = None

    for sq in candidates:
        cx, cy = sq['center']
        # Usar centroide relativo
        is_left = cx < w * 0.5
        is_top = cy < h * 0.8  # Os marcadores superiores estão em ~66% da altura

        if is_top and is_left and (top_left is None or sq['area'] > top_left['area']):
            top_left = sq
        elif is_top and not is_left and (top_right is None or sq['area'] > top_right['area']):
            top_right = sq
        elif not is_top and is_left and (bottom_left is None or sq['area'] > bottom_left['area']):
            bottom_left = sq
        elif not is_top and not is_left and (bottom_right is None or sq['area'] > bottom_right['area']):
            bottom_right = sq

    if not all([top_left, top_right, bottom_left, bottom_right]):
        return None

    return {
        'top_left': top_left['center'],
        'top_right': top_right['center'],
        'bottom_left': bottom_left['center'],
        'bottom_right': bottom_right['center']
    }


def align_to_markers(img):
    """Corrige perspectiva usando os 4 marcadores de canto."""
    if len(img.shape) == 3:
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    else:
        gray = img.copy()

    h, w = gray.shape

    # Encontrar marcadores
    markers = find_corner_markers(gray)

    if markers is None:
        logger.warning("Marcadores não encontrados, usando imagem original")
        return img

    # Pontos fonte (onde os marcadores estão na imagem escaneada)
    src_points = np.float32([
        markers['top_left'],
        markers['top_right'],
        markers['bottom_left'],
        markers['bottom_right']
    ])

    # Pontos destino (onde os marcadores DEVEM estar - posições de referência)
    # Baseado no template: TL(83,2306) TR(2396,2306) BL(83,3397) BR(2396,3397)
    # Vamos mapear para uma imagem de tamanho fixo da área das bolhas
    dst_width = 2313  # 2396 - 83
    dst_height = 1091  # 3397 - 2306

    dst_points = np.float32([
        [0, 0],
        [dst_width, 0],
        [0, dst_height],
        [dst_width, dst_height]
    ])

    # Calcular matriz de transformação de perspectiva
    M = cv2.getPerspectiveTransform(src_points, dst_points)

    # Aplicar transformação
    aligned = cv2.warpPerspective(img, M, (dst_width, dst_height),
                                  flags=cv2.INTER_LINEAR,
                                  borderMode=cv2.BORDER_REPLICATE)

    logger.debug(f"Alinhamento por marcadores realizado")
    return aligned, True  # Retorna flag indicando que foi alinhado


def deskew_image(img):
    """Tenta alinhar por marcadores, senão usa método de linhas."""
    # Primeiro, tentar alinhar usando os 4 marcadores
    result = align_to_markers(img)

    if isinstance(result, tuple):
        return result[0]  # Imagem alinhada

    # Fallback: usar detecção de linhas para rotação simples
    if len(img.shape) == 3:
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    else:
        gray = img.copy()

    edges = cv2.Canny(gray, 50, 150, apertureSize=3)
    lines = cv2.HoughLinesP(edges, 1, np.pi/180, threshold=100,
                           minLineLength=200, maxLineGap=10)

    if lines is None or len(lines) < 5:
        return img

    angles = []
    for line in lines:
        x1, y1, x2, y2 = line[0]
        if x2 - x1 == 0:
            continue
        angle = np.arctan2(y2 - y1, x2 - x1) * 180 / np.pi
        if -15 < angle < 15:
            angles.append(angle)
        elif 75 < abs(angle) < 105:
            angles.append(angle - 90 if angle > 0 else angle + 90)

    if not angles:
        return img

    median_angle = np.median(angles)
    if abs(median_angle) < 0.3:
        return img

    median_angle = np.clip(median_angle, -10, 10)
    h, w = img.shape[:2]
    center = (w // 2, h // 2)
    M = cv2.getRotationMatrix2D(center, median_angle, 1.0)

    cos, sin = np.abs(M[0, 0]), np.abs(M[0, 1])
    new_w, new_h = int(h * sin + w * cos), int(h * cos + w * sin)
    M[0, 2] += (new_w - w) / 2
    M[1, 2] += (new_h - h) / 2

    return cv2.warpAffine(img, M, (new_w, new_h),
                         flags=cv2.INTER_LINEAR,
                         borderMode=cv2.BORDER_REPLICATE)


def preprocess_image(gray):
    """Pre-processamento com CLAHE e gamma."""
    # CLAHE para contraste adaptativo
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    enhanced = clahe.apply(gray)

    # Ajuste gamma
    gamma = 1.2
    table = np.array([((i / 255.0) ** (1.0 / gamma)) * 255 for i in np.arange(256)]).astype("uint8")
    corrected = cv2.LUT(enhanced, table)

    return corrected


def analyze_bubble(gray, x, y, scale_x, scale_y):
    """Analisa uma bolha e retorna porcentagem de escuridao."""
    h, w = gray.shape
    r = int(BUBBLE_RADIUS * scale_x * 1.3)  # Raio expandido

    x1 = max(0, x - r)
    x2 = min(w, x + r)
    y1 = max(0, y - r)
    y2 = min(h, y + r)

    roi = gray[y1:y2, x1:x2]

    if roi.size == 0:
        return 0.0

    dark_pixels = np.sum(roi < DARK_PIXEL_THRESHOLD)
    darkness = (dark_pixels / roi.size) * 100.0

    return darkness


def analyze_bubble_with_search(gray, x, y, scale_x, scale_y):
    """Analisa uma bolha com busca 2D e foco no CENTRO para tolerar marcações incompletas."""
    h, w = gray.shape
    r_full = int(BUBBLE_RADIUS * scale_x * 1.3)  # Raio completo para busca
    r_center = int(BUBBLE_RADIUS * scale_x * 0.7)  # Raio interno (60%) para análise

    # Busca ampliada: 20px base, step 4 para mais granularidade
    search_range_y = int(20 * scale_y)
    search_range_x = int(10 * scale_x)  # Busca horizontal menor

    best_darkness = 0.0

    # Busca 2D: vertical E horizontal para compensar desalinhamentos
    for dy in range(-search_range_y, search_range_y + 1, 4):
        for dx in range(-search_range_x, search_range_x + 1, 4):
            test_y = y + dy
            test_x = x + dx

            if test_y - r_full < 0 or test_y + r_full >= h:
                continue
            if test_x - r_full < 0 or test_x + r_full >= w:
                continue

            # ANÁLISE CENTRO-PONDERADA: Focar no núcleo interno da bolha
            # Isso tolera marcações incompletas onde o aluno não preencheu totalmente
            x1 = max(0, test_x - r_center)
            x2 = min(w, test_x + r_center)
            y1 = max(0, test_y - r_center)
            y2 = min(h, test_y + r_center)

            roi = gray[y1:y2, x1:x2]
            if roi.size == 0:
                continue

            dark_pixels = np.sum(roi < DARK_PIXEL_THRESHOLD)
            darkness = (dark_pixels / roi.size) * 100.0

            if darkness > best_darkness:
                best_darkness = darkness

    return best_darkness


def read_question(gray, q_num, col_x, row_y, scale_x, scale_y):
    """Le uma questao e retorna a resposta usando metodo HIBRIDO (relativo + absoluto)."""
    options = []

    for opt_idx in range(5):
        x = int((col_x + opt_idx * OPTION_SPACING) * scale_x)
        y = int(row_y * scale_y)
        # Usar busca local para compensar desalinhamentos em scans
        darkness = analyze_bubble_with_search(gray, x, y, scale_x, scale_y)
        options.append({
            'label': chr(65 + opt_idx),  # A, B, C, D, E
            'darkness': darkness
        })

    # Ordenar por escuridao (maior primeiro)
    sorted_opts = sorted(options, key=lambda x: x['darkness'], reverse=True)
    best = sorted_opts[0]
    second = sorted_opts[1]

    # Calcular estatísticas
    darknesses = [o['darkness'] for o in options]
    mean_dark = np.mean(darknesses)
    std_dark = np.std(darknesses)
    diff = best['darkness'] - second['darkness']

    # METODO HIBRIDO: combina criterios relativos e absolutos
    # Valores de referencia template vazio: mean=37%, std=1.0, diff=0.5-1.0

    # 1. QUESTAO EM BRANCO
    #    - Se std baixo (<1.2) E diff baixo (<1.2), ninguem marcou
    #    - Template vazio tem std~1.0 e diff~0.5-1.0
    #    AJUSTE: Thresholds mais baixos para evitar falsos "em branco"
    if std_dark < 1.2 and diff < 1.2:
        return None

    # 2. DUPLA MARCACAO
    #    - Duas bolhas bem acima da media E diferenca pequena
    if std_dark > 3.0:
        z_best = (best['darkness'] - mean_dark) / std_dark
        z_second = (second['darkness'] - mean_dark) / std_dark
        if z_best > 1.0 and z_second > 1.0 and diff < 2.0:
            return 'X'

    # 3. MARCACAO CLARA (criterio principal)
    #    - Diferenca significativa entre 1a e 2a (>= 1.5)
    #    AJUSTE: Mais permissivo para marcas leves
    if diff >= 1.5:
        return best['label']

    # 3.5. MARCACAO MODERADA (threshold intermediário)
    #    - Diferenca moderada (>= 1.2) E bolha escura o suficiente (> 35%)
    #    - Pega marcas leves que caem no "buraco" entre critérios
    if diff >= 1.2 and best['darkness'] > 35.0:
        return best['label']

    # 4. MARCACAO POR Z-SCORE (para variacao alta)
    #    - A melhor esta muito acima da media (outlier)
    #    AJUSTE: Criterios mais sensíveis
    if std_dark >= 1.2:
        z_score_best = (best['darkness'] - mean_dark) / std_dark
        if z_score_best > 1.0 and diff >= 1.2:
            return best['label']

    # 5. FALLBACK: Se a melhor bolha esta significativamente mais escura que a media
    #    AJUSTE: Mais sensível para marcas muito leves
    if best['darkness'] > mean_dark + 2.5 and diff >= 0.8:
        return best['label']

    return None


def save_debug_image(img, gray, answers, scale_x, scale_y, page_num=1):
    """Salva imagem de debug com marcacoes visuais para diagnostico."""
    if not DEBUG_MODE:
        return None

    try:
        os.makedirs(DEBUG_OUTPUT_DIR, exist_ok=True)

        # Criar copia colorida para desenhar
        if len(img.shape) == 2:
            debug_img = cv2.cvtColor(img, cv2.COLOR_GRAY2BGR)
        else:
            debug_img = img.copy()

        # Desenhar posicoes das bolhas
        for col_idx, col_x in enumerate(COLUMNS_X):
            for row_idx, row_y in enumerate(Y_POSITIONS):
                q_num = col_idx * 15 + row_idx + 1
                answer = answers[q_num - 1] if q_num <= len(answers) else None

                for opt_idx in range(5):
                    x = int((col_x + opt_idx * OPTION_SPACING) * scale_x)
                    y = int(row_y * scale_y)
                    r = int(BUBBLE_RADIUS * scale_x)

                    opt_label = chr(65 + opt_idx)

                    # Verde = resposta detectada, Vermelho = nao marcada, Amarelo = dupla
                    if answer == opt_label:
                        color = (0, 255, 0)  # Verde
                        thickness = 3
                    elif answer == 'X':
                        color = (0, 255, 255)  # Amarelo
                        thickness = 2
                    else:
                        color = (0, 0, 255)  # Vermelho
                        thickness = 1

                    cv2.circle(debug_img, (x, y), r, color, thickness)

                # Numero da questao
                x_text = int((col_x - 30) * scale_x)
                y_text = int(row_y * scale_y) + 5
                cv2.putText(debug_img, str(q_num), (x_text, y_text),
                           cv2.FONT_HERSHEY_SIMPLEX, 0.4, (255, 0, 0), 1)

        # Salvar
        timestamp = int(time.time() * 1000)
        filename = f"debug_page{page_num}_{timestamp}.png"
        filepath = os.path.join(DEBUG_OUTPUT_DIR, filename)
        cv2.imwrite(filepath, debug_img)
        logger.info(f"Debug image saved: {filepath}")
        return filepath
    except Exception as e:
        logger.warning(f"Failed to save debug image: {e}")
        return None


def process_omr(img, page_num=1):
    """Processa uma imagem e retorna as respostas."""
    start_time = time.time()

    # 1. Corrigir rotação/inclinação (deskew)
    original_shape = img.shape[:2]
    deskew_result = deskew_image(img)

    # Verificar se alinhamento foi bem-sucedido
    if isinstance(deskew_result, tuple):
        img = deskew_result[0]
        aligned_by_markers = True
    else:
        img = deskew_result
        aligned_by_markers = False

    new_shape = img.shape[:2]

    # Log detalhado do alinhamento
    if aligned_by_markers:
        logger.info(f"✅ Alinhamento SUCESSO: {original_shape} -> {new_shape} (marcadores detectados)")
    else:
        logger.warning(f"⚠️ Alinhamento FALLBACK: {original_shape} -> {new_shape} (marcadores NÃO encontrados)")

    # 2. Converter para grayscale
    if len(img.shape) == 3:
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    else:
        gray = img.copy()

    h, w = gray.shape
    scale_x = w / REF_WIDTH
    scale_y = h / REF_HEIGHT

    # Validar se as dimensões estão próximas do esperado
    expected_ratio = REF_WIDTH / REF_HEIGHT  # ~2.12
    actual_ratio = w / h
    ratio_diff = abs(expected_ratio - actual_ratio) / expected_ratio * 100

    if ratio_diff > 20:
        logger.warning(f"⚠️ Proporção da imagem diverge {ratio_diff:.1f}% do esperado (escala x={scale_x:.2f}, y={scale_y:.2f})")

    # 3. Pre-processar (CLAHE + gamma)
    processed = preprocess_image(gray)

    # Ler todas as questoes
    answers = []
    for col_idx, col_x in enumerate(COLUMNS_X):
        for row_idx, row_y in enumerate(Y_POSITIONS):
            q_num = col_idx * 15 + row_idx + 1
            answer = read_question(processed, q_num, col_x, row_y, scale_x, scale_y)
            answers.append(answer)

    # Estatisticas
    answered = sum(1 for a in answers if a and a != 'X')
    blank = sum(1 for a in answers if a is None)
    double_marked = sum(1 for a in answers if a == 'X')

    elapsed = time.time() - start_time

    # Salvar imagem de debug se habilitado
    debug_path = save_debug_image(img, processed, answers, scale_x, scale_y, page_num)

    return {
        'answers': answers,
        'answered': answered,
        'blank': blank,
        'double_marked': double_marked,
        'elapsed_ms': round(elapsed * 1000, 2),
        'debug_image': debug_path
    }


# ============================================================
# ENDPOINTS DA API
# ============================================================

@app.route('/health', methods=['GET'])
def health():
    """Health check."""
    return jsonify({
        "status": "ok",
        "service": "omr-service",
        "version": "1.0",
        "questions": 90
    })


@app.route('/api/process-image', methods=['POST'])
def process_image():
    """Processa uma imagem de gabarito."""
    try:
        # Verificar se tem arquivo
        if 'image' not in request.files:
            logger.error("Campo 'image' nao encontrado nos arquivos")
            return jsonify({"status": "erro", "mensagem": "Arquivo 'image' nao fornecido"}), 400

        img_file = request.files['image']
        img_bytes = img_file.read()

        if len(img_bytes) == 0:
            logger.error("Arquivo vazio recebido")
            return jsonify({"status": "erro", "mensagem": "Arquivo vazio"}), 400

        # Abrir imagem
        pil_img = Image.open(io.BytesIO(img_bytes))

        if pil_img.mode != 'RGB':
            pil_img = pil_img.convert('RGB')

        # Converter para OpenCV (BGR)
        img_array = np.array(pil_img)[:, :, ::-1].copy()

        # Numero da pagina
        page_num = int(request.form.get('page', 1))

        # Processar OMR
        result = process_omr(img_array, page_num)

        logger.info(f"Pagina {page_num}: {result['answered']}/90 respondidas | {result['blank']} branco | {result['double_marked']} dupla | {result['elapsed_ms']}ms")

        # Formatar resposta
        questoes = []
        for i, ans in enumerate(result['answers'], 1):
            if ans is None:
                questoes.append({'numero': i, 'resposta': ''})
            elif ans == 'X':
                questoes.append({'numero': i, 'resposta': 'X', 'invalida': True, 'motivo': 'Dupla marcacao'})
            else:
                questoes.append({'numero': i, 'resposta': ans})

        return jsonify({
            "status": "sucesso",
            "pagina": {
                "pagina": page_num,
                "resultado": {
                    "questoes": questoes,
                    "respondidas": result['answered'],
                    "em_branco": result['blank'],
                    "dupla_marcacao": result['double_marked']
                },
                "elapsed_ms": result['elapsed_ms']
            }
        })

    except Exception as e:
        logger.error(f"Erro no processamento: {e}", exc_info=True)
        return jsonify({"status": "erro", "mensagem": str(e)}), 500


# ============================================================
# MAIN
# ============================================================

if __name__ == '__main__':
    port = int(os.getenv('PORT', 5002))

    print("=" * 60)
    print("OMR SERVICE - Versao Limpa")
    print("=" * 60)
    print(f"  Porta: {port}")
    print(f"  Questoes: 90 (6 colunas x 15 linhas)")
    print(f"  Threshold marcado: {MARKED_THRESHOLD}%")
    print(f"  Threshold branco: {BLANK_THRESHOLD}%")
    print("=" * 60)

    app.run(host='0.0.0.0', port=port, debug=False)
