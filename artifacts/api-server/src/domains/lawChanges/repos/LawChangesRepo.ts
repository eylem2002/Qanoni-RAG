import { db, lawChangelog, laws } from "../../../infra/db";
import { eq, desc, isNull } from "drizzle-orm";

/**
 * All Drizzle queries for the law-changes domain. No business rules here.
 */

export function findUnacknowledgedChanges() {
  return db
    .select()
    .from(lawChangelog)
    .where(isNull(lawChangelog.acknowledgedAt))
    .orderBy(desc(lawChangelog.detectedAt));
}

export function findLawById(lawId: string) {
  return db.select().from(laws).where(eq(laws.lawId, lawId)).limit(1);
}

export function findChangeById(changeId: number) {
  return db.select().from(lawChangelog).where(eq(lawChangelog.id, changeId)).limit(1);
}

export function acknowledgeChange(changeId: number) {
  return db
    .update(lawChangelog)
    .set({ acknowledgedAt: new Date(), notified: true })
    .where(eq(lawChangelog.id, changeId));
}

export function findAllChanges() {
  return db.select().from(lawChangelog).orderBy(desc(lawChangelog.detectedAt));
}

export function findModifiedChanges() {
  return db
    .select()
    .from(lawChangelog)
    .where(eq(lawChangelog.changeType, "modified"));
}

export function deleteChange(id: number) {
  return db.delete(lawChangelog).where(eq(lawChangelog.id, id));
}

export function updateChangeText(id: number, oldText: string, newText: string) {
  return db
    .update(lawChangelog)
    .set({ oldText, newText })
    .where(eq(lawChangelog.id, id));
}

export function findLawsSummary() {
  // Explicitly exclude full_text — it can be 277 KB per law.
  // Returning it on every page load would send 635 KB per request for 4 laws.
  return db
    .select({
      id: laws.id,
      lawId: laws.lawId,
      arabicName: laws.arabicName,
      englishName: laws.englishName,
      year: laws.year,
      articleCount: laws.articleCount,
      lastUpdated: laws.lastUpdated,
      lobGovUrl: laws.lobGovUrl,
      isActive: laws.isActive,
      createdAt: laws.createdAt,
    })
    .from(laws)
    .orderBy(desc(laws.lastUpdated));
}
