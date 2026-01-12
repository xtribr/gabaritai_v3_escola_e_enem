#!/usr/bin/env python3
"""
Gabarito Generator - XTRI Template
===================================
Gera gabaritos digitais preenchidos para testes do sistema OMR.
Coordenadas calibradas para o template XTRI original.

Uso:
    python gabarito_generator.py --csv alunos.csv --output gabaritos.pdf --dia 1

CSV esperado (separador ;):
    MATRICULA;NOME;TURMA
    101018;JOSE ABRAHAN LEOPOLDINO DA SILVA FILHO;EM3VA
    ...

Autor: Claude para Xandão/XTRI
Data: Janeiro 2026
"""

import csv
import random
import string
import sys
from io import BytesIO
from typing import List, Dict, Optional
import argparse

from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.pdfgen import canvas
from reportlab.lib.colors import black, white, gray
import qrcode


# ============================================================
# CONFIGURAÇÃO DO TEMPLATE XTRI
# ============================================================
# Coordenadas baseadas no template original analisado em 150 DPI
# Página A4 @ 150 DPI = 1240 x 1754 pixels

# Tamanho A4 em pontos (72 pontos = 1 polegada)
PAGE_WIDTH, PAGE_HEIGHT = A4  # 595.27, 841.89 pts

# Fator de conversão: 150 DPI pixels -> pontos (72 DPI)
# 72/150 = 0.48
PIXEL_TO_POINTS = 72 / 150

# Posições dos 4 marcadores de canto (em 150 DPI pixels)
# Detectados do template original
MARKERS_150DPI = {
    'TL': (57, 463),
    'TR': (1184, 463),
    'BL': (57, 1141),
    'BR': (1184, 1141)
}
MARKER_SIZE = 32  # pixels em 150 DPI (área ~900-1000 para passar no filtro)

# Coordenadas do grid de bolhas (150 DPI)
# Q1 começa em (120, 520), Q90 em (1115, 1104)
GRID_START_X = 120
GRID_START_Y = 520

# Espaçamentos
BUBBLE_SPACING_X = 25      # Entre opções A-B-C-D-E
COLUMN_SPACING = 179       # Entre colunas de questões
ROW_SPACING = 41.7         # Entre linhas

# Raio das bolhas
BUBBLE_RADIUS = 9

# Opções de resposta
OPTIONS = ['A', 'B', 'C', 'D', 'E']

# Número de questões
NUM_QUESTIONS = 90
QUESTIONS_PER_COLUMN = 15
NUM_COLUMNS = 6


# ============================================================
# FUNÇÕES AUXILIARES
# ============================================================

def generate_sheet_code() -> str:
    """Gera código único do gabarito: XTRI-XXXXXX"""
    chars = string.ascii_uppercase + string.digits
    random_part = ''.join(random.choice(chars) for _ in range(6))
    return f"XTRI-{random_part}"


def generate_random_answers() -> List[str]:
    """Gera 90 respostas aleatórias (A-E)"""
    return [random.choice(OPTIONS) for _ in range(NUM_QUESTIONS)]


def px_to_pt_x(px: float) -> float:
    """Converte coordenada X de pixels (150 DPI) para pontos"""
    return px * PIXEL_TO_POINTS


def px_to_pt_y(px: float) -> float:
    """Converte coordenada Y de pixels (150 DPI) para pontos (invertido)"""
    # ReportLab tem Y=0 no bottom, pixels têm Y=0 no top
    # Página @ 150 DPI = 1754 pixels de altura
    return PAGE_HEIGHT - (px * PIXEL_TO_POINTS)


def create_qr_code(data: str, size: int = 100) -> BytesIO:
    """Cria QR Code e retorna como BytesIO"""
    qr = qrcode.QRCode(
        version=1,
        error_correction=qrcode.constants.ERROR_CORRECT_M,
        box_size=10,
        border=2,
    )
    qr.add_data(data)
    qr.make(fit=True)

    img = qr.make_image(fill_color="black", back_color="white")

    buffer = BytesIO()
    img.save(buffer, format='PNG')
    buffer.seek(0)
    return buffer


# ============================================================
# GERAÇÃO DO GABARITO
# ============================================================

