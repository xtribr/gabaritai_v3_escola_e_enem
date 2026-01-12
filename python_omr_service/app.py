#!/usr/bin/env python3
"""
SERVICO OMR - Versao Limpa
==========================

Servico Flask simples para leitura de gabaritos ENEM.
Porta: 5002

Autor: GabaritAI / X-TRI
"""

from flask import Flask, request, jsonify, send_file
from flask_cors import CORS
import cv2
import numpy as np
from PIL import Image
from pyzbar import pyzbar
import io
import os
import re
import time
import logging
import csv
import random
import string
import tempfile
from typing import Optional, Dict, Any, List
from datetime import datetime

# Importar módulo QR (usa funções do qr_reader_module.py se disponível)
try:
    from qr_reader_module import read_qr_with_fallback, validate_sheet_code as validate_qr
    USE_QR_MODULE = True
except ImportError:
    USE_QR_MODULE = False

# Importar novo leitor OMR com detecção Hough (100% precisão)
try:
    from xtri_gabarito_reader import process_answer_sheet as hough_process_omr
    USE_HOUGH_OMR = True
except ImportError:
    USE_HOUGH_OMR = False

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

app = Flask(__name__)
CORS(app)
app.config['MAX_CONTENT_LENGTH'] = 100 * 1024 * 1024  # 100MB

# ============================================================
# SUPABASE CLIENT
# ============================================================
SUPABASE_URL = os.getenv('SUPABASE_URL')
SUPABASE_KEY = os.getenv('SUPABASE_SERVICE_KEY')

supabase_client = None

def get_supabase():
    """Retorna cliente Supabase (lazy initialization)."""
    global supabase_client
    if supabase_client is None and SUPABASE_URL and SUPABASE_KEY:
        try:
            from supabase import create_client
            supabase_client = create_client(SUPABASE_URL, SUPABASE_KEY)
            logger.info("Supabase client initialized")
        except Exception as e:
            logger.warning(f"Failed to initialize Supabase: {e}")
    return supabase_client


def lookup_student_by_sheet_code(sheet_code: str) -> Optional[Dict[str, Any]]:
    """
    Busca dados do aluno pelo sheet_code no Supabase.

    Ordem de busca:
    1. Tabela 'students' (alunos importados via CSV com sheet_code)
    2. Tabela 'answer_sheet_students' (sistema de batches com QR pré-cadastrado)
    """
    client = get_supabase()
    if not client:
        logger.warning("Supabase not configured, skipping student lookup")
        return None

    try:
        # 1. Buscar na tabela 'students' (novo fluxo - alunos com sheet_code)
        response = client.table('students') \
            .select('id, name, matricula, turma, school_id, schools(name)') \
            .eq('sheet_code', sheet_code) \
            .single() \
            .execute()

        if response.data:
            data = response.data
            school = data.get('schools', {}) or {}
            logger.info(f"Student found in 'students' table: {data.get('name')}")
            return {
                'id': data['id'],
                'student_name': data['name'],
                'enrollment': data.get('matricula'),
                'class_name': data.get('turma'),
                'school_id': data.get('school_id'),
                'school_name': school.get('name'),
                'source': 'students'
            }
    except Exception as e:
        # Não encontrou na tabela students, tentar answer_sheet_students
        logger.debug(f"Not found in students table: {e}")

    try:
        # 2. Buscar na tabela 'answer_sheet_students' (fluxo legado de batches)
        response = client.table('answer_sheet_students') \
            .select('id, student_name, enrollment_code, class_name, batch_id, answer_sheet_batches(exam_id, school_id, name)') \
            .eq('sheet_code', sheet_code) \
            .single() \
            .execute()

        if response.data:
            data = response.data
            batch = data.get('answer_sheet_batches', {}) or {}
            logger.info(f"Student found in 'answer_sheet_students' table: {data.get('student_name')}")
            return {
                'id': data['id'],
                'student_name': data['student_name'],
                'enrollment': data.get('enrollment_code'),
                'class_name': data.get('class_name'),
                'batch_id': data.get('batch_id'),
                'exam_id': batch.get('exam_id'),
                'school_id': batch.get('school_id'),
                'batch_name': batch.get('name'),
                'source': 'answer_sheet_students'
            }
        else:
            logger.warning(f"No student found for sheet_code: {sheet_code}")
            return None

    except Exception as e:
        logger.error(f"Supabase lookup error: {e}")
        return None


def save_omr_result(sheet_code: str, answers: list, stats: dict) -> bool:
    """
    Salva resultado do OMR no Supabase.
    Tabela: answer_sheet_students
    """
    client = get_supabase()
    if not client:
        logger.warning("Supabase not configured, skipping result save")
        return False

    try:
        response = client.table('answer_sheet_students') \
            .update({
                'answers': answers,
                'answered_count': stats['answered'],
                'blank_count': stats['blank'],
                'double_marked_count': stats['double_marked'],
                'processed_at': 'now()'
            }) \
            .eq('sheet_code', sheet_code) \
            .execute()

        if response.data:
            logger.info(f"OMR result saved for {sheet_code}")
            return True
        return False

    except Exception as e:
        logger.error(f"Supabase save error: {e}")
        return False


def generate_sheet_code() -> str:
    """
    Gera código único no formato XTRI-XXXXXX.
    Usa apenas caracteres sem ambiguidade: A-Z (exceto I, O, L) e 2-9.
    """
    # Caracteres sem ambiguidade visual
    chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
    code = ''.join(random.choice(chars) for _ in range(6))
    return f"XTRI-{code}"


