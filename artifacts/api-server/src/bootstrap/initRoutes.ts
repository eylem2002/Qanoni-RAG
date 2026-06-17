import type { Express } from "express";
import apiRouter from "../api/routes";

/**
 * Mount the API route registry under the `/api` base path.
 */
export function initRoutes(app: Express): void {
  app.use("/api", apiRouter);
}
