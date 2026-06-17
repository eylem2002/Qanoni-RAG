/**
 * Centralized environment-variable access and validation.
 *
 * Keeping env reads in one place mirrors the INSIGHT `initEnv` bootstrap step.
 * `getPort()` validates eagerly at startup (the server cannot run without it).
 * `getAdminPassword()` is intentionally lazy and may return undefined — the
 * admin-auth middleware fails closed at request time when it is unset, so we do
 * NOT throw at startup for a missing ADMIN_PASSWORD.
 */

export function getPort(): number {
  const rawPort = process.env["PORT"];

  if (!rawPort) {
    throw new Error(
      "PORT environment variable is required but was not provided.",
    );
  }

  const port = Number(rawPort);

  if (Number.isNaN(port) || port <= 0) {
    throw new Error(`Invalid PORT value: "${rawPort}"`);
  }

  return port;
}

export function getAdminPassword(): string | undefined {
  return process.env["ADMIN_PASSWORD"];
}

export function isTestEnv(): boolean {
  return process.env["NODE_ENV"] === "test";
}
