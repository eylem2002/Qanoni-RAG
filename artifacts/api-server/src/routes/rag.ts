import { Router } from "express";
import { db } from "@workspace/db";
import { contractLawMappings, laws, lawVersions } from "@workspace/db";
import { eq, desc } from "drizzle-orm";

const router = Router();

const VALID_CONTRACT_TYPES = ["employment", "rental", "service", "nda", "supplier"] as const;
type ContractType = (typeof VALID_CONTRACT_TYPES)[number];

/**
 * Extract specific article numbers from a law's full text.
 * Uses the same regex strategy as the scraper to locate article boundaries.
 */
function extractArticleTexts(
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

/**
 * GET /api/rag/retrieve?contractType=employment
 *
 * Public endpoint — no auth required.
 * Called by the Contract System to fetch relevant law articles before
 * generating a contract. Returns structured article data with version
 * tracking so the contract system knows which law version was used.
 */
router.get("/retrieve", async (req, res) => {
  const contractType = req.query["contractType"] as string | undefined;

  if (!contractType) {
    return res.status(400).json({
      error: "Missing required query parameter: contractType",
      validValues: VALID_CONTRACT_TYPES,
    });
  }

  if (!VALID_CONTRACT_TYPES.includes(contractType as ContractType)) {
    return res.status(400).json({
      error: `Invalid contractType: "${contractType}"`,
      validValues: VALID_CONTRACT_TYPES,
    });
  }

  try {
    // 1. Look up which laws + article numbers apply to this contract type
    const mappings = await db
      .select()
      .from(contractLawMappings)
      .where(eq(contractLawMappings.contractType, contractType))
      .orderBy(contractLawMappings.priority);

    if (mappings.length === 0) {
      return res.status(404).json({
        error: `No law mappings found for contractType: "${contractType}"`,
      });
    }

    // 2. Fetch the full law text for each mapped law (deduplicated)
    const uniqueLawIds = [...new Set(mappings.map((m) => m.lawId))];
    const lawRows = await Promise.all(
      uniqueLawIds.map((lawId) =>
        db.select().from(laws).where(eq(laws.lawId, lawId)).limit(1)
      )
    );
    const lawMap = new Map(
      lawRows.flatMap((rows) => rows.map((row) => [row.lawId, row]))
    );

    // 3. Fetch latest version number for each law (for version tracking)
    const versionRows = await Promise.all(
      uniqueLawIds.map((lawId) =>
        db
          .select({ lawId: lawVersions.lawId, version: lawVersions.version })
          .from(lawVersions)
          .where(eq(lawVersions.lawId, lawId))
          .orderBy(desc(lawVersions.version))
          .limit(1)
      )
    );
    const versionMap = new Map(
      versionRows.flatMap((rows) =>
        rows.map((row) => [row.lawId, `${row.lawId}@v${row.version}`])
      )
    );

    // 4. Extract only the relevant articles for this contract type
    const articles: Array<{
      lawId: string;
      lawNameAr: string;
      articleNumber: number;
      text: string;
      priority: 1 | 2;
      lastUpdated: string;
    }> = [];

    for (const mapping of mappings) {
      const law = lawMap.get(mapping.lawId);
      if (!law) {
        req.log.warn({ lawId: mapping.lawId }, "[RAG] Law not found in DB — skipping");
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

    return res.json({
      contractType,
      lawVersionIds,
      articleCount: articles.length,
      articles,
      retrievedAt: new Date().toISOString(),
      disclaimer:
        "هذه المواد القانونية مستخرجة من موقع ديوان التشريع والرأي الأردني (lob.gov.jo). " +
        "يُنصح بمراجعة المصدر الرسمي للتحقق من أحدث الإصدارات.",
    });
  } catch (error) {
    req.log.error({ error }, "[RAG] Error retrieving articles");
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