def create_batch(name: str, exam_id: str = None, school_id: str = None) -> Optional[Dict[str, Any]]:
    """
    Cria um novo lote de gabaritos no Supabase.
    Tabela: answer_sheet_batches
    """
    client = get_supabase()
    if not client:
        logger.warning("Supabase not configured, cannot create batch")
        return None

    try:
        response = client.table('answer_sheet_batches').insert({
            'name': name,
            'exam_id': exam_id,
            'school_id': school_id,
            'status': 'pending',
            'created_at': datetime.utcnow().isoformat()
        }).execute()

        if response.data:
            batch = response.data[0]
            logger.info(f"Batch created: {batch['id']}")
            return batch
        return None

    except Exception as e:
        logger.error(f"Supabase batch creation error: {e}")
        return None


def create_students_batch(batch_id: str, students: List[Dict]) -> List[Dict]:
    """
    Cria múltiplos alunos com sheet_codes únicos.
    Tabela: answer_sheet_students
    """
    client = get_supabase()
    if not client:
        logger.warning("Supabase not configured, cannot create students")
        return []

    try:
        # Gerar sheet_codes únicos para cada aluno
        records = []
        for student in students:
            sheet_code = generate_sheet_code()
            records.append({
                'batch_id': batch_id,
                'sheet_code': sheet_code,
                'student_name': student.get('student_name', student.get('nome', '')),
                'enrollment_code': student.get('enrollment_code', student.get('matricula', '')),
                'class_name': student.get('class_name', student.get('turma', '')),
                'created_at': datetime.utcnow().isoformat()
            })

        response = client.table('answer_sheet_students').insert(records).execute()

        if response.data:
            logger.info(f"Created {len(response.data)} students for batch {batch_id}")
            return response.data
        return []

    except Exception as e:
        logger.error(f"Supabase students creation error: {e}")
        return []


def get_batch_status(batch_id: str) -> Optional[Dict[str, Any]]:
    """
    Retorna status do lote com contagens.
    """
    client = get_supabase()
    if not client:
        return None

    try:
        # Buscar batch
        batch_resp = client.table('answer_sheet_batches') \
            .select('*') \
            .eq('id', batch_id) \
            .single() \
            .execute()

        if not batch_resp.data:
            return None

        # Buscar alunos do batch
        students_resp = client.table('answer_sheet_students') \
            .select('id, sheet_code, student_name, processed_at') \
            .eq('batch_id', batch_id) \
            .execute()

        students = students_resp.data or []
        total = len(students)
        processed = sum(1 for s in students if s.get('processed_at'))

        return {
            'batch': batch_resp.data,
            'total_students': total,
            'processed_count': processed,
            'pending_count': total - processed,
            'students': students
        }

    except Exception as e:
        logger.error(f"Supabase batch status error: {e}")
        return None


def get_batch_students_for_pdf(batch_id: str) -> List[Dict]:
    """
    Retorna lista de alunos para gerar PDF.
    """
    client = get_supabase()
    if not client:
        return []

    try:
        response = client.table('answer_sheet_students') \
            .select('sheet_code, student_name, enrollment_code, class_name') \
            .eq('batch_id', batch_id) \
            .order('student_name') \
            .execute()

        return response.data or []

    except Exception as e:
        logger.error(f"Supabase get students error: {e}")
        return []


# ============================================================
# CONFIGURACAO DO TEMPLATE X-TRI (90 questoes, 6 colunas x 15 linhas)
# ============================================================
# CALIBRADO para template gerado por answerSheetBatch.ts
# Referência: A4 em 150 DPI (1240x1753 pixels)
# Calculado a partir das constantes do gerador TypeScript

# Dimensoes de referencia (A4 150dpi) - imagem completa
REF_WIDTH_FULL = 1240
REF_HEIGHT_FULL = 1753

# Marcadores de canto (quadrados pretos ~15x15 pontos)
# MEDIDOS NA IMAGEM REAL: TL(55,465) TR(1185,465) BL(55,1140) BR(1185,1140)
MARKER_TL = (55, 465)
MARKER_BR = (1185, 1140)
REF_WIDTH = MARKER_BR[0] - MARKER_TL[0]   # 1130
REF_HEIGHT = MARKER_BR[1] - MARKER_TL[1]  # 675

# Posicoes Y das 15 linhas RELATIVAS aos marcadores
# RECALIBRADO: medido na imagem correto-01.png alinhada
# Primeira linha Y=58, espacamento medio=41.4 pixels
Y_POSITIONS = [58, 99, 140, 182, 223, 265, 307, 348, 389, 431, 473, 514, 556, 597, 638]

# Posicoes X das 6 colunas RELATIVAS aos marcadores
# Posição X da primeira bolha (opção A) de cada coluna
# RECALIBRADO: medido na imagem correto-01.png alinhada
# Primeira coluna X=64, espacamento entre colunas=179 pixels
COLUMNS_X = [64, 244, 423, 603, 782, 962]

# Espacamento entre opcoes A-B-C-D-E (12 pontos = 25 pixels)
OPTION_SPACING = 25

# Raio da bolha (5 pontos = 10.4 pixels)
BUBBLE_RADIUS = 10

