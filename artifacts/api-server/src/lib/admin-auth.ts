import type { Request, Response, NextFunction } from "express";

/**
 * HTTP Basic Auth middleware protecting all /api/admin/* routes.
 *
 * Credentials: username = "admin", password = process.env.ADMIN_PASSWORD
 *
 * If ADMIN_PASSWORD is not set the middleware blocks all requests with 503
 * rather than silently allowing unauthenticated access — fail closed.
 *
 * Usage in routes/index.ts:
 *   router.use("/admin", adminAuth, adminRouter);
 */
export function adminAuth(req: Request, res: Response, next: NextFunction): void {
  const password = process.env["ADMIN_PASSWORD"];

  if (!password) {
    req.log.error(
      "ADMIN_PASSWORD environment variable is not set. " +
        "All admin requests are blocked until it is configured."
    );
    void res.status(503).json({
      error:
        "Admin panel is not configured. Set the ADMIN_PASSWORD environment variable.",
    });
    return;
  }

  const authHeader = req.headers["authorization"];

  if (!authHeader?.startsWith("Basic ")) {
    res.setHeader("WWW-Authenticate", 'Basic realm="Qanooni Admin"');
    void res.status(401).json({ error: "Authentication required" });
    return;
  }

  const encoded = authHeader.slice("Basic ".length);
  const decoded = Buffer.from(encoded, "base64").toString("utf8");
  const colonIndex = decoded.indexOf(":");
  const username = decoded.slice(0, colonIndex);
  const suppliedPassword = decoded.slice(colonIndex + 1);

  if (username !== "admin" || suppliedPassword !== password) {
    res.setHeader("WWW-Authenticate", 'Basic realm="Qanooni Admin"');
    void res.status(401).json({ error: "Invalid credentials" });
    return;
  }

  next();
}
