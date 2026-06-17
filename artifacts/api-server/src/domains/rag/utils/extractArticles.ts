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

  // Pre-strip inline UI chrome that EMBEDS "المادة N" or article counts. The
  // "تعديلات المادة N" amendments label (rendered for Labor Law 8/1996 between an
  // article heading and its body) contains the token "المادة N", which would
  // otherwise satisfy the boundary lookahead below and truncate the captured body
  // to the bare UI label "تعديلات". Removing it first keeps real headings as the
  // only article boundaries. The scraper's stripUiElements() does not need this
  // because it never re-parses the raw stored full_text; the RAG extractor does.
  const pre = fullText
    .replace(/^\s*تعديلات المادة\s+\d+\s*$/gm, "")
    .replace(/^تفسير\s+\d+\s*$/gm, "")
    .replace(/^التشريعات المرتبطة\s+\d+\s*$/gm, "")
    .replace(/^الاحكام القضائية\s+\d+\s*$/gm, "");

  const regex =
    /المادة\s+(\d+)(?:\s+ارتباطات المادة)?\s+([\s\S]+?)(?=المادة\s+\d+(?:\s+ارتباطات المادة)?|$)/g;

  let match;
  while ((match = regex.exec(pre)) !== null) {
    const num = parseInt(match[1] ?? "", 10);
    const rawText = match[2] ?? "";
    if (wanted.has(num)) {
      // Strip a leaked duplicate of THIS article's own heading, then UI chrome
      // (same logic as the scraper's stripUiElements()).
      const dupHeading = new RegExp(`^\\s*المادة\\s+${num}\\b\\s*`);
      const cleaned = rawText
        .replace(dupHeading, "")
        .replace(/^تفسير\s+\d+\s*/gm, "")
        .replace(/^التشريعات المرتبطة\s+\d+\s*/gm, "")
        .replace(/^الاحكام القضائية\s+\d+\s*/gm, "")
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