# Thresholds RECALIBRADOS para MAXIMA PRECISAO (90/90)
# METODO RELATIVO: compara bolhas entre si na mesma questao
MARKED_THRESHOLD = 38.0      # % escuro absoluto para considerar marcado
BLANK_THRESHOLD = 32.0       # Se a mais escura < 32%, questão em branco
RELATIVE_DIFF = 4.0          # Diferença minima entre 1a e 2a para ser marcação clara
DOUBLE_MARK_DIFF = 4.0       # Se diff < 4% entre 1a e 2a (ambas altas), dupla marcação
DARK_PIXEL_THRESHOLD = 150   # Valor de pixel para considerar escuro (mais conservador)


# ============================================================
# FUNCOES DE PROCESSAMENTO
# ============================================================

def find_corner_markers(gray):
    """Encontra os 4 quadrados pretos de alinhamento do template X-TRI."""
    h, w = gray.shape

    # Calcular fator de escala baseado na resolução da imagem
    # Referência: 1240x1753 (150 DPI), onde marcadores são ~31x31 = ~961 área
    scale_factor = (w / REF_WIDTH_FULL) * (h / REF_HEIGHT_FULL)

    # Limites de área escalados para diferentes DPIs
    # 150 DPI: scale=1.0, área 400-3000
    # 300 DPI: scale=4.0, área 1600-12000
    min_area = int(400 * scale_factor)
    max_area = int(5000 * scale_factor)  # Aumentado para tolerar marcadores maiores

    logger.debug(f"Marker detection: image {w}x{h}, scale_factor={scale_factor:.2f}, area range={min_area}-{max_area}")

    # Binarizar para encontrar quadrados pretos
    _, binary = cv2.threshold(gray, 120, 255, cv2.THRESH_BINARY_INV)

    # Encontrar contornos
    contours, _ = cv2.findContours(binary, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

    # Filtrar quadrados (marcadores escalados com a resolução)
    squares = []
    for cnt in contours:
        area = cv2.contourArea(cnt)
        if area < min_area or area > max_area:
            continue

        x, y, cw, ch = cv2.boundingRect(cnt)
        aspect = cw / ch if ch > 0 else 0

        # Quadrado tem aspect ratio ~1
        if 0.7 < aspect < 1.4:
            peri = cv2.arcLength(cnt, True)
            approx = cv2.approxPolyDP(cnt, 0.04 * peri, True)

            if len(approx) >= 4:
                center_x = x + cw // 2
                center_y = y + ch // 2
                squares.append({
                    'center': (center_x, center_y),
                    'area': area,
                    'bbox': (x, y, cw, ch)
                })

    if len(squares) < 4:
        logger.warning(f"Apenas {len(squares)} marcadores encontrados (esperado 4)")
        return None

    # Ordenar por área e pegar candidatos
    squares.sort(key=lambda s: s['area'], reverse=True)
    candidates = squares[:min(12, len(squares))]

    # Separar por posição
    # No template X-TRI, os marcadores estão entre 25-40% da altura (topo) e 60-75% (fundo)
    top_left = None
    top_right = None
    bottom_left = None
    bottom_right = None

    for sq in candidates:
        cx, cy = sq['center']
        # Posições relativas baseadas no template X-TRI
        # Marcadores em: TL(57,463), TR(1182,463), BL(57,1140), BR(1182,1140)
        # Em imagem 1240x1754: left<5%, right>95%, top<30%, bottom>60%
        is_left = cx < w * 0.08  # Marcadores esquerdos ~4.6% da largura
        is_right = cx > w * 0.92  # Marcadores direitos ~95% da largura
        is_top = cy < h * 0.35  # Marcadores superiores ~26% da altura
        is_bottom = cy > h * 0.60  # Marcadores inferiores ~65% da altura

        if is_top and is_left and (top_left is None or sq['area'] > top_left['area']):
            top_left = sq
        elif is_top and is_right and (top_right is None or sq['area'] > top_right['area']):
            top_right = sq
        elif is_bottom and is_left and (bottom_left is None or sq['area'] > bottom_left['area']):
            bottom_left = sq
        elif is_bottom and is_right and (bottom_right is None or sq['area'] > bottom_right['area']):
            bottom_right = sq

    if not all([top_left, top_right, bottom_left, bottom_right]):
        logger.warning("Não foi possível identificar todos os 4 marcadores de canto")
        return None

    logger.debug(f"Marcadores encontrados: TL={top_left['center']}, TR={top_right['center']}, "
                f"BL={bottom_left['center']}, BR={bottom_right['center']}")

    return {
        'top_left': top_left['center'],
        'top_right': top_right['center'],
        'bottom_left': bottom_left['center'],
        'bottom_right': bottom_right['center']
    }


def align_to_markers(img):
    """Corrige perspectiva usando os 4 marcadores de canto do template X-TRI."""
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

    # Pontos fonte (onde os marcadores estão na imagem)
    src_points = np.float32([
        markers['top_left'],
        markers['top_right'],
        markers['bottom_left'],
        markers['bottom_right']
    ])

    # Pontos destino - dimensões da área alinhada (REF_WIDTH x REF_HEIGHT)
    # Template X-TRI: 1125 x 677 pixels
    dst_width = REF_WIDTH   # 1125
    dst_height = REF_HEIGHT  # 677

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

    logger.info(f"Alinhamento por marcadores realizado: {dst_width}x{dst_height}")
    return aligned, True  # Retorna flag indicando que foi alinhado


def deskew_image(img):
    """Tenta alinhar por marcadores, senão usa método de linhas.
    Retorna (imagem, aligned) onde aligned=True se foi alinhada por marcadores."""
    # Primeiro, tentar alinhar usando os 4 marcadores
    result = align_to_markers(img)

    if isinstance(result, tuple):
        return result[0], True  # Imagem alinhada por marcadores

    # Fallback: usar detecção de linhas para rotação simples
    if len(img.shape) == 3:
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    else:
        gray = img.copy()

    edges = cv2.Canny(gray, 50, 150, apertureSize=3)
    lines = cv2.HoughLinesP(edges, 1, np.pi/180, threshold=100,
                           minLineLength=200, maxLineGap=10)

    if lines is None or len(lines) < 5:
        return img, False

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
        return img, False

    median_angle = np.median(angles)
    if abs(median_angle) < 0.3:
        return img, False

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
                         borderMode=cv2.BORDER_REPLICATE), False


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
    """Analisa uma bolha com busca local para compensar desalinhamentos."""
    h, w = gray.shape
    r = int(BUBBLE_RADIUS * scale_x * 1.3)
    search_range = int(15 * scale_y)  # Buscar +/- 15 pixels na vertical

    best_darkness = 0.0

    # Buscar na posição original e posições próximas
    for dy in range(-search_range, search_range + 1, 5):
        test_y = y + dy
        if test_y - r < 0 or test_y + r >= h:
            continue

        x1 = max(0, x - r)
        x2 = min(w, x + r)
        y1 = max(0, test_y - r)
        y2 = min(h, test_y + r)

        roi = gray[y1:y2, x1:x2]
        if roi.size == 0:
            continue

        dark_pixels = np.sum(roi < DARK_PIXEL_THRESHOLD)
        darkness = (dark_pixels / roi.size) * 100.0

        if darkness > best_darkness:
            best_darkness = darkness

    return best_darkness


