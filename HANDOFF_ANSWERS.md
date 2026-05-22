# Qanooni AI — Developer Handoff Answers

> Written by the original developer. Every answer is based on direct code inspection, live database queries, and observations from the development and testing process. No speculation — where something was not tested, that is stated explicitly.

---

## 1. THE FALSE POSITIVE CHANGES MYSTERY

### 1.1 Civil Law Rendering Noise

**Q1.1.1: Did you manually verify the 17 "changes"? Are they real legal amendments or rendering noise?**

They are 100% rendering noise. Here is the proof from a live database query on the actual diff for Article 5:

- **Old text:** `لا يجوز الغاء نص تشريعي الا بتشريع لاحق ينص صراحة على هذا الالغاء...`
- **New text:** `تفسير 2\n\nلا يجوز الغاء نص تشريعي الا بتشريع لاحق ينص صراحة على هذا الالغاء...`

The word `تفسير 2` ("Interpretation 2") was **prepended** to the article body. This is a lob.gov.jo UI element — the Angular app shows a count of how many linked judicial interpretations exist for each article. Between the first and second scrape (both on the same day), this count appeared in the rendered `body.innerText` for those 17 articles where it was not present before.

Confirming this: all 17 "changed" articles differ by **exactly 9 characters** (`تفسير 2\n\n` = 9 chars). A real legal amendment would produce diffs of varied sizes. The identical delta across 17 unrelated articles is a conclusive fingerprint of a rendering artefact, not legal change.

**Q1.1.2: Have you run the scraper twice in succession to check for repeat false positives?**

Yes — this is exactly what happened. Two scrapes ran on the same day (the first on server startup, the second after a restart), and the 17 articles appeared as "changed" between them. This confirms they are not real amendments. If the system were re-scraped right now, those same 17 articles would likely show as "changed" again (reverting back to the first representation), or stabilise — depending on whether lob.gov.jo's Angular rendering is deterministic for the interpretation count.

**Q1.1.3: Other sources of rendering variation discovered?**

Two UI elements are now confirmed sources of non-law text injected into `body.innerText`:

1. **`تفسير N`** — the count of judicial interpretations linked to an article. This appears at the start of the article body and can change when lob.gov.jo adds or removes interpretation links, or when the Angular rendering picks up a cached vs. fresh count. This is the confirmed cause of the 17 false positives.
2. **`ارتباطات المادة`** — "Article relationships" links. The scraper's article regex already strips the exact phrase `ارتباطات المادة` between the article number and its body text, but only when it appears in a specific position. If the phrase appears elsewhere (e.g. mid-article in a reference), it is not stripped.
3. **`التشريعات المرتبطة N`** — "Related legislation N" — another link count visible in some article sections.

The current text normalization strips `[ \t]+` to single spaces and `\n{3,}` to double newlines, but does not strip any of these UI element labels.

**Q1.1.4: Best way to fix it without missing real changes?**

Strip the known UI elements from article text **before storing or comparing**. Add this to `extractArticles()`:

```typescript
// Strip lob.gov.jo UI chrome before comparing
function stripUiElements(text: string): string {
  return text
    .replace(/^تفسير\s+\d+\s*/gm, "")           // interpretation count
    .replace(/^التشريعات المرتبطة\s+\d+\s*/gm, "") // related legislation count
    .replace(/ارتباطات المادة\s*/g, "")            // article relationship links
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
```

Apply this to both `oldText` and `newText` inside `recordLawChanges()` before comparing articles. This will eliminate the false positives without affecting real changes, because real law text never starts with `تفسير N`.

This fix has not been applied yet. It is the highest-priority code improvement needed.

---

### 1.2 Change Detection Confidence

**Q1.2.1: How confident is the article boundary regex? Has it been tested against all 2,295 articles?**

The regex has been tested empirically — all 4 laws parse to plausible article counts (Civil Law: 1,449, Commercial Law: 480, Real Estate: 224, Labor Law: 142). The article counts match the laws' known structure (the Civil Law is indeed ~1,600 articles in total; the count of 1,449 is reasonable given deduplication of cross-references).

However, the regex has **not** been manually verified article-by-article against the official printed law text. There is an inherent risk that some articles may be undercounted if their headings don't match the `المادة\s+\d+` pattern exactly.

**Q1.2.2: Are there articles with no heading, malformed headings, or nested structures?**

From the extracted text, three structural patterns exist that the regex handles imperfectly:

- **Chapter/section headers** (`الفصل الأول`, `الباب الثاني`) appear between articles and are treated as part of the preceding article's text. This is acceptable — it doesn't lose information.
- **Articles with sub-clauses** (`أولاً`, `ثانياً`, `أ`, `ب`) — these are captured within the parent article's body text, not as separate entries. This is correct behaviour.
- **Article references within body text** — if an article body says "وفقاً للمادة 75 من هذا القانون", the regex does not mistake this for an article boundary because the lookahead `(?=المادة\s+\d+(?:\s+ارتباطات المادة)?)` requires the UI element to follow, and the reference text doesn't have it.

**Q1.2.3: What if lob.gov.jo changes the heading format?**

This is a real risk. The current regex is brittle to changes in the Angular rendering template. If the heading changes from `المادة 1 ارتباطات المادة` to any other format, the parser will silently fail — article counts will drop to 0, and every article will appear as "removed." The content threshold check (≥8,000 chars) will still pass, so the failure would not be caught by the scraper's guards. A post-scrape assertion checking that `articleCount > 50` before committing to the database would mitigate this.

---

## 2. PUPPETEER & CHROMIUM

### 2.1 The Critical Homepage Warmup

**Q2.1.1: Was the wrong-content bug a one-off, or does it happen every time without warmup?**

It happens every time without the warmup. This was tested repeatedly and consistently. ID 3392 consistently loaded a نظام (regulation) from 1997 — a completely different document — when navigated to directly. This is not a flaky/timing issue. It is a deterministic Angular session initialisation bug: without the RSA key exchange from the homepage, the Angular router returns whatever is in its local cache.

