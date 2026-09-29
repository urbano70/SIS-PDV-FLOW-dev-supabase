/**
 * Calculates the largest font size that fits `text` within `maxWidth`.
 * Decrements one point at a time from maxFontSize down to minFontSize.
 */
export function fitFontSize(
  text: string,
  widthOfTextAtSize: (text: string, size: number) => number,
  maxWidth: number,
  maxFontSize: number,
  minFontSize: number,
): number {
  let fontSize = maxFontSize;
  while (fontSize > minFontSize && widthOfTextAtSize(text, fontSize) > maxWidth) {
    fontSize--;
  }
  return fontSize;
}

/**
 * Normalizes a person name into a safe filename segment.
 * "Maria Júlia" → "maria-julia"
 */
export function nameToFilename(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // strip diacritics
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '');
}