def read_question(gray, q_num, col_x, row_y, scale_x, scale_y, aligned=False):
    """
    Lê uma questão e retorna a resposta.

    Lógica simplificada em 4 passos hierárquicos:
    1. Blank: nenhuma bolha significativamente escura
    2. Clear mark: melhor bolha escura E significativamente mais escura que a segunda
    3. Double mark: duas bolhas escuras com diferença pequena
    4. Light mark: diferença relativa grande mesmo com valores baixos

    Returns:
        str: 'A'-'E' para resposta, 'X' para dupla marcação, None para em branco
    """
    options = []

    for opt_idx in range(5):
        if aligned:
            x = int((col_x + opt_idx * OPTION_SPACING) * scale_x)
            y = int(row_y * scale_y)
        else:
            x = int((MARKER_TL[0] + col_x + opt_idx * OPTION_SPACING) * scale_x)
            y = int((MARKER_TL[1] + row_y) * scale_y)

        darkness = analyze_bubble_with_search(gray, x, y, scale_x, scale_y)
        options.append({
            'label': chr(65 + opt_idx),
            'darkness': darkness
        })

    # Ordenar por escuridão (maior primeiro)
    sorted_opts = sorted(options, key=lambda x: x['darkness'], reverse=True)
    best = sorted_opts[0]
    second = sorted_opts[1]
    diff = best['darkness'] - second['darkness']

    # ============================================================
    # LÓGICA SIMPLIFICADA - 4 PASSOS HIERÁRQUICOS
    # ============================================================

    # 1. BLANK: nenhuma bolha significativamente escura
    if best['darkness'] < BLANK_THRESHOLD:
        return None

    # 2. DOUBLE MARK: duas bolhas escuras com diferença pequena
    if best['darkness'] >= MARKED_THRESHOLD and second['darkness'] >= (MARKED_THRESHOLD - 5):
        if diff < DOUBLE_MARK_DIFF:
            return 'X'

    # 3. CLEAR MARK: melhor bolha é escura E significativamente mais escura que segunda
    if best['darkness'] >= MARKED_THRESHOLD and diff >= RELATIVE_DIFF:
        return best['label']

    # 4. LIGHT MARK: diferença relativa grande (para marcas leves mas distinguíveis)
    if diff >= RELATIVE_DIFF * 1.5:
        return best['label']

    # 5. FALLBACK: se melhor está acima do threshold, aceitar mesmo com diff menor
    if best['darkness'] >= MARKED_THRESHOLD:
        return best['label']

    # Incerto = em branco
    return None


def process_omr(img):
    """
    Processa uma imagem e retorna as respostas.
    Usa o novo leitor Hough (100% precisão) com fallback para o legado.
    """
    start_time = time.time()

    # Tentar novo leitor Hough primeiro (mais preciso)
    if USE_HOUGH_OMR:
        try:
            result = hough_process_omr(img)
            elapsed = time.time() - start_time

            if result['success']:
                # Converter formato: {'1': 'A', '2': 'B', ...} -> ['A', 'B', ...]
                answers_list = []
                for i in range(1, 91):
                    ans = result['answers'].get(str(i))
                    answers_list.append(ans)

                logger.info(f"Hough OMR: {result['stats']['answered']}/90 respondidas ({elapsed*1000:.1f}ms)")

                return {
                    'answers': answers_list,
                    'answered': result['stats']['answered'],
                    'blank': result['stats']['blank'],
                    'double_marked': result['stats']['double_marked'],
                    'elapsed_ms': round(elapsed * 1000, 2),
                    'method': 'hough'
                }
            else:
                logger.warning(f"Hough OMR falhou: {result.get('error')}, usando método legado")
        except Exception as e:
            logger.warning(f"Hough OMR erro: {e}, usando método legado")

    # Fallback: método legado (baseado em coordenadas)
    return process_omr_legacy(img, start_time)


