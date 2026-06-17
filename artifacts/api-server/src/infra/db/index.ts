/**
 * Thin gateway to the shared database layer.
 *
 * The real Drizzle client and schema live in the `@workspace/db` lib. Domain
 * repos import the `db` client and schema tables from here so the rest of the
 * backend depends on a single internal path (`infra/db`) rather than reaching
 * into the workspace package directly — mirroring the INSIGHT `infra/db` gateway.
 */
export * from "@workspace/db";