def draw_header(c: canvas.Canvas, student: Dict, sheet_code: str, dia: int):
    """Desenha o cabeçalho do gabarito com logo, info do aluno e QR code"""
    from reportlab.lib.utils import ImageReader
    import os

    # Logo X-TRI no canto superior esquerdo
    logo_path = os.path.join(os.path.dirname(__file__), 'xtri-logo.png')
    if os.path.exists(logo_path):
        logo_img = ImageReader(logo_path)
        logo_size = 15*mm
        c.drawImage(logo_img, 15*mm, PAGE_HEIGHT - logo_size - 10*mm,
                    width=logo_size, height=logo_size, mask='auto')

    # Título "CARTÃO-RESPOSTA"
    c.setFont("Helvetica-Bold", 22)
    c.drawString(35*mm, PAGE_HEIGHT - 18*mm, "CARTÃO-RESPOSTA")

    c.setFont("Helvetica", 11)
    c.drawString(35*mm, PAGE_HEIGHT - 26*mm, f"Dia {dia}")

    # Box com informações do aluno
    box_x = 15*mm
    box_top = PAGE_HEIGHT - 35*mm
    box_w = 125*mm
    box_h = 22*mm

    c.setStrokeColor(black)
    c.setLineWidth(0.5)
    c.rect(box_x, box_top - box_h, box_w, box_h, fill=0, stroke=1)

    # Informações do aluno dentro do box
    c.setFont("Helvetica", 8)
    c.drawString(box_x + 3*mm, box_top - 5*mm, "Nome:")

    c.setFont("Helvetica-Bold", 10)
    # Truncar nome se muito longo
    nome_display = student['nome'][:48]
    c.drawString(box_x + 3*mm, box_top - 10*mm, nome_display)

    c.setFont("Helvetica", 9)
    c.drawString(box_x + 3*mm, box_top - 18*mm, f"Matrícula: {student['matricula']}")
    c.drawString(box_x + 55*mm, box_top - 18*mm, f"Turma: {student['turma']}")

    # QR Code no canto superior direito
    qr_buffer = create_qr_code(sheet_code)
    qr_img = ImageReader(qr_buffer)
    qr_size = 22*mm
    qr_x = PAGE_WIDTH - qr_size - 12*mm
    qr_y = PAGE_HEIGHT - qr_size - 10*mm
    c.drawImage(qr_img, qr_x, qr_y, width=qr_size, height=qr_size)

    # Código abaixo do QR
    c.setFont("Helvetica-Bold", 8)
    c.drawCentredString(qr_x + qr_size/2, qr_y - 4*mm, sheet_code)

    # Instruções
    c.setFont("Helvetica", 7)
    c.drawString(15*mm, PAGE_HEIGHT - 65*mm, "INSTRUÇÕES: Preencha completamente o círculo correspondente à resposta correta.")
    c.drawString(15*mm, PAGE_HEIGHT - 69*mm, "Use caneta esferográfica preta. Não rasure.")


def draw_markers(c: canvas.Canvas):
    """Desenha os 4 marcadores de canto (quadrados pretos)"""
    marker_size_pt = px_to_pt_x(MARKER_SIZE)

    for name, (x, y) in MARKERS_150DPI.items():
        px = px_to_pt_x(x)
        py = px_to_pt_y(y)
        c.setFillColor(black)
        c.rect(px - marker_size_pt/2, py - marker_size_pt/2,
               marker_size_pt, marker_size_pt, fill=1, stroke=0)


def draw_bubble_grid(c: canvas.Canvas, answers: List[str]):
    """Desenha o grid de bolhas com as respostas preenchidas"""

    bubble_r_pt = px_to_pt_x(BUBBLE_RADIUS)

    # Desenhar separadores verticais entre colunas
    c.setStrokeColor(gray)
    c.setLineWidth(0.3)
    first_y = px_to_pt_y(GRID_START_Y - 15)  # Acima da primeira linha
    last_y = px_to_pt_y(GRID_START_Y + (QUESTIONS_PER_COLUMN - 1) * ROW_SPACING + 15)  # Abaixo da última linha

    for col_idx in range(1, NUM_COLUMNS):
        # Posição X do separador (entre as colunas)
        sep_x = GRID_START_X + (col_idx * COLUMN_SPACING) - (COLUMN_SPACING - 4 * BUBBLE_SPACING_X) / 2 - 15
        sep_x_pt = px_to_pt_x(sep_x)
        c.line(sep_x_pt, first_y, sep_x_pt, last_y)

    # Desenhar bolhas com letras dentro
    for col_idx in range(NUM_COLUMNS):
        for row_idx in range(QUESTIONS_PER_COLUMN):
            q_num = col_idx * QUESTIONS_PER_COLUMN + row_idx + 1
            answer = answers[q_num - 1]

            # Posição Y da linha
            y = GRID_START_Y + (row_idx * ROW_SPACING)

            # Desenhar número da questão
            num_x = GRID_START_X + (col_idx * COLUMN_SPACING) - 30
            c.setFillColor(black)
            c.setFont("Helvetica", 7)
            c.drawRightString(px_to_pt_x(num_x), px_to_pt_y(y) - 3, f"{q_num:02d}")

            # Desenhar as 5 bolhas com letras dentro
            for opt_idx, opt in enumerate(OPTIONS):
                x = GRID_START_X + (col_idx * COLUMN_SPACING) + (opt_idx * BUBBLE_SPACING_X)
                cx = px_to_pt_x(x)
                cy = px_to_pt_y(y)

                if opt == answer:
                    # Bolha preenchida (resposta) - círculo preto com letra branca
                    c.setFillColor(black)
                    c.circle(cx, cy, bubble_r_pt, fill=1, stroke=0)
                    # Letra branca dentro
                    c.setFillColor(white)
                    c.setFont("Helvetica-Bold", 7)
                    c.drawCentredString(cx, cy - 2.5, opt)
                else:
                    # Bolha vazia - círculo com contorno e letra preta dentro
                    c.setStrokeColor(black)
                    c.setFillColor(white)
                    c.setLineWidth(0.5)
                    c.circle(cx, cy, bubble_r_pt, fill=1, stroke=1)
                    # Letra preta dentro
                    c.setFillColor(black)
                    c.setFont("Helvetica-Bold", 7)
                    c.drawCentredString(cx, cy - 2.5, opt)