def process_omr_legacy(img, start_time=None):
    """Processa uma imagem usando o método legado (coordenadas fixas)."""
    if start_time is None:
        start_time = time.time()

    # 1. Corrigir rotação/inclinação (deskew)
    img, aligned = deskew_image(img)

    # 2. Converter para grayscale
    if len(img.shape) == 3:
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    else:
        gray = img.copy()

    h, w = gray.shape

    # Calcular escala baseado em se a imagem foi alinhada por marcadores
    if aligned:
        # Imagem alinhada: tamanho é REF_WIDTH x REF_HEIGHT (área entre marcadores)
        scale_x = w / REF_WIDTH   # 1125
        scale_y = h / REF_HEIGHT  # 677
        logger.info(f"Imagem alinhada: {w}x{h}, escala: {scale_x:.3f}x{scale_y:.3f}")
    else:
        # Imagem não alinhada: usar dimensões totais
        scale_x = w / REF_WIDTH_FULL   # 1240
        scale_y = h / REF_HEIGHT_FULL  # 1753
        logger.info(f"Imagem não alinhada: {w}x{h}, escala: {scale_x:.3f}x{scale_y:.3f}")

    # 3. Pre-processar (CLAHE + gamma)
    processed = preprocess_image(gray)

    # Ler todas as questoes
    answers = []
    # Log das coordenadas da Q01 para debug
    q1_col_x = COLUMNS_X[0]
    q1_row_y = Y_POSITIONS[0]
    if aligned:
        q1_x = int(q1_col_x * scale_x)
        q1_y = int(q1_row_y * scale_y)
    else:
        q1_x = int((MARKER_TL[0] + q1_col_x) * scale_x)
        q1_y = int((MARKER_TL[1] + q1_row_y) * scale_y)
    logger.info(f"Q01 coords: col_x={q1_col_x}, row_y={q1_row_y} -> pixel x={q1_x}, y={q1_y}")

    for col_idx, col_x in enumerate(COLUMNS_X):
        for row_idx, row_y in enumerate(Y_POSITIONS):
            q_num = col_idx * 15 + row_idx + 1
            answer = read_question(processed, q_num, col_x, row_y, scale_x, scale_y, aligned)
            answers.append(answer)

    # Estatisticas
    answered = sum(1 for a in answers if a and a != 'X')
    blank = sum(1 for a in answers if a is None)
    double_marked = sum(1 for a in answers if a == 'X')

    elapsed = time.time() - start_time

    return {
        'answers': answers,
        'answered': answered,
        'blank': blank,
        'double_marked': double_marked,
        'elapsed_ms': round(elapsed * 1000, 2),
        'method': 'legacy'
    }


# ============================================================
# FUNCOES DE LEITURA DE QR CODE
# ============================================================

# Regex para validar formato do sheet_code: XTRI-XXXXXX (6 caracteres alfanuméricos)
SHEET_CODE_PATTERN = re.compile(r'^XTRI-[A-Z2-9]{6}$')


def read_qr_code(img):
    """
    Lê QR Code da imagem ANTES de qualquer transformação.
    Retorna o conteúdo do QR ou None se não encontrar.
    """
    # Tentar na imagem original primeiro
    if len(img.shape) == 3:
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    else:
        gray = img.copy()

    # Decodificar QR codes
    decoded_objects = pyzbar.decode(gray)

    for obj in decoded_objects:
        if obj.type == 'QRCODE':
            try:
                return obj.data.decode('utf-8')
            except:
                continue

    # Se não encontrou, tentar com diferentes pré-processamentos
    # 1. Aumentar contraste
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    enhanced = clahe.apply(gray)
    decoded_objects = pyzbar.decode(enhanced)

    for obj in decoded_objects:
        if obj.type == 'QRCODE':
            try:
                return obj.data.decode('utf-8')
            except:
                continue

    # 2. Binarização adaptativa
    binary = cv2.adaptiveThreshold(gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
                                    cv2.THRESH_BINARY, 11, 2)
    decoded_objects = pyzbar.decode(binary)

    for obj in decoded_objects:
        if obj.type == 'QRCODE':
            try:
                return obj.data.decode('utf-8')
            except:
                continue

    return None


def validate_sheet_code(code):
    """
    Valida se o código está no formato esperado: XTRI-XXXXXX
    Retorna True se válido, False caso contrário.
    """
    if not code:
        return False
    return bool(SHEET_CODE_PATTERN.match(code))


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

        # Processar OMR
        result = process_omr(img_array)

        # Numero da pagina
        page_num = int(request.form.get('page', 1))

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


