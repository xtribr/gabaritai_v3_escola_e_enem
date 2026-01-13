/**
 * Helper functions for series-based data filtering
 */

/**
 * Extracts the série number from a turma name
 * Supports multiple patterns:
 *   "EM3VA" → "3"
 *   "EM1VB" → "1"
 *   "3ª Série A" → "3"
 *   "1º Ano B" → "1"
 *   "2ª série - Manhã" → "2"
 *   "Turma 3A" → "3"
 */
export function extractSerieNumber(turma: string | null): string | null {
  if (!turma || turma === 'null' || turma.trim() === '') return null;

  // Pattern 1: EM followed by number (e.g., EM3VA, EM1VB, EM2VC)
  const emPattern = turma.match(/^EM(\d)/i);
  if (emPattern) return emPattern[1];

  // Pattern 2: Number followed by ª/º Série/Ano (e.g., 3ª Série, 1º Ano)
  const seriePattern = turma.match(/^(\d+)[ªº]?\s*[Ss]érie/i);
  if (seriePattern) return seriePattern[1];

  const anoPattern = turma.match(/^(\d+)[ªº]?\s*[Aa]no/i);
  if (anoPattern) return anoPattern[1];

  // Pattern 3: Just starts with a number (e.g., 3A, 2B)
  const numPattern = turma.match(/^(\d)/);
  if (numPattern) return numPattern[1];

  return null;
}

/**
 * Extracts the série (grade level) from a turma name (legacy format)
 * For display purposes - returns full série string
 */
export function extractSerie(turma: string | null): string | null {
  if (!turma || turma === 'null' || turma.trim() === '') return null;

  // Pattern 1: EM followed by number (e.g., EM3VA → "3ª Série")
  const emPattern = turma.match(/^EM(\d)/i);
  if (emPattern) return `${emPattern[1]}ª Série`;

  // Pattern 2: Already in série format
  const match = turma.match(/^(\d+[ªº]?\s*[Ss]érie|\d+[ªº]?\s*[Aa]no)/i);
  return match ? match[1] : null;
}

/**
 * Normalizes série for comparison (case-insensitive, accent-insensitive)
 * "3ª Série" → "3 serie"
 * "3ª série" → "3 serie"
 */
export function normalizeSerie(serie: string): string {
  return serie
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // Remove accents
    .replace(/[ªº]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Checks if a turma matches any of the allowed series
 * allowedSeries can contain: "3", "1", "2" (just numbers)
 * or full names like "3ª Série", "1ª Série"
 */
export function isTurmaAllowed(turma: string | null, allowedSeries: string[] | null): boolean {
  // If no restrictions, allow all
  if (!allowedSeries || allowedSeries.length === 0) return true;

  // Extract the série number from the turma
  const serieNumber = extractSerieNumber(turma);
  if (!serieNumber) return false;

  // Check if the série number matches any allowed series
  return allowedSeries.some(allowed => {
    // Extract number from allowed (e.g., "3" from "3ª Série" or just "3")
    const allowedNumber = allowed.match(/(\d)/)?.[1];
    return allowedNumber === serieNumber;
  });
}
