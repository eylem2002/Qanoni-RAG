import { lobGovScraper } from "@workspace/integrations";
import { logger } from "./logger";

async function runLawSync(label: string): Promise<void> {
  logger.info(`[${label}] Running law sync...`);
  try {
    await lobGovScraper.initialize();
    await lobGovScraper.updateAllLaws();
    await lobGovScraper.initializeContractLawMappings();
    await lobGovScraper.shutdown();
    logger.info(`[${label}] Law sync completed`);
  } catch (error) {
    logger.error({ error }, `[${label}] Law sync failed`);
    // Always shut down browser on error to avoid leaks
    try {
      await lobGovScraper.shutdown();
    } catch {
      // ignore
    }
  }
}

function scheduleWeeklyUpdate() {
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

  function scheduleNext() {
    const delay = msUntilNextMonday2am();
    logger.info({ delayMs: delay }, "[Scheduler] Next law sync scheduled");
    setTimeout(async () => {
      await runLawSync("Scheduler");
      scheduleNext();
    }, delay);
  }

  scheduleNext();
}

export function scheduleLawUpdates(): void {
  // Run initial sync in background (non-blocking)
  void runLawSync("Startup");
  scheduleWeeklyUpdate();
}