@app.route('/api/process-sheet', methods=['POST'])
def process_sheet():
    """
    Processa gabarito com QR Code: lê identificação + respostas.

    Pipeline: Image → pyzbar (QR ~10ms) → Supabase lookup (~20ms) → OpenCV OMR (~50ms)

    Input: image (multipart/form-data)
    Output: {
        status: "sucesso",
        sheet_code: "XTRI-A7B3C9",
        student: { student_name, enrollment, class_name },
        answers: ["A", "B", null, "C", ...],
        stats: { answered, blank, double_marked },
        timings: { qr_ms, supabase_ms, omr_ms, total_ms }
    }
    """
    timings = {}
    total_start = time.time()

    try:
        # Verificar se tem arquivo
        if 'image' not in request.files:
            logger.error("Campo 'image' nao encontrado nos arquivos")
            return jsonify({
                "status": "erro",
                "code": "NO_IMAGE",
                "message": "Arquivo 'image' não fornecido"
            }), 400

        img_file = request.files['image']
        img_bytes = img_file.read()

        if len(img_bytes) == 0:
            logger.error("Arquivo vazio recebido")
            return jsonify({
                "status": "erro",
                "code": "EMPTY_FILE",
                "message": "Arquivo vazio"
            }), 400

        # Abrir imagem
        pil_img = Image.open(io.BytesIO(img_bytes))

        if pil_img.mode != 'RGB':
            pil_img = pil_img.convert('RGB')

        # Converter para OpenCV (BGR)
        img_array = np.array(pil_img)[:, :, ::-1].copy()

        # ============================================================
        # STEP 1: LER QR CODE (~10ms)
        # ============================================================
        t0 = time.time()

        if USE_QR_MODULE:
            # Usar módulo QR com fallback (mais robusto)
            qr_result = read_qr_with_fallback(img_array)
            sheet_code = qr_result['sheet_code'] if qr_result['success'] else None
            timings['qr_method'] = qr_result.get('method')
        else:
            # Fallback para função interna
            sheet_code = read_qr_code(img_array)
            timings['qr_method'] = 'internal'

        timings['qr_ms'] = round((time.time() - t0) * 1000, 2)

        if not sheet_code:
            logger.warning("QR Code não encontrado na imagem")
            return jsonify({
                "status": "erro",
                "code": "QR_NOT_FOUND",
                "message": "QR Code não detectado na imagem"
            }), 400

        # Validar formato do código
        validator = validate_qr if USE_QR_MODULE else validate_sheet_code
        if not validator(sheet_code):
            logger.warning(f"QR Code com formato inválido: {sheet_code}")
            return jsonify({
                "status": "erro",
                "code": "INVALID_QR",
                "message": f"QR Code inválido. Formato esperado: XTRI-XXXXXX. Recebido: {sheet_code}"
            }), 400

        logger.info(f"QR Code lido: {sheet_code} via {timings.get('qr_method')} ({timings['qr_ms']}ms)")

        # ============================================================
        # STEP 2: SUPABASE LOOKUP (~20ms)
        # ============================================================
        t0 = time.time()
        student = lookup_student_by_sheet_code(sheet_code)
        timings['supabase_ms'] = round((time.time() - t0) * 1000, 2)

        if student:
            logger.info(f"Student: {student.get('student_name')} ({timings['supabase_ms']}ms)")
        else:
            logger.warning(f"Student not found for {sheet_code} ({timings['supabase_ms']}ms)")

        # ============================================================
        # STEP 3: PROCESSAR OMR (~50ms)
        # ============================================================
        t0 = time.time()
        result = process_omr(img_array)
        timings['omr_ms'] = round((time.time() - t0) * 1000, 2)

        stats = {
            "answered": result['answered'],
            "blank": result['blank'],
            "double_marked": result['double_marked']
        }

        logger.info(f"OMR: {result['answered']}/90 ({timings['omr_ms']}ms)")

        # ============================================================
        # STEP 4: SALVAR RESULTADO NO SUPABASE
        # ============================================================
        t0 = time.time()
        saved = save_omr_result(sheet_code, result['answers'], stats)
        timings['save_ms'] = round((time.time() - t0) * 1000, 2)

        if saved:
            logger.info(f"Result saved ({timings['save_ms']}ms)")

        # Calcular tempo total
        timings['total_ms'] = round((time.time() - total_start) * 1000, 2)

        logger.info(f"Sheet {sheet_code}: {result['answered']}/90 | "
                   f"QR:{timings['qr_ms']}ms + DB:{timings['supabase_ms']}ms + "
                   f"OMR:{timings['omr_ms']}ms = {timings['total_ms']}ms")

        # Formatar resposta
        return jsonify({
            "status": "sucesso",
            "sheet_code": sheet_code,
            "student": {
                "student_name": student.get('student_name') if student else None,
                "enrollment": student.get('enrollment') if student else None,
                "class_name": student.get('class_name') if student else None,
                "exam_id": student.get('exam_id') if student else None
            } if student else None,
            "answers": result['answers'],
            "stats": stats,
            "timings": timings,
            "saved": saved
        })

    except Exception as e:
        logger.error(f"Erro no processamento: {e}", exc_info=True)
        return jsonify({
            "status": "erro",
            "code": "PROCESSING_ERROR",
            "message": str(e)
        }), 500


