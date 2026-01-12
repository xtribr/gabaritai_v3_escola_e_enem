#!/usr/bin/env python3
"""
Diagnostic script to analyze why bubbles are being missed.
Analyzes all 90 questions and shows darkness values for each.
"""

import cv2
import numpy as np
import sys
import os

# Add parent dir to path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

# Import from app.py
from app import (
    COLUMNS_X, Y_POSITIONS, OPTION_SPACING, BUBBLE_RADIUS,
    MARKED_THRESHOLD, BLANK_THRESHOLD, RELATIVE_DIFF, DOUBLE_MARK_DIFF,
    DARK_PIXEL_THRESHOLD, REF_WIDTH, REF_HEIGHT,
    find_corner_markers, align_to_markers, preprocess_image
)

def analyze_bubble(gray, x, y, scale_x, scale_y):
    """Analisa uma bolha e retorna porcentagem de escuridao."""
    h, w = gray.shape
    r = int(BUBBLE_RADIUS * scale_x * 1.3)

    x1 = max(0, x - r)
    x2 = min(w, x + r)
    y1 = max(0, y - r)
    y2 = min(h, y + r)

    roi = gray[y1:y2, x1:x2]

    if roi.size == 0:
        return 0.0, 0.0

    dark_pixels = np.sum(roi < DARK_PIXEL_THRESHOLD)
    darkness = (dark_pixels / roi.size) * 100.0
    mean_val = np.mean(roi)

    return darkness, mean_val


def analyze_bubble_with_search(gray, x, y, scale_x, scale_y):
    """Analisa uma bolha com busca local."""
    h, w = gray.shape
    r = int(BUBBLE_RADIUS * scale_x * 1.3)
    search_range = int(15 * scale_y)

    best_darkness = 0.0
    best_mean = 255.0

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
        mean_val = np.mean(roi)

        if darkness > best_darkness:
            best_darkness = darkness
            best_mean = mean_val

    return best_darkness, best_mean


