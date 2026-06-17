import type { Request, Response } from "express";
import * as LawChangesLogic from "./logic/LawChangesLogic";

export function getStatus(_req: Request, res: Response): void {
  void res.json(LawChangesLogic.getStatus());
}

export function triggerSync(req: Request, res: Response): void {
  const queued = LawChangesLogic.triggerSync();
  if (queued) {
    req.log.info("[Admin] Manual sync triggered");
    void res.json({ queued: true, message: "Sync started in background" });
  } else {
    void res
      .status(409)
      .json({ queued: false, message: "A sync is already in progress" });
  }
}

export async function getPending(req: Request, res: Response) {
  try {
    const result = await LawChangesLogic.getPendingChanges();
    return res.json(result);
  } catch (error) {
    req.log.error({ error }, "[Admin] Error fetching law changes");
    return res.status(500).json({ error: "Internal server error" });
  }
}

export async function acknowledge(req: Request<{ changeId: string }>, res: Response) {
  try {
    const changeId = parseInt(req.params.changeId ?? "");
    if (isNaN(changeId)) {
      return res.status(400).json({ error: "Invalid change ID" });
    }

    await LawChangesLogic.acknowledgeChange(changeId);

    return res.json({ success: true });
  } catch (error) {
    req.log.error({ error }, "[Admin] Error acknowledging law change");
    return res.status(500).json({ error: "Internal server error" });
  }
}

export async function getHistory(req: Request, res: Response) {
  try {
    const result = await LawChangesLogic.getHistory();
    return res.json(result);
  } catch (error) {
    req.log.error({ error }, "[Admin] Error fetching law history");
    return res.status(500).json({ error: "Internal server error" });
  }
}

export async function cleanup(req: Request, res: Response) {
  try {
    const { deleted, updated, flipFlopDeleted, scanned } =
      await LawChangesLogic.cleanupFalsePositives();

    req.log.info(
      { deleted, updated, flipFlopDeleted },
      "[Admin] Cleaned up false-positive law changes"
    );
    return res.json({
      success: true,
      deleted,
      updated,
      flipFlopDeleted,
      scanned,
    });
  } catch (error) {
    req.log.error({ error }, "[Admin] Error cleaning up false positives");
    return res.status(500).json({ error: "Internal server error" });
  }
}

export async function getLaws(_req: Request, res: Response) {
  try {
    const result = await LawChangesLogic.getLaws();
    return res.json(result);
  } catch {
    return res.status(500).json({ error: "Internal server error" });
  }
}
