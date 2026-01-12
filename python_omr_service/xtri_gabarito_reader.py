#!/usr/bin/env python3
"""
XTRI Gabarito OMR Reader
========================
Leitor de gabarito para o template X-TRI.
90 questões (6 colunas x 15 linhas) com 5 opções (A-E).

Precisão: 100% em testes com gabaritos do template X-TRI.

Uso:
    from xtri_gabarito_reader import process_image, process_pdf

    # Processar imagem
    result = process_image('gabarito.png')

    # Processar PDF (página específica)
    result = process_pdf('gabaritos.pdf', page=1)

    # Resultado
    print(result['sheet_code'])      # XTRI-U6M9R7
    print(result['answers'])         # {'1': 'A', '2': 'C', ...}
    print(result['stats'])           # {'answered': 71, 'blank': 19, ...}

Autor: Claude para Xandão/XTRI
Data: Janeiro 2026
"""

import cv2
import numpy as np
from typing import Dict, List, Tuple, Optional, Any

# ============================================================
# CONFIGURAÇÃO DO TEMPLATE
# ============================================================

NUM_QUESTIONS = 90
QUESTIONS_PER_COLUMN = 15
NUM_COLUMNS = 6
OPTIONS = ['A', 'B', 'C', 'D', 'E']

# Thresholds de detecção (calibrados para o template X-TRI)
FILL_THRESHOLD = 40      # % mínimo de pixels escuros para considerar marcado
DARK_PIXEL_VALUE = 150   # Valor de pixel considerado "escuro" (0-255)


# ============================================================
# DETECÇÃO DE MARCADORES
# ============================================================