@app.route('/api/upload-csv', methods=['POST'])
def upload_csv():
    """
    Upload de CSV para criar lote de alunos.

    Input: CSV file (multipart/form-data) com colunas: nome, matricula, turma
           + batch_name (form field)
           + exam_id (optional form field)
           + school_id (optional form field)

    Output: {
        status: "sucesso",
        batch_id: "uuid",
        students_created: 30,
        students: [...]
    }
    """
    try:
        # Verificar arquivo CSV
        if 'file' not in request.files:
            return jsonify({
                "status": "erro",
                "code": "NO_FILE",
                "message": "Arquivo CSV não fornecido"
            }), 400

        csv_file = request.files['file']
        if not csv_file.filename.endswith('.csv'):
            return jsonify({
                "status": "erro",
                "code": "INVALID_FORMAT",
                "message": "Apenas arquivos .csv são aceitos"
            }), 400

        # Parâmetros do lote
        batch_name = request.form.get('batch_name', f"Lote {datetime.now().strftime('%Y-%m-%d %H:%M')}")
        exam_id = request.form.get('exam_id')
        school_id = request.form.get('school_id')

        # Criar lote
        batch = create_batch(batch_name, exam_id, school_id)
        if not batch:
            return jsonify({
                "status": "erro",
                "code": "BATCH_CREATE_ERROR",
                "message": "Erro ao criar lote no banco de dados"
            }), 500

        # Ler CSV
        csv_content = csv_file.read().decode('utf-8-sig')  # utf-8-sig para remover BOM
        reader = csv.DictReader(io.StringIO(csv_content), delimiter=';')

        students = []
        for row in reader:
            # Aceitar diferentes nomes de colunas
            student = {
                'student_name': row.get('nome', row.get('student_name', row.get('name', ''))),
                'enrollment_code': row.get('matricula', row.get('enrollment_code', row.get('enrollment', ''))),
                'class_name': row.get('turma', row.get('class_name', row.get('class', '')))
            }
            if student['student_name']:  # Só adiciona se tiver nome
                students.append(student)

        if not students:
            return jsonify({
                "status": "erro",
                "code": "EMPTY_CSV",
                "message": "CSV vazio ou sem colunas válidas (esperado: nome, matricula, turma)"
            }), 400

        # Criar alunos com sheet_codes
        created_students = create_students_batch(batch['id'], students)

        logger.info(f"CSV uploaded: batch {batch['id']}, {len(created_students)} students")

        return jsonify({
            "status": "sucesso",
            "batch_id": batch['id'],
            "batch_name": batch_name,
            "students_created": len(created_students),
            "students": [{
                'sheet_code': s['sheet_code'],
                'student_name': s['student_name'],
                'enrollment_code': s.get('enrollment_code'),
                'class_name': s.get('class_name')
            } for s in created_students]
        })

    except Exception as e:
        logger.error(f"CSV upload error: {e}", exc_info=True)
        return jsonify({
            "status": "erro",
            "code": "UPLOAD_ERROR",
            "message": str(e)
        }), 500


@app.route('/api/batch/<batch_id>/status', methods=['GET'])
def batch_status(batch_id):
    """
    Retorna status de um lote de gabaritos.

    Output: {
        status: "sucesso",
        batch: { ... },
        total_students: 30,
        processed_count: 15,
        pending_count: 15,
        students: [...]
    }
    """
    try:
        result = get_batch_status(batch_id)

        if not result:
            return jsonify({
                "status": "erro",
                "code": "BATCH_NOT_FOUND",
                "message": f"Lote {batch_id} não encontrado"
            }), 404

        return jsonify({
            "status": "sucesso",
            **result
        })

    except Exception as e:
        logger.error(f"Batch status error: {e}", exc_info=True)
        return jsonify({
            "status": "erro",
            "code": "STATUS_ERROR",
            "message": str(e)
        }), 500


@app.route('/api/download-pdf/<batch_id>', methods=['GET'])
def download_pdf(batch_id):
    """
    Gera e retorna PDF com gabaritos do lote.
    Cada página contém um gabarito com QR Code único.
    """
    try:
        # Verificar se reportlab está disponível
        try:
            from reportlab.lib.pagesizes import A4
            from reportlab.pdfgen import canvas
            from reportlab.lib.units import mm
            import qrcode
        except ImportError:
            return jsonify({
                "status": "erro",
                "code": "MISSING_DEPS",
                "message": "Dependências para PDF não instaladas (reportlab, qrcode)"
            }), 500

        # Buscar alunos do lote
        students = get_batch_students_for_pdf(batch_id)

        if not students:
            return jsonify({
                "status": "erro",
                "code": "NO_STUDENTS",
                "message": f"Nenhum aluno encontrado para o lote {batch_id}"
            }), 404

        # Gerar PDF em memória
        pdf_buffer = io.BytesIO()
        c = canvas.Canvas(pdf_buffer, pagesize=A4)
        width, height = A4

        for student in students:
            # Cabeçalho
            c.setFont("Helvetica-Bold", 16)
            c.drawString(20*mm, height - 20*mm, "GABARITO - PROVA")

            # Dados do aluno
            c.setFont("Helvetica", 12)
            c.drawString(20*mm, height - 35*mm, f"Nome: {student['student_name']}")
            c.drawString(20*mm, height - 42*mm, f"Matrícula: {student.get('enrollment_code', '-')}")
            c.drawString(20*mm, height - 49*mm, f"Turma: {student.get('class_name', '-')}")
            c.drawString(20*mm, height - 56*mm, f"Código: {student['sheet_code']}")

            # QR Code (canto superior direito)
            qr = qrcode.QRCode(version=1, box_size=3, border=2)
            qr.add_data(student['sheet_code'])
            qr.make(fit=True)
            qr_img = qr.make_image(fill_color="black", back_color="white")

            # Salvar QR como imagem temporária
            qr_buffer = io.BytesIO()
            qr_img.save(qr_buffer, format='PNG')
            qr_buffer.seek(0)

            from reportlab.lib.utils import ImageReader
            qr_reader = ImageReader(qr_buffer)
            c.drawImage(qr_reader, width - 45*mm, height - 45*mm, 35*mm, 35*mm)

            # Marcadores de canto (quadrados pretos para alinhamento)
            marker_size = 5*mm
            # Top-left
            c.rect(15*mm, height - 130*mm, marker_size, marker_size, fill=1)
            # Top-right
            c.rect(width - 20*mm, height - 130*mm, marker_size, marker_size, fill=1)
            # Bottom-left
            c.rect(15*mm, 40*mm, marker_size, marker_size, fill=1)
            # Bottom-right
            c.rect(width - 20*mm, 40*mm, marker_size, marker_size, fill=1)

            # Grid de respostas (6 colunas x 15 linhas = 90 questões)
            start_y = height - 140*mm
            col_width = 28*mm
            row_height = 8*mm
            bubble_radius = 2.5*mm

            c.setFont("Helvetica", 8)

            for col in range(6):
                col_x = 20*mm + col * col_width

                # Cabeçalho da coluna
                c.setFont("Helvetica-Bold", 8)
                header_text = "A  B  C  D  E"
                c.drawString(col_x + 8*mm, start_y + 5*mm, header_text)
                c.setFont("Helvetica", 8)

                for row in range(15):
                    q_num = col * 15 + row + 1
                    row_y = start_y - row * row_height

                    # Número da questão
                    c.drawString(col_x, row_y, f"{q_num:02d}")

                    # Bolhas A-E
                    for opt in range(5):
                        bubble_x = col_x + 10*mm + opt * 5*mm
                        c.circle(bubble_x, row_y + 1.5*mm, bubble_radius)

            # Nova página
            c.showPage()

        c.save()
        pdf_buffer.seek(0)

        # Buscar nome do lote para o filename
        batch_status = get_batch_status(batch_id)
        batch_name = batch_status['batch'].get('name', 'gabaritos') if batch_status else 'gabaritos'
        filename = f"{batch_name.replace(' ', '_')}.pdf"

        logger.info(f"PDF generated for batch {batch_id}: {len(students)} pages")

        return send_file(
            pdf_buffer,
            mimetype='application/pdf',
            as_attachment=True,
            download_name=filename
        )

    except Exception as e:
        logger.error(f"PDF generation error: {e}", exc_info=True)
        return jsonify({
            "status": "erro",
            "code": "PDF_ERROR",
            "message": str(e)
        }), 500


