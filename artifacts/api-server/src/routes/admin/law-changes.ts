import { Router } from "express";
import { db } from "@workspace/db";
import { lawChangelog, laws } from "@workspace/db";
import { eq, desc, isNull } from "drizzle-orm";
import { getSyncState, triggerManualSync } from "../../lib/law-update-scheduler";

const router = Router();

/**
 * Strip lob.gov.jo UI chrome from article text. Mirrors stripUiElements() in the
 * scraper (lib/integrations/src/lob-gov-jo-puppeteer-scraper.ts). Used by the
 * cleanup endpoint to retroactively purge false-positive changelog records that
 * were stored before a given UI element was added to the scraper's strip list.
 */
function stripUiChrome(text: string | null): string {
  if (!text) return "";
  return text
    .replace(/^تفسير\s+\d+\s*/gm, "")
    .replace(/^التشريعات المرتبطة\s+\d+\s*/gm, "")
    .replace(/^الاحكام القضائية\s+\d+\s*/gm, "")
    .replace(/ارتباطات المادة\s*/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

router.get("/status", (_req, res) => {
  void res.json(getSyncState());
});

router.post("/sync", (req, res) => {
  const queued = triggerManualSync();
  if (queued) {
    req.log.info("[Admin] Manual sync triggered");
    void res.json({ queued: true, message: "Sync started in background" });
  } else {
    void res.status(409).json({ queued: false, message: "A sync is already in progress" });
  }
});

router.get("/pending", async (req, res) => {
  try {
    const unnotifiedChanges = await db
      .select()
      .from(lawChangelog)
      .where(isNull(lawChangelog.acknowledgedAt))
      .orderBy(desc(lawChangelog.detectedAt));

    const grouped = new Map<string, typeof unnotifiedChanges>();
    for (const change of unnotifiedChanges) {
      const key = change.lawId;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key)!.push(change);
    }

    const result = [];
    for (const [lawId, changes] of grouped.entries()) {
      const lawRecord = await db
        .select()
        .from(laws)
        .where(eq(laws.lawId, lawId))
        .limit(1);

      result.push({
        lawId,
        lawName: lawRecord[0]?.arabicName ?? lawId,
        changesCount: changes.length,
        affectedContractTypes: [
          ...new Set(changes.flatMap((c) => (c.affectedContractTypes as string[]) ?? [])),
        ],
        lastChangeAt: changes[0]?.detectedAt,
        details: changes.map((c) => ({
          id: c.id,
          article: c.articleNumber,
          type: c.changeType,
          oldText: c.oldText ?? null,
          newText: c.newText ?? null,
          detectedAt: c.detectedAt,
        })),
      });
    }

    return res.json({ unreviewed: result.length, laws: result });
  } catch (error) {
    req.log.error({ error }, "[Admin] Error fetching law changes");
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/:changeId/acknowledge", async (req, res) => {
  try {
    const changeId = parseInt(req.params.changeId ?? "");
    if (isNaN(changeId)) {
      return res.status(400).json({ error: "Invalid change ID" });
    }

    await db
      .update(lawChangelog)
      .set({ acknowledgedAt: new Date(), notified: true })
      .where(eq(lawChangelog.id, changeId));

    return res.json({ success: true });
  } catch (error) {
    req.log.error({ error }, "[Admin] Error acknowledging law change");
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/history", async (req, res) => {
  try {
    const allChanges = await db
      .select()
      .from(lawChangelog)
      .orderBy(desc(lawChangelog.detectedAt));

    return res.json({ total: allChanges.length, changes: allChanges });
  } catch (error) {
    req.log.error({ error }, "[Admin] Error fetching law history");
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/cleanup-false-positives", async (req, res) => {
  try {
    const allChanges = await db
      .select()
      .from(lawChangelog)
      .where(eq(lawChangelog.changeType, "modified"));

    let deleted = 0;
    let updated = 0;

    for (const change of allChanges) {
      // Skip malformed rows — never act on a record missing either side.
      if (change.oldText == null || change.newText == null) continue;

      const strippedOld = stripUiChrome(change.oldText);
      const strippedNew = stripUiChrome(change.newText);

      if (strippedOld === strippedNew) {
        await db.delete(lawChangelog).where(eq(lawChangelog.id, change.id));
        deleted++;
      } else if (
        strippedOld !== (change.oldText ?? "") ||
        strippedNew !== (change.newText ?? "")
      ) {
        await db
          .update(lawChangelog)
          .set({ oldText: strippedOld, newText: strippedNew })
          .where(eq(lawChangelog.id, change.id));
        updated++;
      }
    }

    req.log.info({ deleted, updated }, "[Admin] Cleaned up false-positive law changes");
    return res.json({ success: true, deleted, updated, scanned: allChanges.length });
  } catch (error) {
    req.log.error({ error }, "[Admin] Error cleaning up false positives");
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/laws", async (_req, res) => {
  try {
    // Explicitly exclude full_text — it can be 277 KB per law.
    // Returning it on every page load would send 635 KB per request for 4 laws.
    const allLaws = await db
      .select({
        id: laws.id,
        lawId: laws.lawId,
        arabicName: laws.arabicName,
        englishName: laws.englishName,
        year: laws.year,
        articleCount: laws.articleCount,
        lastUpdated: laws.lastUpdated,
        lobGovUrl: laws.lobGovUrl,
        isActive: laws.isActive,
        createdAt: laws.createdAt,
      })
      .from(laws)
      .orderBy(desc(laws.lastUpdated));
    return res.json({ total: allLaws.length, laws: allLaws });
  } catch (error) {
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
