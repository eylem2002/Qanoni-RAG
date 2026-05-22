import { lobGovScraper } from "@workspace/integrations";
import { logger } from "./logger";

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
      logger.info("[Scheduler] Starting weekly law update");
      try {
        await lobGovScraper.updateAllLaws();
        logger.info("[Scheduler] Weekly law update completed");
      } catch (error) {
        logger.error({ error }, "[Scheduler] Weekly law update failed");
      }
      scheduleNext();
    }, delay);
  }

  scheduleNext();
}

export function scheduleLawUpdates(): void {
  (async () => {
    logger.info("[Startup] Running initial law sync...");
    try {
      await lobGovScraper.updateAllLaws();
      await lobGovScraper.initializeContractLawMappings();
      logger.info("[Startup] Initial law sync completed");
    } catch (error) {
      logger.error({ error }, "[Startup] Initial law sync failed");
    }
  })();

  scheduleWeeklyUpdate();
  logger.info("[Scheduler] Law update scheduler initialized (runs Mondays 2 AM)");
}