def diagnose_image(image_path):
    """Diagnose all 90 questions on an image."""
    img = cv2.imread(image_path)
    if img is None:
        print(f"Error: Could not read {image_path}")
        return

    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    h, w = gray.shape
    print(f"Original image: {w}x{h}")

    # Find markers and align
    markers = find_corner_markers(gray)
    if markers:
        print(f"Markers found: TL={markers['top_left']}, TR={markers['top_right']}, BL={markers['bottom_left']}, BR={markers['bottom_right']}")
        result = align_to_markers(img)
        if isinstance(result, tuple):
            aligned_img = result[0]
            aligned = True
        else:
            aligned_img = result
            aligned = False
    else:
        print("WARNING: Markers not found!")
        aligned_img = img
        aligned = False

    # Convert to grayscale and preprocess
    if len(aligned_img.shape) == 3:
        aligned_gray = cv2.cvtColor(aligned_img, cv2.COLOR_BGR2GRAY)
    else:
        aligned_gray = aligned_img.copy()

    h, w = aligned_gray.shape
    print(f"Aligned image: {w}x{h}, aligned={aligned}")

    # Preprocess
    processed = preprocess_image(aligned_gray)

    # Calculate scale
    if aligned:
        scale_x = w / REF_WIDTH
        scale_y = h / REF_HEIGHT
    else:
        scale_x = w / 1240
        scale_y = h / 1753

    print(f"Scale: {scale_x:.3f}x{scale_y:.3f}")
    print(f"Thresholds: MARKED={MARKED_THRESHOLD}%, BLANK={BLANK_THRESHOLD}%, DIFF={RELATIVE_DIFF}%")
    print(f"DARK_PIXEL_THRESHOLD={DARK_PIXEL_THRESHOLD}")
    print()

    # Analyze all 90 questions
    detected_count = 0
    blank_count = 0
    double_count = 0

    problematic_questions = []

    for col_idx, col_x in enumerate(COLUMNS_X):
        for row_idx, row_y in enumerate(Y_POSITIONS):
            q_num = col_idx * 15 + row_idx + 1

            # Analyze all 5 options
            options = []
            for opt_idx in range(5):
                if aligned:
                    x = int((col_x + opt_idx * OPTION_SPACING) * scale_x)
                    y = int(row_y * scale_y)
                else:
                    x = int((57 + col_x + opt_idx * OPTION_SPACING) * scale_x)
                    y = int((463 + row_y) * scale_y)

                darkness, mean_val = analyze_bubble_with_search(processed, x, y, scale_x, scale_y)
                options.append({
                    'label': chr(65 + opt_idx),
                    'darkness': darkness,
                    'mean': mean_val
                })

            # Sort by darkness
            sorted_opts = sorted(options, key=lambda x: x['darkness'], reverse=True)
            best = sorted_opts[0]
            second = sorted_opts[1]
            diff = best['darkness'] - second['darkness']

            # Determine result using same logic as app.py
            if best['darkness'] < BLANK_THRESHOLD:
                result = 'BLANK'
                blank_count += 1
                # This is problematic - should be detected
                problematic_questions.append({
                    'q': q_num,
                    'best': best,
                    'second': second,
                    'diff': diff,
                    'all_opts': options,
                    'reason': f"Best {best['darkness']:.1f}% < BLANK_THRESHOLD {BLANK_THRESHOLD}%"
                })
            elif best['darkness'] >= MARKED_THRESHOLD and second['darkness'] >= (MARKED_THRESHOLD - 5):
                if diff < DOUBLE_MARK_DIFF:
                    result = 'DOUBLE'
                    double_count += 1
                else:
                    result = best['label']
                    detected_count += 1
            elif best['darkness'] >= MARKED_THRESHOLD and diff >= RELATIVE_DIFF:
                result = best['label']
                detected_count += 1
            elif diff >= RELATIVE_DIFF * 1.5:
                result = best['label']
                detected_count += 1
            elif best['darkness'] >= MARKED_THRESHOLD:
                result = best['label']
                detected_count += 1
            else:
                result = 'BLANK'
                blank_count += 1
                problematic_questions.append({
                    'q': q_num,
                    'best': best,
                    'second': second,
                    'diff': diff,
                    'all_opts': options,
                    'reason': f"Fallback blank: best={best['darkness']:.1f}%, diff={diff:.1f}%"
                })

    print(f"=== RESULTS ===")
    print(f"Detected: {detected_count}/90")
    print(f"Blank: {blank_count}")
    print(f"Double: {double_count}")
    print()

    if problematic_questions:
        print(f"=== PROBLEMATIC QUESTIONS ({len(problematic_questions)}) ===")
        for pq in problematic_questions[:20]:  # Show first 20
            opts_str = ' '.join([f"{o['label']}:{o['darkness']:.1f}%" for o in pq['all_opts']])
            print(f"Q{pq['q']:02d}: {opts_str}")
            print(f"      Best={pq['best']['label']}:{pq['best']['darkness']:.1f}%, Second={pq['second']['label']}:{pq['second']['darkness']:.1f}%, Diff={pq['diff']:.1f}%")
            print(f"      Reason: {pq['reason']}")
            print()

        # Statistics on problematic questions
        if problematic_questions:
            best_darkness_values = [pq['best']['darkness'] for pq in problematic_questions]
            print(f"\n=== STATISTICS ON MISSED BUBBLES ===")
            print(f"Best darkness range: {min(best_darkness_values):.1f}% - {max(best_darkness_values):.1f}%")
            print(f"Mean best darkness: {np.mean(best_darkness_values):.1f}%")

            # Count by darkness range
            ranges = [(0, 25), (25, 30), (30, 35), (35, 38), (38, 50)]
            for low, high in ranges:
                count = sum(1 for d in best_darkness_values if low <= d < high)
                if count > 0:
                    print(f"  {low}-{high}%: {count} questions")


if __name__ == '__main__':
    if len(sys.argv) < 2:
        print("Usage: python diagnose_accuracy.py <image_path>")
        sys.exit(1)

    diagnose_image(sys.argv[1])
