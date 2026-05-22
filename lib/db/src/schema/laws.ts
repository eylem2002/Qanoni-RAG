import {
  pgTable,
  serial,
  text,
  timestamp,
  varchar,
  jsonb,
  integer,
  boolean,
} from "drizzle-orm/pg-core";

export const laws = pgTable("laws", {
  id: serial("id").primaryKey(),
  lawId: varchar("law_id", { length: 50 }).unique().notNull(),
  arabicName: text("arabic_name").notNull(),
  englishName: text("english_name"),
  year: varchar("year", { length: 4 }).notNull(),
  fullText: text("full_text").notNull(),
  articleCount: integer("article_count"),
  lastUpdated: timestamp("last_updated").notNull().defaultNow(),
  lobGovUrl: text("lob_gov_url"),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

export const lawVersions = pgTable("law_versions", {
  id: serial("id").primaryKey(),
  lawId: varchar("law_id", { length: 50 }).notNull(),
  version: integer("version").notNull(),
  fullText: text("full_text").notNull(),
  changesSummary: text("changes_summary"),
  amendmentDate: timestamp("amendment_date"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const lawChangelog = pgTable("law_changelog", {
  id: serial("id").primaryKey(),
  lawId: varchar("law_id", { length: 50 }).notNull(),
  articleNumber: integer("article_number").notNull(),
  changeType: varchar("change_type", { length: 20 }).notNull(),
  oldText: text("old_text"),
  newText: text("new_text"),
  affectedContractTypes: jsonb("affected_contract_types").default([]),
  detectedAt: timestamp("detected_at").defaultNow(),
  notified: boolean("notified").default(false),
  acknowledgedAt: timestamp("acknowledged_at"),
});

export const contractLawMappings = pgTable("contract_law_mappings", {
  id: serial("id").primaryKey(),
  contractType: varchar("contract_type", { length: 50 }).notNull(),
  lawId: varchar("law_id", { length: 50 }).notNull(),
  relevantArticles: jsonb("relevant_articles").default([]),
  priority: integer("priority").default(1),
  createdAt: timestamp("created_at").defaultNow(),
});
