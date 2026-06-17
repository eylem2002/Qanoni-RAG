import * as LawChangesRepo from "../repos/LawChangesRepo";
import { stripUiChrome } from "../utils/stripUiChrome";
import {
  getSyncState,
  triggerManualSync,
  type SyncState,
} from "../../../jobs/lawSync";

export interface PendingChangeDetail {
  id: number;
  article: number;
  type: string;
  oldText: string | null;
  newText: string | null;
  detectedAt: Date | null;
}

export interface PendingLawGroup {
  lawId: string;
  lawName: string;
  changesCount: number;
  affectedContractTypes: string[];
  lastChangeAt: Date | null | undefined;
  details: PendingChangeDetail[];
}

export interface CleanupCounts {
  deleted: number;
  updated: number;
  flipFlopDeleted: number;
  scanned: number;
}

// ── Sync state / trigger (job control) ────────────────────────────────────

export function getStatus(): SyncState {
  return getSyncState();
}

export function triggerSync(): boolean {
  return triggerManualSync();
}

// ── Pending reviews ───────────────────────────────────────────────────────

export async function getPendingChanges(): Promise<{
  unreviewed: number;
  laws: PendingLawGroup[];
}> {
  const unnotifiedChanges = await LawChangesRepo.findUnacknowledgedChanges();

  const grouped = new Map<string, typeof unnotifiedChanges>();
  for (const change of unnotifiedChanges) {
    const key = change.lawId;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(change);
  }

  const result: PendingLawGroup[] = [];
  for (const [lawId, changes] of grouped.entries()) {
    const lawRecord = await LawChangesRepo.findLawById(lawId);

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

  return { unreviewed: result.length, laws: result };
}

// ── Acknowledge ───────────────────────────────────────────────────────────

export async function acknowledgeChange(changeId: number): Promise<void> {
  await LawChangesRepo.acknowledgeChange(changeId);
}

// ── History ───────────────────────────────────────────────────────────────

export async function getHistory(): Promise<{
  total: number;
  changes: Awaited<ReturnType<typeof LawChangesRepo.findAllChanges>>;
}> {
  const allChanges = await LawChangesRepo.findAllChanges();
  return { total: allChanges.length, changes: allChanges };
}

// ── Cleanup false positives ───────────────────────────────────────────────

export async function cleanupFalsePositives(): Promise<CleanupCounts> {
  const allChanges = await LawChangesRepo.findModifiedChanges();

  let deleted = 0;
  let updated = 0;

  for (const change of allChanges) {
    // Skip malformed rows — never act on a record missing either side.
    if (change.oldText == null || change.newText == null) continue;

    const strippedOld = stripUiChrome(change.oldText, change.articleNumber);
    const strippedNew = stripUiChrome(change.newText, change.articleNumber);

    if (strippedOld === strippedNew) {
      await LawChangesRepo.deleteChange(change.id);
      deleted++;
    } else if (
      strippedOld !== (change.oldText ?? "") ||
      strippedNew !== (change.newText ?? "")
    ) {
      await LawChangesRepo.updateChangeText(change.id, strippedOld, strippedNew);
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

  const remaining = await LawChangesRepo.findModifiedChanges();

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
    await LawChangesRepo.deleteChange(id);
    flipFlopDeleted++;
  }

  return { deleted, updated, flipFlopDeleted, scanned: allChanges.length };
}

// ── Laws registry ─────────────────────────────────────────────────────────

export async function getLaws(): Promise<{
  total: number;
  laws: Awaited<ReturnType<typeof LawChangesRepo.findLawsSummary>>;
}> {
  const allLaws = await LawChangesRepo.findLawsSummary();
  return { total: allLaws.length, laws: allLaws };
}
