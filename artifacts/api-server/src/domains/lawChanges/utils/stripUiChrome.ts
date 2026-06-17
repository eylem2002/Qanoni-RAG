/**
 * Strip lob.gov.jo UI chrome from article text. Mirrors stripUiElements() in the
 * scraper (lib/integrations/src/lob-gov-jo-puppeteer-scraper.ts). Used by the
 * cleanup endpoint to retroactively purge false-positive changelog records that
 * were stored before a given UI element was added to the scraper's strip list.
 */
export function stripUiChrome(text: string | null, articleNumber?: number): string {
  if (!text) return "";
  let out = text;
  // lob.gov.jo non-deterministically renders the article number twice, so a
  // leaked "المادة N" heading sometimes ends up at the start of the stored
  // body. Strip a leading repeat of THIS article's own heading (article-specific,
  // mirroring extractArticles()) so identical text doesn't read as a change.
  // Never strip a generic "المادة N" — that could remove a legitimate leading
  // cross-reference and force a false equality.
  if (articleNumber != null && Number.isFinite(articleNumber)) {
    out = out.replace(new RegExp(`^\\s*المادة\\s+${articleNumber}\\b\\s*`), "");
  }
  return out
    .replace(/^تفسير\s+\d+\s*/gm, "")
    .replace(/^التشريعات المرتبطة\s+\d+\s*/gm, "")
    .replace(/^الاحكام القضائية\s+\d+\s*/gm, "")
    .replace(/ارتباطات المادة\s*/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