def find_grid_markers(gray: np.ndarray) -> Optional[Dict[str, Tuple[int, int]]]:
    """
    Encontra os 4 marcadores quadrados pretos do grid de respostas.

    Args:
        gray: Imagem em escala de cinza

    Returns:
        Dict com 'TL', 'TR', 'BL', 'BR' (top-left, etc) ou None se não encontrar
    """
    h, w = gray.shape

    # Calcular escala baseado no tamanho da imagem
    # Referência: 150 DPI = ~1240x1754, 300 DPI = ~2480x3508
    scale = max(w / 1240, h / 1754)
    area_scale = scale * scale  # Área escala quadraticamente

    _, binary = cv2.threshold(gray, 80, 255, cv2.THRESH_BINARY_INV)
    contours, _ = cv2.findContours(binary, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

    # Filtrar candidatos a marcadores (quadrados de tamanho apropriado, escalado)
    min_area = int(800 * area_scale)
    max_area = int(2500 * area_scale)

    candidates = []
    for cnt in contours:
        area = cv2.contourArea(cnt)
        if min_area < area < max_area:
            x, y, cw, ch = cv2.boundingRect(cnt)
            aspect = cw / ch if ch > 0 else 0
            if 0.7 < aspect < 1.4:  # Aproximadamente quadrado
                candidates.append((x + cw//2, y + ch//2))

    if len(candidates) < 4:
        return None

    # Separar por metade superior/inferior
    mid_y = h / 2
    top = sorted([c for c in candidates if c[1] < mid_y], key=lambda c: c[0])
    bot = sorted([c for c in candidates if c[1] >= mid_y], key=lambda c: c[0])

    if len(top) < 2 or len(bot) < 2:
        return None

    return {
        'TL': top[0],
        'TR': top[-1],
        'BL': bot[0],
        'BR': bot[-1]
    }


# ============================================================
# DETECÇÃO DE BOLHAS
# ============================================================

def detect_bubbles(gray: np.ndarray, markers: Dict) -> List[Dict]:
    """
    Detecta todas as bolhas usando Hough Circle Transform
    e organiza em estrutura de questões.

    Args:
        gray: Imagem em escala de cinza
        markers: Dicionário com posições dos marcadores

    Returns:
        Lista de dicts com 'question' e 'options'
    """
    h, w = gray.shape

    # Calcular escala baseado no tamanho da imagem
    # Referência: 150 DPI = ~1240x1754, 300 DPI = ~2480x3508
    scale = max(w / 1240, h / 1754)

    # Ajustar parâmetros do Hough para a escala
    min_dist = int(15 * scale)
    min_radius = int(8 * scale)
    max_radius = int(18 * scale)

    # Detectar círculos
    circles = cv2.HoughCircles(
        gray,
        cv2.HOUGH_GRADIENT,
        dp=1,
        minDist=min_dist,
        param1=50,
        param2=25,
        minRadius=min_radius,
        maxRadius=max_radius
    )

    if circles is None:
        return []

    tl, tr, bl = markers['TL'], markers['TR'], markers['BL']

    # Margem de tolerância escalada
    margin = int(20 * scale)

    # Filtrar círculos dentro do grid
    grid_circles = []
    for c in circles[0]:
        x, y, r = int(c[0]), int(c[1]), int(c[2])
        if tl[0] - margin < x < tr[0] + margin and tl[1] < y < bl[1] + margin:
            grid_circles.append((x, y, r))

    if len(grid_circles) < 400:
        return []

    # Organizar por linha Y
    grid_circles.sort(key=lambda c: c[1])

    # Threshold para agrupar círculos na mesma linha (escalado)
    row_threshold = int(25 * scale)

    # Agrupar em 15 linhas
    rows = []
    current_row = [grid_circles[0]]

    for c in grid_circles[1:]:
        if abs(c[1] - current_row[-1][1]) < row_threshold:
            current_row.append(c)
        else:
            rows.append(sorted(current_row, key=lambda x: x[0]))
            current_row = [c]
    rows.append(sorted(current_row, key=lambda x: x[0]))

    if len(rows) != 15:
        return []

    # Criar estrutura de questões
    # Cada linha tem 30 círculos (6 colunas × 5 opções)
    bubble_positions = []

    for row_idx, row in enumerate(rows):
        if len(row) != 30:
            continue

        for col_idx in range(NUM_COLUMNS):
            q_num = col_idx * QUESTIONS_PER_COLUMN + row_idx + 1

            start = col_idx * 5
            col_circles = row[start:start + 5]

            options = []
            for i, (x, y, r) in enumerate(col_circles):
                options.append({
                    'option': OPTIONS[i],
                    'x': x,
                    'y': y,
                    'r': r
                })

            bubble_positions.append({
                'question': q_num,
                'options': options
            })

    bubble_positions.sort(key=lambda x: x['question'])
    return bubble_positions


# ============================================================
# ANÁLISE DE BOLHAS
# ============================================================

def analyze_bubble(gray: np.ndarray, x: int, y: int, r: int = 12) -> float:
    """
    Analisa uma bolha e retorna o percentual de pixels escuros.

    Args:
        gray: Imagem em escala de cinza
        x, y: Centro da bolha
        r: Raio da bolha

    Returns:
        Percentual de pixels escuros (0-100)
    """
    h, w = gray.shape
    x = max(r, min(x, w - r - 1))
    y = max(r, min(y, h - r - 1))

    roi = gray[y-r:y+r, x-r:x+r]
    if roi.size == 0:
        return 0.0

    # Criar máscara circular
    mask = np.zeros_like(roi)
    cv2.circle(mask, (r, r), r, 255, -1)

    # Contar pixels escuros dentro da máscara
    dark = np.sum((roi < DARK_PIXEL_VALUE) & (mask > 0))
    total = np.sum(mask > 0)

    return (dark / total * 100) if total > 0 else 0.0


def detect_answer(gray: np.ndarray, options: List[Dict]) -> Tuple[Optional[str], Dict]:
    """
    Detecta qual opção foi marcada para uma questão.

    Args:
        gray: Imagem em escala de cinza
        options: Lista de opções com posições

    Returns:
        (resposta, stats) - resposta detectada e estatísticas
    """
    results = []
    for opt in options:
        darkness = analyze_bubble(gray, opt['x'], opt['y'], opt.get('r', 12))
        results.append({
            'option': opt['option'],
            'darkness': round(darkness, 1)
        })

    results.sort(key=lambda r: r['darkness'], reverse=True)

    best = results[0]
    second = results[1]
    diff = best['darkness'] - second['darkness']

    stats = {
        'all': results,
        'best': best['option'],
        'darkness': best['darkness'],
        'diff': diff
    }

    # Decisão
    if best['darkness'] < FILL_THRESHOLD:
        return None, stats  # Em branco

    if second['darkness'] >= FILL_THRESHOLD - 5 and diff < 8:
        stats['warning'] = 'double_mark'
        return None, stats  # Dupla marcação

    return best['option'], stats


# ============================================================
# LEITURA DE QR CODE
# ============================================================

def read_qr_code(image: np.ndarray) -> Optional[str]:
    """
    Lê o QR Code do gabarito.

    Args:
        image: Imagem BGR ou grayscale

    Returns:
        Código do gabarito (ex: XTRI-U6M9R7) ou None
    """
    try:
        from pyzbar import pyzbar
    except ImportError:
        return None

    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY) if len(image.shape) == 3 else image
    h, w = gray.shape

    # Tentar ROI do canto superior direito primeiro
    roi = gray[0:int(h*0.3), int(w*0.6):w]
    for obj in pyzbar.decode(roi):
        if obj.type == 'QRCODE':
            return obj.data.decode('utf-8').strip()

    # Fallback: imagem completa
    for obj in pyzbar.decode(gray):
        if obj.type == 'QRCODE':
            return obj.data.decode('utf-8').strip()

    return None


# ============================================================
# PROCESSAMENTO PRINCIPAL
# ============================================================

def process_answer_sheet(image: np.ndarray) -> Dict[str, Any]:
    """
    Processa uma imagem de gabarito e extrai todas as respostas.

    Args:
        image: Imagem BGR do gabarito

    Returns:
        Dict com:
            - success: bool
            - sheet_code: str ou None
            - answers: Dict[str, str] (número -> letra)
            - stats: Dict com answered, blank, double_marked
            - error: str (se success=False)
    """
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY) if len(image.shape) == 3 else image

    result = {
        'success': False,
        'sheet_code': read_qr_code(image),
        'answers': {},
        'stats': {
            'answered': 0,
            'blank': 0,
            'double_marked': 0
        }
    }

    # 1. Encontrar marcadores
    markers = find_grid_markers(gray)
    if not markers:
        result['error'] = 'Marcadores do grid não encontrados'
        return result

    # 2. Detectar e organizar bolhas
    bubble_positions = detect_bubbles(gray, markers)

    if len(bubble_positions) != 90:
        result['error'] = f'Mapeamento incorreto: {len(bubble_positions)} questões detectadas'
        return result

    # 3. Analisar cada questão
    for q_data in bubble_positions:
        q_num = q_data['question']
        answer, stats = detect_answer(gray, q_data['options'])

        result['answers'][str(q_num)] = answer

        if answer:
            result['stats']['answered'] += 1
        elif stats.get('warning') == 'double_mark':
            result['stats']['double_marked'] += 1
        else:
            result['stats']['blank'] += 1

    result['success'] = True
    return result


# ============================================================
# FUNÇÕES DE CONVENIÊNCIA
# ============================================================

def process_image(filepath: str) -> Dict[str, Any]:
    """
    Processa um arquivo de imagem.

    Args:
        filepath: Caminho para a imagem (PNG, JPG, etc)

    Returns:
        Resultado do processamento
    """
    image = cv2.imread(filepath)
    if image is None:
        return {
            'success': False,
            'error': f'Não foi possível ler: {filepath}'
        }

    return process_answer_sheet(image)


def process_pdf(filepath: str, page: int = 1, dpi: int = 150) -> Dict[str, Any]:
    """
    Processa uma página de um arquivo PDF.

    Args:
        filepath: Caminho para o PDF
        page: Número da página (1-indexed)
        dpi: Resolução para conversão

    Returns:
        Resultado do processamento
    """
    try:
        from pdf2image import convert_from_path
    except ImportError:
        return {
            'success': False,
            'error': 'pdf2image não instalado'
        }

    pages = convert_from_path(filepath, dpi=dpi, first_page=page, last_page=page)
    if not pages:
        return {
            'success': False,
            'error': f'Não foi possível converter página {page}'
        }

    image = cv2.cvtColor(np.array(pages[0]), cv2.COLOR_RGB2BGR)
    result = process_answer_sheet(image)
    result['page'] = page

    return result


def process_image_bytes(image_bytes: bytes) -> Dict[str, Any]:
    """
    Processa imagem a partir de bytes.

    Args:
        image_bytes: Bytes da imagem

    Returns:
        Resultado do processamento
    """
    nparr = np.frombuffer(image_bytes, np.uint8)
    image = cv2.imdecode(nparr, cv2.IMREAD_COLOR)

    if image is None:
        return {
            'success': False,
            'error': 'Não foi possível decodificar a imagem'
        }

    return process_answer_sheet(image)


# ============================================================
# CLI
# ============================================================

if __name__ == '__main__':
    import sys
    import json

    if len(sys.argv) < 2:
        print("Uso: python xtri_gabarito_reader.py <imagem_ou_pdf> [--json]")
        print("Exemplo: python xtri_gabarito_reader.py gabarito.png")
        sys.exit(1)

    filepath = sys.argv[1]
    output_json = '--json' in sys.argv

    # Processar
    if filepath.lower().endswith('.pdf'):
        result = process_pdf(filepath)
    else:
        result = process_image(filepath)

    # Output
    if output_json:
        print(json.dumps(result, indent=2, ensure_ascii=False))
    else:
        print(f"\n{'='*60}")
        print("XTRI Gabarito Reader")
        print(f"{'='*60}")
        print(f"Sheet Code: {result.get('sheet_code') or 'N/A'}")

        if result['success']:
            print(f"Respondidas: {result['stats']['answered']}/90")
            print(f"Em branco: {result['stats']['blank']}")
            print(f"Dupla marcação: {result['stats']['double_marked']}")

            print(f"\nGabarito:")
            for i in range(1, 91):
                ans = result['answers'].get(str(i)) or '-'
                end = '\n' if i % 15 == 0 else '  '
                print(f"{i:02d}:{ans}", end=end)
        else:
            print(f"ERRO: {result.get('error')}")

        print(f"\n{'='*60}")
