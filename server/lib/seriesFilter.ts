/**
 * Helper functions for series-based data filtering
 */

/**
 * Extracts the série (grade level) from a turma name
 * Examples:
 *   "3ª Série A" → "3ª Série"
 *   "1º Ano B" → "1º Ano"
 *   "2ª série - Manhã" → "2ª série"
 */
export function extractSerie(turma: string | null): string | null {
  if (!turma || turma === 'null' || turma.trim() === '') return null;

  // Match patterns like "3ª Série", "1º Ano", "2ª série"
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
 */
export function isTurmaAllowed(turma: string | null, allowedSeries: string[] | null): boolean {
  // If no restrictions, allow all
  if (!allowedSeries || allowedSeries.length === 0) return true;

  const serie = extractSerie(turma);
  if (!serie) return false;

  const normalizedSerie = normalizeSerie(serie);

  return allowedSeries.some(allowed => {
    const normalizedAllowed = normalizeSerie(allowed);
    return normalizedSerie.includes(normalizedAllowed) || normalizedAllowed.includes(normalizedSerie);
  });
}