def generate_gabarito(c: canvas.Canvas, student: Dict, dia: int, answers: Optional[List[str]] = None):
    """Gera uma página de gabarito completa"""

    sheet_code = generate_sheet_code()

    if answers is None:
        answers = generate_random_answers()

    # Desenhar elementos
    draw_header(c, student, sheet_code, dia)
    draw_markers(c)
    draw_bubble_grid(c, answers)

    return sheet_code


# ============================================================
# LEITURA DO CSV
# ============================================================

def read_csv(filepath: str) -> List[Dict]:
    """Lê CSV de alunos (MATRICULA;NOME;TURMA)"""
    students = []

    with open(filepath, 'r', encoding='utf-8-sig') as f:
        # Detectar delimitador
        sample = f.read(1024)
        f.seek(0)

        delimiter = ';' if ';' in sample else ','

        reader = csv.DictReader(f, delimiter=delimiter)

        for row in reader:
            # Normalizar nomes das colunas (uppercase)
            row_upper = {k.upper(): v for k, v in row.items()}

            students.append({
                'matricula': row_upper.get('MATRICULA', '').strip(),
                'nome': row_upper.get('NOME', '').strip(),
                'turma': row_upper.get('TURMA', '').strip()
            })

    return students


# ============================================================
# MAIN
# ============================================================

def main():
    parser = argparse.ArgumentParser(description='Gera gabaritos digitais preenchidos')
    parser.add_argument('--csv', required=True, help='Arquivo CSV com alunos')
    parser.add_argument('--output', required=True, help='Arquivo PDF de saída')
    parser.add_argument('--dia', type=int, default=1, help='Dia da prova (1 ou 2)')
    parser.add_argument('--limit', type=int, help='Limitar número de gabaritos')

    args = parser.parse_args()

    # Ler alunos do CSV
    print(f"Lendo CSV: {args.csv}")
    students = read_csv(args.csv)
    print(f"Total de alunos: {len(students)}")

    if args.limit:
        students = students[:args.limit]
        print(f"Limitado a: {len(students)} alunos")

    # Criar PDF
    print(f"Gerando PDF: {args.output}")
    c = canvas.Canvas(args.output, pagesize=A4)

    codes = []
    for i, student in enumerate(students):
        print(f"  [{i+1}/{len(students)}] {student['nome'][:40]}...")
        sheet_code = generate_gabarito(c, student, args.dia)
        codes.append({
            'matricula': student['matricula'],
            'nome': student['nome'],
            'turma': student['turma'],
            'sheet_code': sheet_code
        })
        c.showPage()

    c.save()

    # Salvar mapeamento de códigos
    codes_file = args.output.replace('.pdf', '_codes.csv')
    with open(codes_file, 'w', encoding='utf-8', newline='') as f:
        writer = csv.DictWriter(f, fieldnames=['matricula', 'nome', 'turma', 'sheet_code'], delimiter=';')
        writer.writeheader()
        writer.writerows(codes)

    print(f"\nConcluído!")
    print(f"  PDF: {args.output}")
    print(f"  Códigos: {codes_file}")
    print(f"  Total de gabaritos: {len(students)}")


if __name__ == '__main__':
    main()
