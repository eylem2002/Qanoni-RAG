/**
 * Extract specific article numbers from a law's full text.
 * Uses the same regex strategy as the scraper to locate article boundaries.
 */
export function extractArticleTexts(
  fullText: string,
  articleNumbers: number[]
): Record<number, string> {
  const wanted = new Set(articleNumbers);
  const result: Record<number, string> = {};

  const regex =
    /المادة\s+(\d+)(?:\s+ارتباطات المادة)?\s+([\s\S]+?)(?=المادة\s+\d+(?:\s+ارتباطات المادة)?|$)/g;

  let match;
  while ((match = regex.exec(fullText)) !== null) {
    const num = parseInt(match[1] ?? "", 10);
    const rawText = match[2] ?? "";
    if (wanted.has(num)) {
      // Strip UI chrome (same logic as scraper)
      const cleaned = rawText
        .replace(/^تفسير\s+\d+\s*/gm, "")
        .replace(/^التشريعات المرتبطة\s+\d+\s*/gm, "")
        .replace(/ارتباطات المادة\s*/g, "")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
      if (cleaned.length > 0) {
        result[num] = cleaned;
      }
    }
  }

  return result;
}
