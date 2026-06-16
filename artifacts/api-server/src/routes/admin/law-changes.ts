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
function stripUiChrome(text: string | null, articleNumber?: number): string {
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

      const strippedOld = stripUiChrome(change.oldText, change.articleNumber);
      const strippedNew = stripUiChrome(change.newText, change.articleNumber);

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

    // ── Pass 2: flip-flop mirror pairs from scrape instability ───────────────
    // The Angular SPA sometimes renders article bodies as the UI placeholder
    // "تعديلات" (or shifts article boundaries, merging the appendix into one
    // article). A bad scrape records X→Y for an article, then the next good
    // scrape records Y→X — a perfect mirror.
    //
    // We only delete a reverse pair when it is high-confidence scrape noise, to
    // avoid erasing a genuine legislative reversal (amendment then later
    // rollback). A pair qualifies only when BOTH records are unacknowledged AND
    // either:
    //   (a) a side is a known corruption artifact (the "تعديلات" placeholder, or
    //       empty after UI-chrome stripping), or
    //   (b) the two detections are within 48h of each other — far shorter than
    //       the weekly scrape cadence, so a real change + reversal (≥1 week
    //       apart) is never caught here.
    const PLACEHOLDER = "تعديلات";
    const WINDOW_MS = 48 * 60 * 60 * 1000;
    const isCorruptSide = (text: string, articleNumber: number): boolean => {
      const t = text.trim();
      return t === PLACEHOLDER || stripUiChrome(text, articleNumber) === "";
    };

    const remaining = await db
      .select()
      .from(lawChangelog)
      .where(eq(lawChangelog.changeType, "modified"));

    type Row = (typeof remaining)[number];
    const byForward = new Map<string, Row>();
    const flipFlopIds = new Set<number>();
    for (const c of remaining) {
      if (c.oldText == null || c.newText == null) continue;
      const base = `${c.lawId}\u0000${c.articleNumber}\u0000`;
      const reverseKey = base + c.newText + "\u0001" + c.oldText;
      const mate = byForward.get(reverseKey);
      if (mate && mate.oldText != null && mate.newText != null) {
        const bothUnacked = c.acknowledgedAt == null && mate.acknowledgedAt == null;
        const corrupt =
          isCorruptSide(c.oldText, c.articleNumber) ||
          isCorruptSide(c.newText, c.articleNumber) ||
          isCorruptSide(mate.oldText, mate.articleNumber) ||
          isCorruptSide(mate.newText, mate.articleNumber);
        const withinWindow =
          c.detectedAt != null &&
          mate.detectedAt != null &&
          Math.abs(
            new Date(c.detectedAt).getTime() - new Date(mate.detectedAt).getTime()
          ) <= WINDOW_MS;
        if (bothUnacked && (corrupt || withinWindow)) {
          flipFlopIds.add(c.id);
          flipFlopIds.add(mate.id);
        }
      } else {
        byForward.set(base + c.oldText + "\u0001" + c.newText, c);
      }
    }

    let flipFlopDeleted = 0;
    for (const id of flipFlopIds) {
      await db.delete(lawChangelog).where(eq(lawChangelog.id, id));
      flipFlopDeleted++;
    }

    req.log.info(
      { deleted, updated, flipFlopDeleted },
      "[Admin] Cleaned up false-positive law changes"
    );
    return res.json({
      success: true,
      deleted,
      updated,
      flipFlopDeleted,
      scanned: allChanges.length,
    });
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
