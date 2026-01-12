#!/usr/bin/env python3
"""
QR Reader Module
================

Módulo para leitura robusta de QR Codes em gabaritos.
Usa múltiplos métodos com fallback para máxima taxa de sucesso.

Métodos:
1. ROI (25% topo, 35% direita) - área onde o QR está no template
2. Imagem completa
3. Binarização threshold
4. Versões escaladas

Autor: GabaritAI / X-TRI
"""

import cv2
import numpy as np
from pyzbar import pyzbar
import re
import logging

logger = logging.getLogger(__name__)

# Regex para validar formato do sheet_code: XTRI-XXXXXX (6 caracteres alfanuméricos)
SHEET_CODE_PATTERN = re.compile(r'^XTRI-[A-Z2-9]{6}$')


def validate_sheet_code(code: str) -> bool:
    """
    Valida se o código está no formato esperado: XTRI-XXXXXX

    Args:
        code: Código a ser validado

    Returns:
        True se válido, False caso contrário
    """
    if not code:
        return False
    return bool(SHEET_CODE_PATTERN.match(code))


def _decode_qr(image) -> str | None:
    """Tenta decodificar QR codes na imagem."""
    decoded_objects = pyzbar.decode(image)
    for obj in decoded_objects:
        if obj.type == 'QRCODE':
            try:
                return obj.data.decode('utf-8')
            except:
                continue
    return None


def read_qr_code(img) -> str | None:
    """
    Leitura básica de QR Code.

    Args:
        img: Imagem OpenCV (BGR ou grayscale)

    Returns:
        Conteúdo do QR Code ou None se não encontrar
    """
    if len(img.shape) == 3:
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    else:
        gray = img.copy()

    return _decode_qr(gray)


def read_qr_roi(img) -> str | None:
    """
    Lê QR Code na região de interesse (canto superior direito).
    O QR Code no template X-TRI fica nos 25% superiores e 35% direitos.
    """
    if len(img.shape) == 3:
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    else:
        gray = img.copy()

    h, w = gray.shape

    # ROI: 35% direita, 25% topo
    x_start = int(w * 0.65)
    y_end = int(h * 0.25)

    roi = gray[0:y_end, x_start:w]
    return _decode_qr(roi)


def read_qr_binary(img) -> str | None:
    """Lê QR Code usando binarização adaptativa."""
    if len(img.shape) == 3:
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    else:
        gray = img.copy()

    binary = cv2.adaptiveThreshold(
        gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
        cv2.THRESH_BINARY, 11, 2
    )
    return _decode_qr(binary)


def read_qr_enhanced(img) -> str | None:
    """Lê QR Code com CLAHE para melhorar contraste."""
    if len(img.shape) == 3:
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    else:
        gray = img.copy()

    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    enhanced = clahe.apply(gray)
    return _decode_qr(enhanced)


def read_qr_scaled(img, scale: float = 0.5) -> str | None:
    """Lê QR Code em versão escalada da imagem."""
    if len(img.shape) == 3:
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    else:
        gray = img.copy()

    h, w = gray.shape
    new_w = int(w * scale)
    new_h = int(h * scale)

    if new_w < 100 or new_h < 100:
        return None

    scaled = cv2.resize(gray, (new_w, new_h), interpolation=cv2.INTER_AREA)
    return _decode_qr(scaled)


def read_qr_with_fallback(img) -> dict:
    """
    Lê QR Code usando múltiplos métodos com fallback.

    Tenta na ordem:
    1. ROI (canto superior direito) - mais rápido
    2. Imagem completa
    3. CLAHE (contraste melhorado)
    4. Binarização adaptativa
    5. Escala 50%
    6. Escala 75%

    Args:
        img: Imagem OpenCV (BGR ou grayscale)

    Returns:
        dict: {
            'success': bool,
            'sheet_code': str ou None,
            'method': str (método que funcionou),
            'valid': bool (se código é válido)
        }
    """
    methods = [
        ('roi', lambda: read_qr_roi(img)),
        ('full', lambda: read_qr_code(img)),
        ('enhanced', lambda: read_qr_enhanced(img)),
        ('binary', lambda: read_qr_binary(img)),
        ('scaled_50', lambda: read_qr_scaled(img, 0.5)),
        ('scaled_75', lambda: read_qr_scaled(img, 0.75)),
    ]

    for method_name, method_func in methods:
        try:
            result = method_func()
            if result:
                is_valid = validate_sheet_code(result)
                logger.debug(f"QR found via {method_name}: {result} (valid={is_valid})")
                return {
                    'success': True,
                    'sheet_code': result,
                    'method': method_name,
                    'valid': is_valid
                }
        except Exception as e:
            logger.debug(f"QR method {method_name} failed: {e}")
            continue

    logger.debug("QR Code not found with any method")
    return {
        'success': False,
        'sheet_code': None,
        'method': None,
        'valid': False
    }


# Alias para compatibilidade
validate_qr = validate_sheet_code
