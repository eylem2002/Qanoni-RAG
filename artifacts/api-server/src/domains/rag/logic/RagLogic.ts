import type { Logger } from "pino";
import * as RagRepo from "../repos/RagRepo";
import { extractArticleTexts } from "../utils/extractArticles";

export interface RagArticle {
  lawId: string;
  lawNameAr: string;
  articleNumber: number;
  text: string;
  priority: 1 | 2;
  lastUpdated: string;
}

export interface RagRetrieveResult {
  contractType: string;
  lawVersionIds: string[];
  articleCount: number;
  articles: RagArticle[];
  retrievedAt: string;
  disclaimer: string;
}

/**
 * Retrieve the relevant law articles for a contract type.
 *
 * Returns `null` when no law mappings exist for the contract type (the caller
 * maps this to a 404). All other failures throw and are handled by the caller.
 */
export async function retrieveArticles(
  contractType: string,
  log: Logger
): Promise<RagRetrieveResult | null> {
  // 1. Look up which laws + article numbers apply to this contract type
  const mappings = await RagRepo.findMappingsByContractType(contractType);

  if (mappings.length === 0) {
    return null;
  }

  // 2. Fetch the full law text for each mapped law (deduplicated)
  const uniqueLawIds = [...new Set(mappings.map((m) => m.lawId))];
  const lawRows = await RagRepo.findLawsByIds(uniqueLawIds);
  const lawMap = new Map(lawRows.map((row) => [row.lawId, row]));

  // 3. Fetch latest version number for each law (for version tracking)
  const versionRows = await RagRepo.findLatestVersionsByIds(uniqueLawIds);
  const versionMap = new Map(
    versionRows.map((row) => [row.lawId, `${row.lawId}@v${row.version}`])
  );

  // 4. Extract only the relevant articles for this contract type
  const articles: RagArticle[] = [];

  for (const mapping of mappings) {
    const law = lawMap.get(mapping.lawId);
    if (!law) {
      log.warn({ lawId: mapping.lawId }, "[RAG] Law not found in DB — skipping");
      continue;
    }
    if (!law.isActive) {
      log.warn({ lawId: mapping.lawId, arabicName: law.arabicName }, "[RAG] Law is inactive (غير ساري) — skipping");
      continue;
    }

    const relevantArticleNums = (mapping.relevantArticles as number[]) ?? [];
    const extracted = extractArticleTexts(law.fullText, relevantArticleNums);

    for (const articleNum of relevantArticleNums) {
      const text = extracted[articleNum];
      if (text) {
        articles.push({
          lawId: law.lawId,
          lawNameAr: law.arabicName,
          articleNumber: articleNum,
          text,
          priority: (mapping.priority ?? 1) as 1 | 2,
          lastUpdated: law.lastUpdated.toISOString(),
        });
      }
    }
  }

  // 5. Assemble and return the result
  const lawVersionIds = uniqueLawIds
    .map((id) => versionMap.get(id))
    .filter((v): v is string => v !== undefined);

  return {
    contractType,
    lawVersionIds,
    articleCount: articles.length,
    articles,
    retrievedAt: new Date().toISOString(),
    disclaimer:
      "هذه المواد القانونية مستخرجة من موقع ديوان التشريع والرأي الأردني (lob.gov.jo). " +
      "يُنصح بمراجعة المصدر الرسمي للتحقق من أحدث الإصدارات.",
  };
}
