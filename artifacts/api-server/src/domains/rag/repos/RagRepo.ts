import { db, contractLawMappings, laws, lawVersions } from "../../../infra/db";
import { eq, desc } from "drizzle-orm";

/**
 * All Drizzle queries for the RAG domain. No business rules here — callers
 * (RagLogic) decide what to do with the rows.
 */

export function findMappingsByContractType(contractType: string) {
  return db
    .select()
    .from(contractLawMappings)
    .where(eq(contractLawMappings.contractType, contractType))
    .orderBy(contractLawMappings.priority);
}

export async function findLawsByIds(lawIds: string[]) {
  const rows = await Promise.all(
    lawIds.map((lawId) =>
      db.select().from(laws).where(eq(laws.lawId, lawId)).limit(1)
    )
  );
  return rows.flat();
}

export async function findLatestVersionsByIds(lawIds: string[]) {
  const rows = await Promise.all(
    lawIds.map((lawId) =>
      db
        .select({ lawId: lawVersions.lawId, version: lawVersions.version })
        .from(lawVersions)
        .where(eq(lawVersions.lawId, lawId))
        .orderBy(desc(lawVersions.version))
        .limit(1)
    )
  );
  return rows.flat();
}
