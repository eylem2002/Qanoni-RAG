import { initApi } from "./bootstrap/initApi";
import { initRoutes } from "./bootstrap/initRoutes";
import { initJobs } from "./bootstrap/initJobs";
import { getPort } from "./bootstrap/initEnv";
import { logger } from "./core/logger";

const app = initApi();
initRoutes(app);
initJobs();

const port = getPort();

app.listen(port, (err?: Error) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
});
