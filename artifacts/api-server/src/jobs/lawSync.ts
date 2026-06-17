import { lobGovScraper } from "@workspace/integrations";
import { logger } from "../core/logger";

// ---------------------------------------------------------------------------
// Sync state (in-memory — single-process server)
// ---------------------------------------------------------------------------

export interface SyncState {
  inProgress: boolean;
  lastSyncAt: string | null;
  lastSyncStatus: "success" | "error" | null;
  nextSyncAt: string | null;
}

const state: SyncState = {
  inProgress: false,
  lastSyncAt: null,
  lastSyncStatus: null,
  nextSyncAt: null,
};

export function getSyncState(): SyncState {
  return { ...state };
}

// ---------------------------------------------------------------------------
// Core sync logic
// ---------------------------------------------------------------------------

async function runLawSync(label: string): Promise<void> {
  if (state.inProgress) {
    logger.warn(`[${label}] Sync already in progress — skipping`);
    return;
  }

  state.inProgress = true;
  logger.info(`[${label}] Running law sync...`);

  try {
    await lobGovScraper.initialize();
    await lobGovScraper.updateAllLaws();
    await lobGovScraper.initializeContractLawMappings();
    await lobGovScraper.shutdown();

    state.lastSyncAt = new Date().toISOString();
    state.lastSyncStatus = "success";
    logger.info(`[${label}] Law sync completed`);
  } catch (error) {
    state.lastSyncAt = new Date().toISOString();
    state.lastSyncStatus = "error";
    logger.error({ error }, `[${label}] Law sync failed`);
    try {
      await lobGovScraper.shutdown();
    } catch {
      // ignore
    }
  } finally {
    state.inProgress = false;
  }
}

// ---------------------------------------------------------------------------
// Manual trigger (for the "Sync Now" admin button)
// ---------------------------------------------------------------------------

/**
 * Trigger an immediate law sync in the background.
 * Returns false if a sync is already running.
 */
export function triggerManualSync(): boolean {
  if (state.inProgress) return false;
  void runLawSync("Manual");
  return true;
}

// ---------------------------------------------------------------------------
// Weekly scheduler
// ---------------------------------------------------------------------------

function scheduleWeeklyUpdate(): void {
  const MONDAY = 1;
  const TARGET_HOUR = 2;

  function msUntilNextMonday2am(): number {
    const now = new Date();
    const next = new Date(now);
    next.setHours(TARGET_HOUR, 0, 0, 0);
    const daysUntilMonday = (MONDAY - now.getDay() + 7) % 7 || 7;
    next.setDate(now.getDate() + daysUntilMonday);
    return next.getTime() - now.getTime();
  }

  function scheduleNext(): void {
    const delay = msUntilNextMonday2am();
    state.nextSyncAt = new Date(Date.now() + delay).toISOString();
    logger.info({ delayMs: delay, nextSyncAt: state.nextSyncAt }, "[Scheduler] Next law sync scheduled");

    setTimeout(async () => {
      await runLawSync("Scheduler");
      scheduleNext();
    }, delay);
  }

  scheduleNext();
}

export function scheduleLawUpdates(): void {
  void runLawSync("Startup");
  scheduleWeeklyUpdate();
}
