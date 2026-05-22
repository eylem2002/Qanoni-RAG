import { Router } from "express";
import { db } from "@workspace/db";
import { lawChangelog, laws } from "@workspace/db";
import { eq, desc, isNull } from "drizzle-orm";

const router = Router();

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
          oldText: c.oldText ? c.oldText.substring(0, 150) : null,
          newText: c.newText ? c.newText.substring(0, 150) : null,
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

router.get("/laws", async (_req, res) => {
  try {
    const allLaws = await db.select().from(laws).orderBy(desc(laws.lastUpdated));
    return res.json({ total: allLaws.length, laws: allLaws });
  } catch (error) {
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