@app.route('/api/batch-process', methods=['POST'])
def batch_process():
    """
    Processa múltiplas imagens de gabarito de uma vez.

    Input: images[] (multipart/form-data) - array de imagens

    Output: {
        status: "sucesso",
        processed: 10,
        success: 8,
        failed: 2,
        results: [...]
    }
    """
    try:
        if 'images' not in request.files:
            return jsonify({
                "status": "erro",
                "code": "NO_IMAGES",
                "message": "Nenhuma imagem fornecida"
            }), 400

        images = request.files.getlist('images')

        if not images:
            return jsonify({
                "status": "erro",
                "code": "EMPTY_IMAGES",
                "message": "Lista de imagens vazia"
            }), 400

        results = []
        success_count = 0
        failed_count = 0

        for idx, img_file in enumerate(images):
            try:
                img_bytes = img_file.read()
                if len(img_bytes) == 0:
                    results.append({
                        "index": idx,
                        "filename": img_file.filename,
                        "status": "erro",
                        "code": "EMPTY_FILE"
                    })
                    failed_count += 1
                    continue

                # Abrir imagem
                pil_img = Image.open(io.BytesIO(img_bytes))
                if pil_img.mode != 'RGB':
                    pil_img = pil_img.convert('RGB')

                img_array = np.array(pil_img)[:, :, ::-1].copy()

                # Ler QR Code
                if USE_QR_MODULE:
                    qr_result = read_qr_with_fallback(img_array)
                    sheet_code = qr_result['sheet_code'] if qr_result['success'] else None
                else:
                    sheet_code = read_qr_code(img_array)

                if not sheet_code:
                    results.append({
                        "index": idx,
                        "filename": img_file.filename,
                        "status": "erro",
                        "code": "QR_NOT_FOUND"
                    })
                    failed_count += 1
                    continue

                # Processar OMR
                omr_result = process_omr(img_array)

                # Buscar aluno
                student = lookup_student_by_sheet_code(sheet_code)

                # Salvar resultado
                stats = {
                    "answered": omr_result['answered'],
                    "blank": omr_result['blank'],
                    "double_marked": omr_result['double_marked']
                }
                saved = save_omr_result(sheet_code, omr_result['answers'], stats)

                results.append({
                    "index": idx,
                    "filename": img_file.filename,
                    "status": "sucesso",
                    "sheet_code": sheet_code,
                    "student_name": student.get('student_name') if student else None,
                    "enrollment": student.get('enrollment') if student else None,
                    "class_name": student.get('class_name') if student else None,
                    "school_id": student.get('school_id') if student else None,
                    "answered": omr_result['answered'],
                    "blank": omr_result['blank'],
                    "double_marked": omr_result['double_marked'],
                    "saved": saved
                })
                success_count += 1

            except Exception as e:
                results.append({
                    "index": idx,
                    "filename": img_file.filename,
                    "status": "erro",
                    "code": "PROCESSING_ERROR",
                    "message": str(e)
                })
                failed_count += 1

        logger.info(f"Batch process: {success_count}/{len(images)} success, {failed_count} failed")

        return jsonify({
            "status": "sucesso",
            "processed": len(images),
            "success": success_count,
            "failed": failed_count,
            "results": results
        })

    except Exception as e:
        logger.error(f"Batch process error: {e}", exc_info=True)
        return jsonify({
            "status": "erro",
            "code": "BATCH_ERROR",
            "message": str(e)
        }), 500


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
