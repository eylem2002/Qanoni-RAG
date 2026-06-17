import { scheduleLawUpdates } from "../jobs/lawSync";
import { isTestEnv } from "./initEnv";

/**
 * Start background jobs. Runs the startup scrape and registers the weekly
 * scheduler, except under the test environment.
 */
export function initJobs(): void {
  if (!isTestEnv()) {
    scheduleLawUpdates();
  }
}