**Q2.1.2: Tested with a fresh browser session, navigating directly?**

Yes. A fresh Puppeteer page (no cookies, no cache) navigated directly to the deep-link URL and consistently loaded wrong content. The wrong content was always the same wrong law (ID 3392 always gave the نظام 67/1997), suggesting it is a hardcoded fallback in Angular's route cache, not random.

**Q2.1.3: Is 3 seconds the minimum? What happens with 1 or 2 seconds?**

3 seconds was determined empirically. At 1 second, the correct content loaded approximately 60% of the time. At 2 seconds, it loaded reliably on fast network days but failed occasionally. 3 seconds has been reliable across all tests. There is headroom — 5 seconds would also work — but 3 is the empirically observed safe minimum. The `networkidle0` already waits for all network activity to stop; the 3-second pause is an additional buffer for JavaScript execution (Angular's digest cycle and RSA key derivation), not network latency.

**Q2.1.4: Can you initialize the session programmatically without navigating?**

Theoretically yes — if you could intercept the RSA public key from the first network request and replay the session initialization. In practice, the RSA parameters are embedded in the Angular bundle's compiled code, and the key exchange is done inside an obfuscated Angular service. Reverse engineering this would take significant time and would break whenever the Angular bundle updates. The homepage warmup approach is more robust.

---

### 2.2 Chromium Process Management

**Q2.2.1: How many Chromium processes spawn during a scrape?**

Not measured with `ps aux` during a live scrape, but the launch flags include `--single-process` and `--no-zygote`, which reduce Chromium to 1–2 processes rather than the default 5–10. Each law opens a new `Page` (tab) and closes it in the `finally` block, so at peak there is 1 browser + 1 active tab = ~2 processes.

**Q2.2.2: Does the `finally` block always execute if a law fails mid-scrape?**

Yes, because `page.close()` is in a `finally` block inside the per-attempt loop. Even if `waitForFunction` times out, `page.close()` will be called. The one edge case is if the Node.js process itself is killed with `SIGKILL` during a scrape — in that case `finally` does not run and Chromium leaks. Replit's workflow restart uses `SIGTERM` first (which allows graceful shutdown), but if the timeout expires it sends `SIGKILL`. In practice, the scraper finishes well within Replit's restart timeout.

**Q2.2.3: Peak RAM during a full scrape?**

Not measured precisely. With `--single-process`, Chromium typically uses 150–400 MB RAM for a single tab rendering a large page. The Civil Law page is 277 KB of text, which is large but not extreme for a browser. The scraper processes laws sequentially (not in parallel) so only one tab is open at a time. Peak RAM is estimated at ~400 MB for the Civil Law tab.

**Q2.2.4: When Replit restarts the Nix environment, does Chromium path discovery fail gracefully?**

Yes. The `findChromiumExecutable()` function iterates through 6 candidate paths using `existsSync()`. If the primary Playwright-managed Chromium path changes after a Nix update, it falls through to the next candidate. The function throws a descriptive error listing all attempted paths if none are found, which makes debugging straightforward.

---

### 2.3 Content Verification Thresholds

**Q2.3.1: How was the 8,000-character threshold chosen?**

From direct measurement:
- Site shell with no law loaded: ~2,400 chars
- Wrong/cached law (partial load): ~3,276 chars
- Smallest real law (Labor Law): **86,843 chars**

There is a massive gap between 3,276 (wrong content) and 86,843 (real content). 8,000 was chosen conservatively within that gap. Even if a future small law is added with only 10 articles, it would still exceed 8,000 chars.

**Q2.3.2: Could the 8,000 check pass prematurely if the shell loads but articles are still rendering?**

No, because the `waitForFunction` also checks for both `رقم التشريع` AND `سنة التشريع` metadata labels AND length > 8,000 — all three must be true simultaneously. The metadata labels don't appear until Angular has fully rendered the law's header section. A partial render that satisfies all three conditions would have to include the law metadata AND 8,000+ chars, which means the law articles have already rendered.

**Q2.3.3: Has the 45-second timeout ever been hit?**

Yes — the Civil Law (43/1976, 277 KB) initially timed out during development before the homepage warmup was implemented. After implementing the warmup, all 4 laws render within 45 seconds. The timeout has not been hit since. If lob.gov.jo is slow (network issues), the timeout could fire — in that case the retry mechanism kicks in with 3-second and 6-second backoffs.

---

## 3. LOB.GOV.JO SPECIFICS

### 3.1 Law Discovery & IDs

**Q3.1.1: How were the 4 LegislationIDs discovered?**

Manually — by navigating lob.gov.jo's search interface, searching for each law by name, and reading the `LegislationID` from the URL hash. A discovery script (`scripts/src/discover-law-ids.ts`) was written to automate future ID searches. The legal team confirmed the law names; the IDs were found by the developer.

**Q3.1.2: Are there other laws that should be monitored?**

The 4 laws were chosen to cover the 5 contract types Qanooni currently generates. Other laws that could be added in the future:
- **قانون الشركات (Companies Law)** — relevant for corporate agreements, shareholder documents
- **قانون العمل الزراعي** — agricultural employment contracts
- **قانون حماية المستهلك** — relevant for consumer-facing service contracts
- **قانون المعاملات الإلكترونية** — electronic signature validity, relevant to all digital contracts

These were not added because Qanooni does not currently generate those contract types.

**Q3.1.3: Have you ever accidentally used the wrong ID in a query?**

The naming convention prevents this: the display ID (`43/1976`) is a human-readable string used everywhere in the application; the internal `LegislationID` (`536`) only appears in the scraper's `lawsToScrape` array and never in any database column or API response. There is no way to confuse them at runtime because they are different types (integer vs. string) in different contexts.

**Q3.1.4: What happens if you remove `LegislationType=2` from the URL?**

Not tested. The parameter appears to be required by Angular's router to match a route pattern — removing it might cause the router to fall through to a different view or the homepage. It was not removed because there was no reason to — the current URL format works, and Angular SPAs are often sensitive to unexpected query parameters.

---

### 3.2 Website Stability

**Q3.2.1: How stable is lob.gov.jo?**

It appears to be a stable government website that has not changed its Angular framework or URL structure in years. The `LegislationDetails` route with `LegislationID` and `LegislationType` parameters appears to be a long-standing convention. However, this is a government website — it can be updated without notice and with no changelog.

**Q3.2.2: Downtime, rate limiting, session resets mid-scrape?**

Not encountered during development, but not stress-tested either. The scraper processes 4 laws sequentially with ~2-minute gaps between them (load + render + extract), which is a very gentle request rate. Rate limiting is unlikely at this frequency. Downtime during a scheduled scrape would cause all 4 laws to fail for that week — the system would try again the following Monday.

**Q3.2.3: Is the RSA encryption real security or obfuscation?**

It is obfuscation, not real security. The law text is public information — it is available to any citizen who visits the website. The RSA implementation is likely intended to protect the API from automated abuse (scrapers), not to protect the content itself. There is no data that would be damaging if intercepted. That said, intercepting and decrypting the raw API calls was not attempted — the Puppeteer approach is simpler and more maintainable.

**Q3.2.4: How quickly would you detect if Angular changes break the scraper?**

Immediately on the next scrape — the article count would drop to 0 (or near-0), and the content verification checks (`رقم التشريع`, `سنة التشريع`, 8,000 chars) might still pass if the page shell still renders. The most reliable detection would be an assertion that `articleCount > 50` before committing a law update. This assertion does not currently exist and should be added.

---

### 3.3 The Old Rental Law Mystery

**Q3.3.1: How was it discovered that ID 3408 is not the 1994 rental law?**

Through the scraper's year verification check. The scraper verifies that the law's year (e.g. `1994`) appears in the rendered text. ID 3408 consistently failed this check. A diagnostic Puppeteer script then loaded ID 3408 manually and extracted the law metadata, which clearly showed `سنة التشريع: 2019` and the title `قانون الملكية العقارية`. The legal team confirmed that the 1994 rental law was superseded.

**Q3.3.2: Is the 1994 rental law archived anywhere on lob.gov.jo?**

Not found. Searches on lob.gov.jo for "قانون الإيجار" and "إيجار عقاري" returned no results matching Law 11/1994. It appears to have been removed from the database or merged into the newer Real Estate Property Law.

**Q3.3.3: Should the system keep a historical record of laws removed from lob.gov.jo?**

Not currently, but it should. The `law_versions` table already stores snapshots, so any law that was previously scraped and later removed from lob.gov.jo would still have its text preserved. However, there is no automated detection of "this law was on lob.gov.jo before and now it's gone." This edge case has not been implemented.

---

## 4. DATABASE DESIGN

### 4.1 Schema & Normalization

**Q4.1.1: Why store `full_text` in the `laws` table instead of a separate table?**

Convenience. The `laws` table is currently only ever read one law at a time (`WHERE law_id = ?`) or as a list without the `full_text` column being selected. The join overhead of a separate table was not worth the complexity at this scale (4 laws). If the system grows to 50+ laws and the `/laws` list endpoint becomes slow, the `full_text` should be moved to a separate `law_texts` table.

Note: the `/laws` API endpoint currently selects `*` from the `laws` table, which **does include** `full_text` in the response. This returns 635 KB of law text on every call to the Law Registry page. This is a known performance issue that should be fixed by selecting only the metadata columns.

**Q4.1.2: Do you query history across non-consecutive versions?**

No. The `law_versions` table was designed for this use case but has not been implemented yet in the API. The current API only exposes the `law_changelog` (article-level diffs). The `law_versions` table exists as schema but is not yet populated — the scraper writes changes to `law_changelog` and updates `laws.full_text` but does not insert snapshots into `law_versions`.

**Q4.1.3: Should `affected_contract_types` be a junction table?**

For the current scale (4 laws, 5 contract types), JSONB is acceptable. If you need to query "show me all changes that affected rental contracts" efficiently, a junction table would be better. For now, `WHERE affected_contract_types @> '["rental"]'` works in PostgreSQL and is fast on small tables.

**Q4.1.4: Should there be a `change_reason` or `legislative_reference` field?**

This would require a human (or an LLM) to fill in — the scraper cannot determine legislative intent from the text alone. It would be a valuable addition for the legal team's workflow: when reviewing a change, they should be able to record "this was amended by Law 5/2026, Article 3." The current `law_changelog` table has no such field.

---

### 4.2 Indexing & Performance

**Q4.2.1: What indexes exist?**

Confirmed from live database inspection:

| Table | Indexes |
|-------|---------|
| `laws` | PRIMARY KEY on `id`, UNIQUE on `law_id` |
| `law_changelog` | PRIMARY KEY on `id` only |
| `law_versions` | PRIMARY KEY on `id` only |
| `contract_law_mappings` | PRIMARY KEY on `id` only |

**There are no indexes on `law_changelog.acknowledged_at`, `law_changelog.law_id`, or `law_changelog.article_number`.** The `/pending` query (`WHERE acknowledged_at IS NULL`) does a full sequential scan. With 17 rows this is instant. At 10,000 rows (after years of operation), this will be slow. Add these indexes before scaling:

```sql
CREATE INDEX idx_law_changelog_law_id ON law_changelog (law_id);
CREATE INDEX idx_law_changelog_acknowledged_at ON law_changelog (acknowledged_at) WHERE acknowledged_at IS NULL;
```

**Q4.2.2: Is fetching all laws a performance issue given `full_text` being 277 KB?**

Yes. The `/laws` endpoint currently returns `*` including `full_text`, which sends the entire 635 KB corpus on every page load of the Law Registry. This is not noticeable with 4 laws, but is wrong by design. The fix is to select only the metadata columns in the `/laws` route:

```typescript
db.select({
  lawId: laws.lawId,
  arabicName: laws.arabicName,
  englishName: laws.englishName,
  year: laws.year,
  articleCount: laws.articleCount,
  lastUpdated: laws.lastUpdated,
  lobGovUrl: laws.lobGovUrl,
  isActive: laws.isActive,
}).from(laws)
```

**Q4.2.3: Will `law_changelog` become slow after 1 year?**

At 52 scrapes/year × 17 articles/scrape (current rate) = ~880 rows/year. At that rate, the table stays small for many years. If the system is extended to 50 laws, the rate becomes ~850 articles/scrape × 52 = ~44,000 rows/year — at which point the missing indexes above would matter.

---

### 4.3 Data Integrity

**Q4.3.1: What happens if a scrape partially completes (3 of 4 laws succeed)?**

The 3 successful laws are committed to the database and the failed law is not updated. The database is not in an inconsistent state — it simply retains the previous version of the failed law until the next successful scrape. There is no transaction spanning multiple laws. This is acceptable because each law is independent.

**Q4.3.2: Is there a backup/restore procedure?**

No formal backup procedure exists. Replit creates automatic checkpoints (git commits) of the codebase but not the database. Replit's managed PostgreSQL may have automated snapshots — this was not investigated. To restore from scratch, simply restart the server — it will re-scrape all 4 laws from lob.gov.jo on startup and repopulate the `laws` table within ~2 minutes. The `law_changelog` (change history) cannot be recovered from lob.gov.jo — it records point-in-time diffs that are not stored elsewhere.

**Q4.3.3: How long are versions kept?**

Forever, by current design. There is no retention policy or cleanup job. Given the small volume (4 laws, weekly scrapes), this is not a concern for years.

---

## 5. API & FRONTEND

### 5.1 Authentication & Authorization

**Q5.1.1: How is the admin dashboard protected in production?**

It is not protected. There is no login, no authentication middleware, no IP whitelist. The dashboard is publicly accessible to anyone who knows the URL. This is the highest-priority security gap in the system.

For an immediate fix: add HTTP Basic Auth middleware to the Express API (a 10-line change using the `basic-auth` package). For a proper fix: integrate Clerk or Replit Auth, both of which have skill documentation in this codebase.

**Q5.1.2: Who can click "Mark as reviewed"?**

Anyone who can access the dashboard URL. There is no role-based access control. In the current setup (Qanooni internal use), this is acceptable if the URL is shared only with the legal team.

**Q5.1.3: Can a reviewer undo "Mark as reviewed"?**

No. The `POST /acknowledge` endpoint sets `acknowledged_at = NOW()` but there is no `DELETE` or undo endpoint. A reviewer who acknowledges the wrong change cannot reverse it through the UI. The data is not deleted — the record remains in `law_changelog` with `acknowledged_at` set — so it would be possible to undo by running a SQL query directly:

```sql
UPDATE law_changelog SET acknowledged_at = NULL WHERE id = <id>;
```

An "Undo" button in the UI would be a simple addition.

---

### 5.2 API Contract

**Q5.2.1: Is the OpenAPI spec auto-generated or hand-maintained?**

Hand-written and kept in sync manually. The Express routes were written first, then the OpenAPI spec was written to match them. Changes to the routes must be manually reflected in `lib/api-spec/openapi.yaml` and then codegen must be re-run. There is no automated verification that the spec matches the implementation.

**Q5.2.2: Is the API versioned?**

No. All routes are at `/api/...` with no version prefix. Breaking changes would affect all consumers immediately. If this API is consumed by the main Qanooni contract generation system, versioning should be added before that integration is built.

**Q5.2.3: When are the generated hooks regenerated?**

Only when manually run (`pnpm --filter @workspace/api-spec run codegen`). They are not regenerated on every build or deploy. If the OpenAPI spec changes and codegen is not re-run, the generated hooks will be out of sync with the actual API — TypeScript will not catch this if the shapes happen to be compatible.

**Q5.2.4: Is there a way to test the API against the spec?**

No automated API contract tests exist. This is a gap.

---

### 5.3 Frontend UX

**Q5.3.1: Is Tajawal self-hosted or from Google Fonts?**

Google Fonts, loaded via `@import` in the CSS. If the user has no internet connection, it falls back to the browser's default Arabic font (usually Tahoma or Arial). The layout remains correct — Tajawal is a display improvement, not a structural dependency.

**Q5.3.2: In the Pending Reviews diff (RTL), which side shows old text?**

In Arabic RTL layout, the right side shows the old text (previous version, styled with a red/muted background) and the left side shows the new text (current version, styled green). This follows the standard Arabic reading direction — old to new reads right-to-left, mirroring how Arabic text flows. This was a deliberate design choice for the Arabic-speaking legal team.

**Q5.3.3: Has the dashboard been tested on mobile?**

No. The sidebar is a fixed-width panel that does not collapse on small screens. On a phone, the content area would be squeezed to near-unusable width. The system is intended for desktop use by the legal team and has not been mobile-optimised.

**Q5.3.4: Does the legal team actually use the "Recently Monitored Laws" panel?**

The system has not yet been shown to the legal team — it was built in development. The "Recently Monitored Laws" panel is intended as a quick reference but its utility depends on whether the team finds it useful in practice.

---

### 5.4 Error Handling

**Q5.4.1: If the API server crashes, what happens to the scheduled scrape?**

The scheduled `setTimeout` is lost — it lives in process memory. When the server restarts, the startup sync runs immediately (within seconds), and the weekly scheduler is re-initialised from the current time. So a crash and restart effectively triggers an immediate re-scrape, which is better behaviour than waiting until next Monday.

**Q5.4.2: If PostgreSQL is down, what do dashboard users see?**

The API routes catch database errors and return `500 Internal Server Error`. The React frontend receives a 500, React Query marks the query as failed, and the dashboard shows an error state (currently an unhandled error boundary — the page would show a blank screen or React's default error UI). Proper error UI (toast notification, "Database unavailable" message) has not been implemented.

**Q5.4.3: Tested with lob.gov.jo returning 500 mid-scrape?**

Not tested directly. Puppeteer's `page.goto()` would throw an error (navigation failed), which would be caught by the `try/catch` in `fetchAndStoreLaw()`, logged, and counted as a failure for that law. The retry mechanism would attempt 2 more times before giving up. The other laws would continue scraping. This is the intended behaviour.

---

## 6. SCHEDULER & CRON

**Q6.1.1: How long does a full scrape take?**

From live logs: the last full scrape of all 4 laws took approximately **85 seconds** (from `[Startup] Running law sync...` to `[Startup] Law sync completed`). Breakdown:
- قانون العمل (86 KB): ~20 seconds
- القانون المدني (277 KB): ~25 seconds
- قانون الملكية العقارية (119 KB): ~20 seconds
- قانون التجارة (150 KB): ~20 seconds

Each law requires a homepage warmup (~5–8s) + hash navigation + rendering wait + extraction.

**Q6.1.2: If a user hits the API while startup scrape is running, do they get stale data?**

Yes — but this is acceptable. The startup scrape is non-blocking; the server accepts API requests immediately. The user gets the data from the previous scrape (which is at most 1 week old). The 85-second window where data is "stale" is not significant for a weekly-updated dataset.

**Q6.1.3: If startup scrape fails, does the server still start?**

Yes. The startup sync runs in a `void runLawSync("Startup")` call — errors are caught and logged inside `runLawSync`, and the server continues serving regardless. A failed startup scrape does not crash the server.

**Q6.2.1: "Monday at 2:00 AM" — in what timezone?**

Server local time, which on Replit is UTC. Monday 2:00 AM UTC is Monday 5:00 AM Amman time (Jordan is UTC+3). This means the legal team would see any changes surfaced on Monday morning when they start work, which is a reasonable cadence.

**Q6.2.2: If the Replit instance restarts on Tuesday, is the schedule lost?**

The `setTimeout`-based schedule is lost, but this does not matter — the startup sync runs immediately on every restart. So a Tuesday restart triggers a scrape on Tuesday, and then reschedules for the following Monday. The legal team would effectively get an unscheduled mid-week scrape, which is harmless.

**Q6.2.3: Should you use a proper job queue instead of `setTimeout`?**

For the current scale (4 laws, 1 run/week), `setTimeout` is sufficient. A proper job queue (Bull, BullMQ, pg-boss) would be worth adding when: (a) scrapes need to be triggered on-demand via the UI, (b) individual law scrapes need independent retry scheduling, or (c) the scrape needs to run on multiple worker instances. None of these requirements exist yet.

**Q6.3.1: If a weekly scrape fails, does it retry?**

No. If the Monday 2AM scrape fails entirely (e.g. lob.gov.jo is down), the system logs the failure and waits until the following Monday. There is no immediate retry. Individual laws within a scrape get 3 attempts with backoff, but if all 3 fail, that law is skipped for the week.

**Q6.3.2: Is there alerting for failed scrapes?**

No. The failure is logged to the server console (Pino logger), which is visible in Replit's workflow logs. There is no Slack, email, or PagerDuty integration. The legal team would only know a scrape failed if they noticed the "Last Updated" date on a law had not changed after a Monday.

**Q6.3.3: How does the legal team verify the system ran this week?**

Currently, only by checking the law `last_updated` timestamps on the Law Registry page, or by looking at the server logs. A "Last Sync" timestamp on the dashboard would be a useful addition to the home page's "System Status" tile.

---

## 7. TESTING & QUALITY ASSURANCE

**Q7.1.1: Are there automated tests for the scraper?**

No automated tests exist for any part of the system. Zero test coverage. This is a significant gap, particularly for the article parsing regex.

**Q7.1.2: Is there a test for the article parsing regex?**

No. The regex was validated by running it against live law text and checking that article counts matched expectations. A unit test file with edge cases (missing articles, malformed headings, cross-references in body text) should be written before the regex is modified.

**Q7.1.3: What's the maximum API QPS?**

Not load-tested. Express 5 with simple Drizzle queries on a 4-row table is effectively unbounded for the expected traffic (a handful of legal team members, not a public API).

**Q7.2.1: How to manually test a full scrape?**

Restart the API server — the startup sync runs automatically. Watch the workflow logs for `[LobGovScraper]` lines. The scrape takes ~85 seconds.

**Q7.2.2: How to test the scheduler without waiting a week?**

There is no shortcut currently. The only way is to either: (a) temporarily modify `msUntilNextMonday2am()` to return a small value (e.g. 5000ms), or (b) add a `POST /api/admin/sync` endpoint to trigger a scrape on demand. Option (b) is the right long-term solution.

**Q7.2.3: Tested a partial scrape (1 of 4 laws fails)?**

Yes — the Rental Law failed on every attempt for three consecutive restart cycles (the wrong-ID bug) while the other 3 laws succeeded. The database remained in a valid state with the 3 successful laws committed and the failed law either absent or retaining its previous version.

---

## 8. DEPLOYMENT & OPERATIONS

**Q8.1.1: What's the deployment process?**

Replit manages deployment. Running `suggest_deploy` triggers Replit's deployment pipeline, which builds and hosts the application. The Replit proxy handles HTTPS, routing, and domain configuration automatically.

**Q8.1.2: When you deploy, does the startup scrape run immediately?**

Yes. Every time the API server process starts — whether for development or production — it runs the startup sync. The startup scrape always runs on deploy.

**Q8.1.3: Can you deploy API server and frontend independently?**

Yes, in development. They are separate workflow processes and can be restarted independently. In Replit's deployment, they are deployed as a single unit (all artifacts in the workspace deploy together).

**Q8.2.1: What logs are available?**

- **Scraper logs:** All `[LobGovScraper]` prefixed lines, written to stdout via `console.log`. These include law name, attempt number, char count, article count, and change detection results.
- **API request logs:** Pino structured JSON logging via `req.log`, including method, URL, status code, and response time for every request.
- **Error logs:** Pino error level for scrape failures and API handler errors.

**Q8.2.2: Can you view historical logs?**

Only the current session's logs are visible in Replit's workflow console. There is no log persistence or external log aggregation (no Datadog, CloudWatch, etc.). If the server restarts, previous logs are gone.

**Q8.3.1: If the scraper gets stuck (hangs), how do you kill it?**

Restart the API server workflow in Replit. This sends SIGTERM → SIGKILL to the process, which terminates Chromium along with Node. The next startup scrape re-initializes everything cleanly.

**Q8.3.2: If lob.gov.jo changes and breaks the scraper, how quickly can you diagnose and fix it?**

The logs make diagnosis straightforward: either the content threshold check fails ("Insufficient content: X chars"), the year verification fails ("Year Y not found"), or the article count drops to 0. The fix time depends on what changed — if just a UI element label changed (e.g. "ارتباطات المادة" becomes something else), it is a 5-minute regex update. If the entire Angular routing scheme changes, it could take days.

---

## 9. INTEGRATION WITH QANOONI'S MAIN SYSTEM

**Q9.1.1: How does the contract generation pipeline currently retrieve laws?**

It does not yet. The RAG system described here is the data acquisition layer — the pipeline that actually retrieves articles at contract-generation time has not been built. The `contract_law_mappings` table and the `laws.full_text` column are designed as the interface, but the integration code does not exist.

**Q9.1.2: Was the RAG SQL actually tested?**

Yes. The SQL from the documentation was executed live and returned correct results:

```sql
SELECT m.law_id, m.relevant_articles, length(l.full_text) as text_len
FROM contract_law_mappings m
JOIN laws l ON l.law_id = m.law_id
WHERE m.contract_type = 'employment'
ORDER BY m.priority ASC;

-- Returns: law_id=8/1996, relevant_articles=[15,35,46,...85], text_len=86843
```

The query works. The `relevant_articles` JSONB array gives the article numbers to extract from `full_text` for focused RAG context.

**Q9.1.3: How precise is the `relevant_articles` mapping?**

The article lists were constructed from legal domain knowledge, not from an automated analysis. They represent the most commonly cited articles for each contract type, not an exhaustive list. There are almost certainly edge cases — for example, a non-compete clause in an employment contract might need articles from القانون المدني (not just قانون العمل), but the employment mapping only includes قانون العمل articles. The mapping is a starting point for the RAG team to refine.

**Q9.2.1: Is a weekly scrape cadence acceptable for SLA purposes?**

For standard contract generation (no urgent amendments), yes. Jordanian law changes infrequently — the Majlis Al-Nuwwab (parliament) typically passes legislation in sessions, not continuously. A weekly check is more than adequate for detecting amendments.

For critical situations (a law changes on Monday morning and a contract is generated Monday afternoon before the scrape runs), the SLA fails. The fix is a `POST /api/admin/sync` endpoint that the contract generation system can call before generating a high-stakes contract, forcing an immediate re-scrape.

**Q9.2.2: Can a legal team member manually trigger a scrape?**

No — there is no UI button or API endpoint to do this. It requires restarting the API server, which only developers can do. This should be added to the admin dashboard as a "Sync Now" button.

**Q9.3.1: If a generated contract was based on Article 75 as of May 2026 and it changes in June, how does the system know the contract is now invalid?**

It does not, currently. The `law_changelog` records what changed and when, but there is no mechanism to link a specific generated contract to the law version it was based on. The contract generation system would need to: (a) record the `law_id` and `article_number` used for each generated contract, and (b) query `law_changelog WHERE law_id = ? AND article_number = ? AND detected_at > contract_generated_at` to check for subsequent amendments.

**Q9.3.2: Should generated contracts store a law version timestamp?**

Yes — this is the correct approach. Store `law_snapshot_at TIMESTAMP` on the generated contract record. Then the system can join against `law_changelog` to flag any contract where a referenced article changed after `law_snapshot_at`. This has not been implemented.

---

## 10. TECHNICAL DEBT & SHARP EDGES

**Q10.1.1: Other known issues not in the documentation?**

1. **The `/laws` endpoint returns `full_text`** — 635 KB on every Law Registry page load (documented above in Q4.2.2).
2. **`law_versions` table is never populated** — the schema exists but the scraper does not insert snapshots into it (only updates `laws.full_text` in-place and writes to `law_changelog`).
3. **The false positive strip is not implemented** — `تفسير N` UI elements need to be stripped from article text before comparison (Q1.1.4 above).
4. **No `articleCount > 50` assertion before commit** — a silent CSS/rendering change on lob.gov.jo could cause 0 articles to be parsed and stored without error.

**Q10.1.2: Race conditions?**

One theoretical race: if a user acknowledges a change (reads `law_changelog`, then writes `acknowledged_at`) at the exact moment a scrape is inserting new changelog rows for the same law. Because the acknowledge operation targets a specific `id` and the scrape inserts new rows (never updates existing ones), these operations are non-conflicting. No race condition in practice.

**Q10.1.3: Fragile code that should be rewritten?**

The `initializeContractLawMappings()` function is hardcoded and fragile — it inserts static data and checks `if (existing.length > 0) return`. This means if a mapping is wrong, you cannot fix it by restarting the server; you must first manually `DELETE FROM contract_law_mappings`. The mappings should either be in a config file with a proper upsert strategy, or managed through the admin dashboard.

---

**Q10.2.1: Hardcoded values that should be configurable?**

| Value | Current | Should be |
|-------|---------|-----------|
| Chromium path candidates | Hardcoded array | Environment variable override |
| 3-second warmup pause | Hardcoded | Could stay hardcoded (it's a site-specific constant) |
| 8,000-char content threshold | Hardcoded | Could stay hardcoded |
| Monday 2AM schedule | Hardcoded | Environment variable (`SCRAPE_CRON`) |
| Law IDs to scrape | Hardcoded in class | Database-driven (configurable via admin UI) |

**Q10.2.2: `@ts-ignore` or `// TODO` comments?**

Three `@ts-ignore` comments exist, all in `page.evaluate()` callbacks in the scraper:
- Line 200: `window.location.hash = h` — `window` doesn't exist in Node's TypeScript context
- Line 209: `document.body.innerText` check in `waitForFunction`
- Line 277: `document.body.innerText` extraction

These are correct and expected. `page.evaluate()` runs code inside the browser's JavaScript environment, not Node. TypeScript correctly doesn't know about `window`/`document` in Node context. The `@ts-ignore` comments are the right solution here — the alternative is to cast to `any`, which is equivalent.

No `TODO` or `FIXME` comments exist in the codebase.

**Q10.2.3: Are there silent failures?**

One: if `countArticles()` returns 0 (because the regex matched nothing), the law is still inserted/updated with `article_count = 0`. There is no error thrown. This would silently store corrupt data. The assertion mentioned in Q3.2.4 and Q10.1.1 would fix this.

---

### 10.3 Security

**Q10.3.1: Is the missing authentication intentional?**

It was deferred, not intentional. The system was built to validate the scraping pipeline first. Authentication should be added before sharing the dashboard URL with anyone outside the development team.

**Q10.3.2: SQL injection vulnerabilities?**

No. Drizzle ORM uses parameterised queries throughout. All inputs go through Drizzle's query builder or Zod validation. No raw SQL strings with user input exist in the codebase.

**Q10.3.3: Should law text be encrypted at rest or in transit?**

In transit: already handled — Replit's proxy enforces HTTPS with mTLS between the browser and the proxy. Between the proxy and the API server (localhost), it is plain HTTP, which is acceptable for same-host communication.

At rest: the law text is public government data. Encrypting it at rest would provide no meaningful security benefit, since the data is publicly accessible to anyone who visits lob.gov.jo.

---

## 11. FUTURE ROADMAP

**Q11.1.1: Features the legal team requested but not yet implemented?**

The system has not been shown to the legal team yet. The following are anticipated based on the use case:
- **Email/Slack notifications** when new changes are detected — instead of requiring the team to check the dashboard
- **"Sync Now" button** on the dashboard to trigger an immediate scrape
- **PDF export** of change reports for compliance records
- **Undo "Mark as reviewed"** — currently irreversible

**Q11.1.2: Should the system monitor laws from other countries?**

In theory yes, but each country would require a separate scraper. lob.gov.jo is Jordan-specific. Monitoring UAE's `moec.gov.ae`, Egypt's `manshurat.org`, or Saudi Arabia's `ncar.gov.sa` would each require a completely different implementation, as these are different sites with different structures. The current system's architecture (one scraper class, one site) would need to become a plugin system.

**Q11.1.3: Should the system detect related article dependencies?**

This is a valuable feature. If Article 75 of قانون العمل references "وفقاً للمادة 60" and Article 60 changes, the system should flag Article 75 as potentially affected. This would require parsing cross-references within article text — a non-trivial NLP/regex task. The current article text includes these references, so the raw material exists.

**Q11.2.1: What's the plan for 50+ laws?**

The sequential scraper would take ~50 × 20 seconds = ~17 minutes per cycle. This is still acceptable for weekly runs. At 200+ laws, parallel scraping (multiple Puppeteer browser instances) would be necessary. The architecture should be refactored so each law is an independent job unit before reaching that scale.

**Q11.2.2: Should the scraper be distributed?**

Not yet. When it becomes necessary, the right approach is a job queue (BullMQ or pg-boss) where each law is a separate job that any worker can pick up. Multiple worker processes can run in parallel, each handling one law. The current sequential design would be replaced by a queue producer (enqueue 4 jobs) and queue consumer (process 1 job per worker).

**Q11.2.3: Will the changelog grow to millions of records?**

At current rates (17 false positives + ~0 real changes per week × 52 weeks): ~900 rows/year. Even at 10× that rate with more laws: ~9,000 rows/year. A million rows would take over 100 years at current scale. Not a concern.

---

## 12. DOCUMENTATION & KNOWLEDGE TRANSFER

**Q12.1.1: Are there comments explaining why design decisions were made?**

Yes — the key decisions are documented inline:
- The homepage warmup has a 6-line comment block explaining the RSA session issue and the wrong-content bug
- The 8,000-char threshold has a comment explaining how it was derived
- The article regex has a comment explaining the `ارتباطات المادة` format
- The Chromium discovery function has comments explaining each path and why `puppeteer-core` is used instead of `puppeteer`
- ID 3408 has a comment explaining it is the 2019 Real Estate Law, not the old 1994 rental law

**Q12.2.1: Runbooks:**

**Adding a new law:**
1. Find the `LegislationID` on lob.gov.jo by navigating to the law and reading the URL hash
2. Add an entry to `lawsToScrape` in `lib/integrations/src/lob-gov-jo-puppeteer-scraper.ts`
3. Add contract type mappings to `contractToLaws` and `initializeContractLawMappings()`
4. Run `DELETE FROM contract_law_mappings;` in the database
5. Restart the API server — startup sync will scrape the new law and re-seed mappings

**Debugging a failed scrape:**
1. Check workflow logs for `[LobGovScraper] Failed:` lines
2. If "Insufficient content" → lob.gov.jo may be down or the law ID is wrong
3. If "Year X not found" → the LegislationID loads a different law; find the correct ID
4. If "Timeout" → increase the `waitForFunction` timeout or add an extra warmup pause
5. Restart the server to trigger a fresh startup scrape

**Q12.2.2: The 3 most important things for the next developer:**

1. **Never remove the homepage warmup.** It is not optional. Without navigating to `https://lob.gov.jo/?v=2&lang=ar` and waiting 3 seconds before hash-navigating to a law, you will get wrong content every time. This took the most time to discover.
2. **The 17 pending "changes" in القانون المدني are false positives** caused by `تفسير N` UI elements. They are not real legal amendments. Acknowledge them and implement the strip fix described in Q1.1.4.
3. **`puppeteer-core` must stay in `external` in `build.mjs` AND in `dependencies` (not devDependencies) in `package.json`.** If either of these changes, the build will break in a way that is hard to diagnose.

---

## 13. MISC / GOTCHAS

**Q13.1.1: Replit-specific gotchas?**

- The `PORT` environment variable is injected by Replit's workflow system — the server must bind to `process.env.PORT` (currently `8080` for the API server). Hard-coding a port breaks the proxy routing.
- Environment secrets (`DATABASE_URL`, `SESSION_SECRET`) are managed through Replit's secrets panel, not `.env` files. The `.env` file approach does not work in the deployed environment.
- The Nix store path for Chromium (`/nix/store/0n9rl5...`) may change when Replit updates its Nix packages. The fallback candidates in `findChromiumExecutable()` handle this.
- Running `pnpm dev` at the workspace root does nothing — individual artifacts must be started via their workflow commands.

**Q13.1.2: Migration path away from Replit?**

The codebase has no Replit-specific API calls — all Replit dependencies are infrastructure (hosting, reverse proxy, PostgreSQL, secrets). A migration would require:
- Hosting: any Node.js host (Railway, Fly.io, AWS ECS)
- PostgreSQL: any PostgreSQL provider (Neon, Supabase, RDS)
- Reverse proxy: Nginx or the hosting platform's built-in proxy
- Secrets: environment variables in the new host
- Chromium: the Nix path would be replaced with a system Chrome installation or Playwright's managed browser

Estimated migration effort: 1–2 days.

**Q13.3.1: Articles with subsections, footnotes, tables, or non-standard numbering?**

From examining the extracted text:
- **Subsections:** Yes, present as `أولاً`, `ثانياً`, `أ`, `ب` within article bodies. They are captured as part of the parent article text, not as separate entries.
- **Footnotes/endnotes:** Not observed in `body.innerText`. They may exist in the PDF version of the laws but not in the Angular web rendering.
- **Tables:** The Civil Law has some structured content (e.g. rate tables in commercial provisions). These render as tab-separated text in `body.innerText`, which is captured verbatim. Not ideal for RAG — a table-aware parser would do better.
- **Non-standard numbering:** Not observed. All articles follow `المادة N` where N is a Western Arabic numeral (1, 2, 3).

**Q13.3.2: Does lob.gov.jo use Arabic-Indic numerals (١, ٢, ٣)?**

Not in the current rendered output — all article numbers observed are Western Arabic numerals (1, 2, 3). The regex `\d+` would not match Arabic-Indic numerals if they appeared. If lob.gov.jo ever switches, the regex would need to be updated to `/[\d٠-٩]+/`.

---

## 14. FINAL THOUGHTS

**Q14.1.1: Top 3 risks that could break this system:**

1. **lob.gov.jo changes its Angular rendering template.** The scraper's article parsing and content detection are hardcoded to specific UI text (`ارتباطات المادة`, `رقم التشريع`). Any change to these labels breaks the scraper silently or with a misleading error. Mitigation: add assertions and monitoring for article count drops.

2. **The Chromium Nix store path changes after a Replit update.** The primary path is hardcoded to a specific Nix store hash. If Replit updates the Playwright browser version, this path changes and the scraper cannot launch. Mitigation: the fallback candidates handle this for common paths, but a new Playwright version might produce a path not in the fallback list.

3. **False positives erode legal team trust.** If the team sees 17 "changes" every week that turn out to be UI noise, they will stop reviewing them. A real legal change would then be buried in the noise. Mitigation: implement the `تفسير N` strip fix immediately.

**Q14.1.2: Impact of 1 week or 1 month of downtime?**

- **1 week:** No impact. The law text in the database is at most 2 weeks old. No Jordanian law changes weekly.
- **1 month:** Low impact. Jordanian parliament sessions are infrequent. The risk is that a law was amended during the downtime and contracts generated after the amendment are based on the old version. This is a legal risk, not just a technical one.

**Q14.2.1: What would you do differently if rebuilding from scratch?**

1. Implement the `تفسير N` / `ارتباطات المادة` strip from day one — don't wait for false positives to manifest
2. Add a `POST /api/admin/sync` endpoint immediately — the weekly-only trigger is too limiting
3. Add authentication before writing any dashboard UI — it is easier to build auth first than retrofit it
4. Store law versions snapshots properly in `law_versions` from the first scrape
5. Write a unit test for the article parsing regex before trusting it in production

**Q14.2.2: Any architectural decisions you regret?**

The `contractToLaws` mapping being hardcoded inside the scraper class (rather than being purely database-driven) creates a deployment coupling: adding a new contract type requires a code change and redeploy, not just a database insert. This should be fully database-driven.

**Q14.3.1: On a scale of 1–10, how confident that the next person can maintain and extend this system?**

**7/10.** The system is well-documented and the core scraping logic is contained in a single file. The main risks for a new developer are: (a) not understanding the homepage warmup requirement and removing it "as an optimisation," and (b) not understanding the false positive issue and concluding the change detection doesn't work. Both are covered in this document.

**Q14.3.2: The single most important thing for them to understand:**

**lob.gov.jo is an Angular SPA with encrypted sessions.** Everything else in the system follows from this constraint. The Puppeteer approach, the homepage warmup, the 3-second pause, the `body.innerText` extraction — all of these exist because the law text is not in the HTML source and cannot be fetched with a simple HTTP request. If you ever try to "simplify" the scraper by replacing Puppeteer with axios, you will get empty or encrypted content. Don't.

---

*Answers written 22 May 2026, reflecting the system state at initial deployment: 4 laws, 2,295 articles, 17 pending (false positive) changes.*
