# Qanooni AI — Legal RAG System: Full Technical Documentation

> **Purpose:** This document is the single source of truth for the Qanooni AI legal intelligence backend. It explains what the system does, how every component works, why it was built this way, and what a developer needs to know to extend or maintain it.

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Architecture Diagram](#2-architecture-diagram)
3. [The Target Website: lob.gov.jo](#3-the-target-website-lobgovjo)
4. [The Scraper — Deep Technical Walkthrough](#4-the-scraper--deep-technical-walkthrough)
5. [Database Schema](#5-database-schema)
6. [API Server](#6-api-server)
7. [Admin Dashboard (Frontend)](#7-admin-dashboard-frontend)
8. [Scheduler — Automatic Weekly Sync](#8-scheduler--automatic-weekly-sync)
9. [Contract-Law Mappings](#9-contract-law-mappings)
10. [Current Data in the Database](#10-current-data-in-the-database)
11. [Monorepo Structure](#11-monorepo-structure)
12. [How Change Detection Works](#12-how-change-detection-works)
13. [Known Issues & Sharp Edges](#13-known-issues--sharp-edges)
14. [Extending the System](#14-extending-the-system)

---

## 1. System Overview

Qanooni AI is a Jordanian legal technology company that generates contracts and legal documents. Its AI needs to know the current text of Jordanian law to do this correctly. When laws change — for example, when the Jordanian parliament amends the Labor Law — any AI-generated employment contract based on old articles could be legally invalid.

This system solves three problems:

1. **Acquisition** — Automatically fetches the full text of Jordanian laws from the official legislative database (`lob.gov.jo`) and stores them in PostgreSQL.
2. **Change detection** — On each weekly fetch, compares the new text article-by-article against the stored version and records exactly which articles changed, were added, or were removed.
3. **Human review** — Surfaces detected changes to the Qanooni legal team via an Arabic RTL admin dashboard so they can review, understand, and acknowledge each change before it affects AI-generated output.

The system currently monitors **4 laws, 2,295 articles** totalling ~635 KB of legal text scraped from the official Jordanian government website.

---

## 2. Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                        lob.gov.jo                               │
│            (Angular SPA + RSA-encrypted sessions)               │
└───────────────────────────┬─────────────────────────────────────┘
                            │  Puppeteer (headless Chromium)
                            │  Homepage warmup → hash navigation
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│              lib/integrations — LobGovJoPuppeteerScraper        │
│                                                                 │
│  • Launches Chromium                                            │
│  • Warms up Angular session (RSA key exchange)                  │
│  • Navigates to each law via hash URL                           │
│  • Extracts body.innerText (plain text, 86–277 KB per law)      │
│  • Parses article boundaries (regex on Arabic article headings) │
│  • Compares article-by-article vs. stored version               │
│  • Writes new/changed articles to PostgreSQL                    │
└───────────────────────────┬─────────────────────────────────────┘
                            │  Drizzle ORM
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                PostgreSQL Database (lib/db)                     │
│                                                                 │
│  laws                  — full text + metadata per law           │
│  law_versions          — historical snapshot on each change     │
│  law_changelog         — article-level diff log (the queue)     │
│  contract_law_mappings — which articles govern which contracts  │
└───────────────────────────┬─────────────────────────────────────┘
                            │  Drizzle ORM
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│          artifacts/api-server — Express 5 REST API              │
│                                                                 │
│  GET  /api/healthz                      — health check          │
│  GET  /api/admin/law-changes/laws       — list all laws         │
│  GET  /api/admin/law-changes/pending    — unreviewed changes    │
│  GET  /api/admin/law-changes/history    — full audit log        │
│  POST /api/admin/law-changes/:id/acknowledge — mark reviewed    │
└───────────────────────────┬─────────────────────────────────────┘
                            │  React Query (generated hooks)
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│          artifacts/legal-ai — Arabic RTL Admin Dashboard        │
│                                                                 │
│  Dashboard       — summary tiles + pending action items         │
│  Pending Reviews — article diffs + "Mark as reviewed" button    │
│  Law Registry    — searchable list of all monitored laws        │
│  Change History  — audit log of every detected change           │
└─────────────────────────────────────────────────────────────────┘
```

---

## 3. The Target Website: lob.gov.jo

`lob.gov.jo` is the official Bureau of Legislation and Opinion of Jordan — the government's legislative database.

### Why it's hard to scrape

| Challenge | Details |
|-----------|---------|
| **Angular SPA** | The site is a single-page Angular application. The actual law text is not present in the raw HTML — it is fetched via encrypted API calls and rendered client-side. This makes `axios` + `cheerio` completely useless. |
| **RSA encryption** | The Angular app performs an RSA key exchange on startup. Law content is served encrypted and decrypted in the browser's JavaScript engine. There is no way to call the underlying API directly — the RSA keys change per session. |
| **Hash routing** | Navigation happens via URL hash fragments (e.g. `##!/LegislationDetails?LegislationID=536`). The server never serves different HTML — only the hash changes, which triggers Angular's router. |
| **Session caching bug** | If you navigate directly to a law's deep-link URL without first loading the homepage, Angular loads incorrect cached/wrong content. The RSA session must be initialized from the homepage first. |

### Law IDs

Each law on lob.gov.jo has an internal numeric `LegislationID` that is independent of the law's official number. These were discovered by manually navigating the site:

| Official ID | LegislationID | Law Name |
|-------------|---------------|----------|
| 8/1996 | 3392 | قانون العمل |
| 43/1976 | 536 | القانون المدني |
| 13/2019 | 3408 | قانون الملكية العقارية |
| 12/1966 | 1028 | قانون التجارة |

`LegislationType=2` in the URL corresponds to قانون (primary law). This parameter does not actually filter content server-side but is required by Angular's router.

---

## 4. The Scraper — Deep Technical Walkthrough

**File:** `lib/integrations/src/lob-gov-jo-puppeteer-scraper.ts`

The scraper is implemented as a class `LobGovJoPuppeteerScraper` with a clear lifecycle: `initialize()` → `updateAllLaws()` → `initializeContractLawMappings()` → `shutdown()`.

### 4.1 Chromium Discovery

The scraper uses `puppeteer-core` (not `puppeteer`) so it does not auto-download Chromium. Instead, it searches a priority-ordered list of known Chromium paths at runtime:

```
/nix/store/0n9rl5l9syy808xi9bk4f6dhnfrvhkww-playwright-browsers-chromium/chromium-1080/chrome-linux/chrome  ← preferred
/nix/store/ia69plrrvn7czdhn3flq1ll39i92ixab-chromium-92.0.4515.159/bin/chromium
/usr/bin/chromium-browser
/usr/bin/chromium
/usr/bin/google-chrome
/usr/bin/google-chrome-stable
```

The first path that `existsSync()` returns true for is used. This makes the scraper portable across different Replit Nix environments.

### 4.2 Browser Launch Flags

```
--no-sandbox              # required in containerized/Replit environments
--disable-setuid-sandbox  # same
--disable-dev-shm-usage   # prevents crashes when /dev/shm is small
--disable-gpu             # no GPU in headless server environments
--single-process          # reduces memory usage
--no-zygote               # prevents Chromium's zygote process from forking
```

### 4.3 The Fetch Loop — 3-Step Process Per Law

Each law goes through this exact sequence:

#### Step 1: Homepage Warmup (CRITICAL)

```typescript
await page.goto("https://lob.gov.jo/?v=2&lang=ar", {
  waitUntil: "networkidle0",
  timeout: 60000,
});
await new Promise((resolve) => setTimeout(resolve, 3000));
```

This is the most important part of the whole scraper. Without this:
- The Angular app's RSA session is not initialized
- Navigating directly to a law URL causes Angular to load wrong/cached content (e.g. ID 3392 was loading a completely different law)
- The 3-second pause is required for the Angular bootstrap + RSA key exchange to fully complete before the hash changes

#### Step 2: Hash Navigation

```typescript
const hash = `#!/LegislationDetails?LegislationID=${lawMeta.legislationId}&LegislationType=2&isMod=false`;
await page.evaluate((h) => {
  window.location.hash = h;
}, hash);
```

Changing the hash triggers Angular's router to load the specific law. Puppeteer does not navigate away from the page — it stays on `lob.gov.jo` and just changes the hash. This preserves the RSA session initialized in Step 1.

#### Step 3: Content Verification

```typescript
await page.waitForFunction(
  () => {
    const text = document.body.innerText || "";
    return (
      text.includes("رقم التشريع") &&   // "Legislation Number" label
      text.includes("سنة التشريع") &&   // "Legislation Year" label
      text.length > 8000                // substantial content loaded
    );
  },
  { timeout: 45000, polling: 1000 }
);
```

Three conditions must all be true:
1. The page contains "رقم التشريع" — the Arabic label that appears in law metadata
2. The page contains "سنة التشريع" — confirms the metadata section rendered
3. `body.innerText` is more than 8,000 characters

The 8,000-character threshold is derived from observation:
- Bare site shell (no law loaded): ~2,400 chars
- Partial/wrong-law load: ~3,276 chars
- Any real law: ≥8,000 chars (the smallest monitored law has 86,843 chars)

After the wait function resolves, an additional 2-second buffer is added for any trailing Angular digest cycles.

### 4.4 Text Extraction

```typescript
return document.body.innerText?.trim() ?? "";
```

`body.innerText` is used rather than `innerHTML` or `textContent` because:
- `innerHTML` includes Angular template markup and attributes
- `textContent` includes hidden elements and script content
- `innerText` returns only the rendered, visible text — exactly what a human would see and read

The extracted text is then normalized:
```typescript
.replace(/[ \t]+/g, " ")     // collapse inline whitespace
.replace(/\n{3,}/g, "\n\n")  // collapse excess blank lines
.trim()
```

### 4.5 Article Parsing

lob.gov.jo renders article headings in this format:

```
المادة 1 ارتباطات المادة
[article text here]

المادة 2 ارتباطات المادة
[article text here]
```

The phrase "ارتباطات المادة" (article relationships/links) appears after every article number as part of the UI chrome — it's Angular's link to related articles. The regex accounts for this:

```typescript
const regex =
  /المادة\s+(\d+)(?:\s+ارتباطات المادة)?\s+([\s\S]+?)(?=المادة\s+\d+(?:\s+ارتباطات المادة)?|$)/g;
```

This captures:
- Group 1: the article number (e.g. `1`, `142`, `1449`)
- Group 2: the article body text (everything until the next article heading or end of string)

The result is a `Record<string, string>` mapping article number → article text, used for diff comparison.

### 4.6 Retry Strategy

Each law gets up to 3 attempts with exponential backoff:
- Attempt 1: immediate
- Attempt 2: 3-second delay after failure
- Attempt 3: 6-second delay after failure

A law only fails the entire cycle if all 3 attempts fail. Partial success (some laws succeed, some fail) is logged and handled gracefully — the successful laws are committed to the database.

---

## 5. Database Schema

**File:** `lib/db/src/schema/laws.ts`

### Table: `laws`

The primary store — one row per monitored law, always reflecting the most recently scraped version.

| Column | Type | Description |
|--------|------|-------------|
| `id` | serial PK | Internal auto-increment ID |
| `law_id` | varchar(50) UNIQUE | Human-readable ID: `number/year` (e.g. `43/1976`) |
| `arabic_name` | text | Official Arabic name (e.g. `القانون المدني`) |
| `english_name` | text | English translation |
| `year` | varchar(4) | Year of the law |
| `full_text` | text | The complete rendered text of the law (can be 277KB+) |
| `article_count` | integer | Number of distinct articles parsed |
| `last_updated` | timestamp | When the law was last scraped and stored |
| `lob_gov_url` | text | Direct URL to the law on lob.gov.jo |
| `is_active` | boolean | Whether the law is currently in force |
| `created_at` | timestamp | When first inserted into this database |

### Table: `law_versions`

Historical snapshots. Every time a change is detected, the old text is preserved here before overwriting `laws.full_text`.

| Column | Type | Description |
|--------|------|-------------|
| `id` | serial PK | |
| `law_id` | varchar(50) | Foreign key to `laws.law_id` |
| `version` | integer | Incremental version number |
| `full_text` | text | Complete snapshot of the law text at this version |
| `changes_summary` | text | Human-readable summary of what changed |
| `amendment_date` | timestamp | When the amendment took effect |
| `created_at` | timestamp | When this snapshot was recorded |

### Table: `law_changelog`

Article-level diff log. This is the core queue that drives the admin dashboard's Pending Reviews page.

| Column | Type | Description |
|--------|------|-------------|
| `id` | serial PK | |
| `law_id` | varchar(50) | Which law this change belongs to |
| `article_number` | integer | Which article was affected |
| `change_type` | varchar(20) | One of: `added`, `modified`, `removed` |
| `old_text` | text | Previous article text (null if `added`) |
| `new_text` | text | New article text (null if `removed`) |
| `affected_contract_types` | jsonb | Array of contract types impacted (e.g. `["employment"]`) |
| `detected_at` | timestamp | When the scraper detected this change |
| `notified` | boolean | Whether the team was notified |
| `acknowledged_at` | timestamp | When a reviewer marked it as reviewed (null = pending) |

### Table: `contract_law_mappings`

Static configuration table linking contract categories to the laws and specific articles that govern them. Used by the RAG pipeline to know which articles to retrieve for a given contract type.

| Column | Type | Description |
|--------|------|-------------|
| `id` | serial PK | |
| `contract_type` | varchar(50) | e.g. `employment`, `rental`, `service`, `nda`, `supplier` |
| `law_id` | varchar(50) | Which law governs this contract type |
| `relevant_articles` | jsonb | Array of article numbers specifically relevant |
| `priority` | integer | `1` = primary law, `2` = secondary/supplementary |
| `created_at` | timestamp | |

---

## 6. API Server

**Directory:** `artifacts/api-server/src/`

Built with Express 5, TypeScript, and Drizzle ORM. Compiled with esbuild into a single CJS bundle. Serves on `PORT` (default 8080), behind the Replit reverse proxy at `/api`.

### Endpoints

#### `GET /api/healthz`

Returns `{ status: "ok" }`. Used by the Replit proxy and monitoring to confirm the server is alive.

#### `GET /api/admin/law-changes/laws`

Returns all laws stored in the database with their metadata.

**Response:**
```json
[
  {
    "lawId": "43/1976",
    "arabicName": "القانون المدني",
    "englishName": "Civil Law",
    "year": "1976",
    "articleCount": 1449,
    "lastUpdated": "2026-05-22T14:43:00Z",
    "lobGovUrl": "https://lob.gov.jo/...",
    "isActive": true
  }
]
```

#### `GET /api/admin/law-changes/pending`

Returns all unreviewed changes (where `acknowledged_at IS NULL`), grouped by law.

**Response:**
```json
[
  {
    "lawId": "43/1976",
    "lawName": "القانون المدني",
    "changesCount": 17,
    "affectedContractTypes": ["rental", "service", "nda", "supplier"],
    "changes": [
      {
        "id": 1,
        "articleNumber": 5,
        "changeType": "modified",
        "oldText": "...",
        "newText": "...",
        "detectedAt": "2026-05-22T14:43:00Z"
      }
    ]
  }
]
```

#### `GET /api/admin/law-changes/history`

Returns a flat, chronological list of all changes ever recorded (both pending and acknowledged). Used for the audit log page.

#### `POST /api/admin/law-changes/:changeId/acknowledge`

Marks a single change record as reviewed. Sets `acknowledged_at = NOW()` and `notified = true`.

### Build System

esbuild compiles the entire API server into `dist/index.mjs`. `puppeteer-core` is in the `external` list because it is a native binary that cannot be bundled:

```javascript
// artifacts/api-server/build.mjs
external: ["puppeteer-core", ...]
```

`puppeteer-core` is in `dependencies` (not `devDependencies`) so it is available at runtime after build.

### API Contract (Code Generation)

The OpenAPI spec at `lib/api-spec/openapi.yaml` defines all endpoints and schemas. Running `pnpm --filter @workspace/api-spec run codegen` (via Orval) generates:
- **`lib/api-client-react`** — React Query hooks (`useGetAdminLawChangesLaws`, `usePostAdminLawChangesAcknowledge`, etc.)
- **`lib/api-zod`** — Zod schemas for all request/response types

The frontend uses these generated hooks directly — no hand-written `fetch` calls.

---

## 7. Admin Dashboard (Frontend)

**Directory:** `artifacts/legal-ai/src/`

Built with React + Vite, TypeScript, Tailwind CSS, Shadcn UI components. Fully Arabic RTL — the HTML `dir="rtl"` attribute is set at the root, and the Tajawal font is used throughout for proper Arabic rendering.

### Routing

`wouter` handles client-side routing:

| Path | Page |
|------|------|
| `/` | Dashboard |
| `/pending` | Pending Reviews |
| `/laws` | Law Registry |
| `/history` | Change History |

### Pages

#### Dashboard (`/`)

The home page for the operations team. Shows three summary tiles:

- **Total Stored Laws** — count of laws in the database
- **Pending Reviews** — count of unreviewed change groups
- **System Status** — always shows "Operational" (API is alive)

Below the tiles: a **Priority Action Items** panel listing every law that has unreviewed changes, with a "Review" button linking to Pending Reviews. If no changes are pending, it shows "All caught up."

A **Recently Monitored Laws** panel lists all laws with their IDs and Arabic names.

#### Pending Reviews (`/pending`)

The core workflow page. Each card represents a law with unreviewed changes and shows:
- The law name and count of unreviewed articles
- For each changed article: a side-by-side diff — the old text (red/strikethrough) on the right, new text (green) on the left (RTL layout)
- The change type badge: Added / Modified / Removed
- The date detected
- Which contract types are affected (employment, rental, etc.)
- A "Mark as reviewed" button that calls `POST /api/admin/law-changes/:id/acknowledge`

#### Law Registry (`/laws`)

A searchable table of all monitored laws:
- Law ID (e.g. `43/1976`)
- Arabic name
- English name
- Article count
- Active status badge
- Direct link to the law on lob.gov.jo

#### Change History (`/history`)

A chronological audit log of every detected change — both pending and already reviewed. Each row shows:
- Law ID
- Article number
- Change type
- Detection date
- Status: **Reviewed** (green) or **Pending** (amber)

### UI Design

- **Sidebar**: Dark navy (`#0f172a`) with white text, Qanooni AI branding
- **Content area**: Clean white/light grey, standard Shadcn card design
- **RTL**: All text, layout, and flex direction respects Arabic reading direction (right-to-left)
- **Font**: Tajawal — a Google Font designed for Arabic with Latin support

---

## 8. Scheduler — Automatic Weekly Sync

**File:** `artifacts/api-server/src/lib/law-update-scheduler.ts`

The scheduler runs as part of the API server process — no separate worker needed.

### Startup Behaviour

When the API server starts, it immediately runs `runLawSync("Startup")` in the background (non-blocking — the server accepts requests while scraping continues). This ensures laws are always fresh on deploy without waiting a week.

### Weekly Schedule

After startup, the scheduler computes the milliseconds until the next **Monday at 2:00 AM** and sets a `setTimeout`. When that fires, it runs the full scrape cycle and then immediately schedules the next Monday 2AM.

```
Server start → scrape now
            → setTimeout(next Monday 2AM)
            → scrape again
            → setTimeout(next Monday 2AM)
            → ... (repeats indefinitely)
```

### runLawSync lifecycle

```
lobGovScraper.initialize()                  // launch Chromium
lobGovScraper.updateAllLaws()               // scrape all 4 laws
lobGovScraper.initializeContractLawMappings() // seed mappings if empty
lobGovScraper.shutdown()                    // close browser
```

The browser is always shut down in a `finally` block, even if a law fails mid-cycle, to prevent Chromium process leaks.

---

## 9. Contract-Law Mappings

This table tells the RAG system which laws and articles are relevant to each contract type. It is seeded once on first startup (if the table is empty) and is considered stable configuration.

| Contract Type | Primary Law | Key Articles | Secondary Law | Key Articles |
|---------------|-------------|--------------|---------------|--------------|
| **employment** | قانون العمل 8/1996 | 15, 35, 46, 56–85 | — | — |
| **rental** | قانون الملكية العقارية 13/2019 | 1–15 | القانون المدني 43/1976 | 192–200 |
| **service** | القانون المدني 43/1976 | 750–755 | — | — |
| **nda** | القانون المدني 43/1976 | 143–145 | — | — |
| **supplier** | القانون المدني 43/1976 | 300–304 | قانون التجارة 12/1966 | 1–5 |

**Priority 1** = primary governing law for that contract type.
**Priority 2** = supplementary law providing additional provisions.

The `affected_contract_types` field in `law_changelog` is populated at scrape time using this mapping. So when Article 75 of قانون العمل changes, the changelog entry automatically tags it `["employment"]`, alerting the team that employment contracts may need to be regenerated.

---

## 10. Current Data in the Database

As of the initial scrape (22 May 2026):

| Law ID | Arabic Name | English Name | Articles | Size | Scraped |
|--------|-------------|--------------|----------|------|---------|
| 43/1976 | القانون المدني | Civil Law | 1,449 | 277 KB | 2026-05-22 |
| 12/1966 | قانون التجارة | Commercial Law | 480 | 150 KB | 2026-05-22 |
| 13/2019 | قانون الملكية العقارية | Real Estate Property Law | 224 | 119 KB | 2026-05-22 |
| 8/1996 | قانون العمل | Labor Law | 142 | 86 KB | 2026-05-22 |
| **Total** | | | **2,295** | **~635 KB** | |

### Contract Mappings Seeded

7 mapping records across 5 contract types are active in the database.

### Changelog

17 article-level changes were recorded in القانون المدني (43/1976) between two consecutive scrapes during development (articles 5, 50, 53, 60, 449 — likely minor rendering differences). These appear as the "1 Pending Review" shown on the dashboard and can be acknowledged by the legal team.

---

## 11. Monorepo Structure

```
workspace/
├── artifacts/
│   ├── api-server/              ← Express API + scraper scheduler
│   │   ├── src/
│   │   │   ├── index.ts         ← server entry point
│   │   │   ├── lib/
│   │   │   │   ├── law-update-scheduler.ts  ← weekly sync
│   │   │   │   └── logger.ts
│   │   │   └── routes/
│   │   │       ├── health.ts
│   │   │       └── admin-law-changes.ts
│   │   ├── build.mjs            ← esbuild config (puppeteer-core external)
│   │   └── package.json         ← puppeteer-core in dependencies
│   │
│   └── legal-ai/                ← Arabic RTL admin dashboard
│       ├── src/
│       │   ├── App.tsx           ← routing
│       │   ├── pages/
│       │   │   ├── dashboard.tsx
│       │   │   ├── pending-reviews.tsx
│       │   │   ├── law-registry.tsx
│       │   │   └── change-history.tsx
│       │   └── components/
│       │       ├── sidebar.tsx
│       │       └── ui/           ← Shadcn components
│       └── index.html
│
├── lib/
│   ├── integrations/
│   │   └── src/
│   │       └── lob-gov-jo-puppeteer-scraper.ts  ← THE SCRAPER
│   │
│   ├── db/
│   │   └── src/
│   │       ├── index.ts          ← db singleton + table re-exports
│   │       └── schema/
│   │           └── laws.ts       ← all 4 table definitions
│   │
│   ├── api-spec/
│   │   ├── openapi.yaml          ← API contract (source of truth)
│   │   └── orval.config.ts       ← codegen configuration
│   │
│   ├── api-client-react/         ← generated React Query hooks (DO NOT EDIT)
│   └── api-zod/                  ← generated Zod schemas (DO NOT EDIT)
│
├── scripts/
│   └── src/
│       └── discover-law-ids.ts   ← one-time ID discovery script
│
└── pnpm-workspace.yaml
```

---

## 12. How Change Detection Works

This is the heart of the system's value. Here is the exact flow when a law changes on lob.gov.jo:

```
1. Scraper fetches new text for law X (e.g. 43/1976)
2. Compares new text to laws.full_text for law_id = '43/1976'
3. If identical → "No changes detected", stop
4. If different → call recordLawChanges('43/1976', oldText, newText)
   a. extractArticles(oldText) → { "1": "...", "2": "...", ... }
   b. extractArticles(newText) → { "1": "...", "2": "...", ... }
   c. For each article in newText not in oldText → INSERT changeType='added'
   d. For each article in oldText where text differs → INSERT changeType='modified', store both old+new text
   e. For each article in oldText not in newText → INSERT changeType='removed'
   f. Each record gets affectedContractTypes from contractToLaws mapping
5. UPDATE laws SET full_text = newText, last_updated = NOW()
6. Next API poll → pending count increments on dashboard
7. Legal team reviews each change on Pending Reviews page
8. Team clicks "Mark as reviewed" → POST /acknowledge → acknowledged_at set
9. Change moves from Pending to History
```

The diff is at the **article level**, not the character level. This means:
- If only Article 75 changes, only Article 75 appears in the review queue
- The legal team sees exactly which article changed and what it said before vs. after
- They can assess whether the change affects any generated contracts without reading the entire law

---

## 13. Known Issues & Sharp Edges

### The Homepage Warmup is Non-Negotiable

Without Step 1 (navigating to `https://lob.gov.jo/?v=2&lang=ar` and waiting 3 seconds), the scraper loads wrong content. This was discovered through testing where ID 3392 consistently loaded a completely different law when navigated to directly. Never remove or shorten this step.

### `puppeteer-core` Must Stay External in esbuild

If `puppeteer-core` is bundled by esbuild, it will try to bundle native Chromium binaries which breaks the build. It must remain in both:
- The `external` array in `artifacts/api-server/build.mjs`
- The `dependencies` (not `devDependencies`) in `artifacts/api-server/package.json`

### Law ID Format

Law IDs are stored as `{number}/{year}` strings (e.g. `43/1976`). This is the display ID — it is NOT the lob.gov.jo internal `LegislationID` (which is a large integer like `536`). These two IDs are completely different. Always use the display format as the primary key throughout the codebase.

### The Old Rental Law (11/1994) is Gone from lob.gov.jo

قانون الإيجار العقاري from 1994 no longer exists on lob.gov.jo. ID 3408 was previously assumed to be this law, but investigation revealed it is actually قانون الملكية العقارية (Real Estate Property Law) #13/2019. This newer law is the active governing legislation for real estate and rental matters in Jordan. The old 1994 law was repealed.

### Civil Law Article Count Variability

Between two consecutive scrapes, القانون المدني showed 17 "changed" articles. This is likely due to minor rendering differences (whitespace normalization, link text in "ارتباطات المادة" sections). The article regex strips the "ارتباطات المادة" label, but there may still be minor UI-generated content differences. If the legal team consistently sees many low-significance changes, the text normalization in `extractArticles` may need to be tightened.

---

## 14. Extending the System

### Adding a New Law to Monitor

1. Find the law on `lob.gov.jo` — navigate to it and note the `LegislationID` from the URL hash
2. Confirm the law loads correctly with the right year in its text
3. Add an entry to the `lawsToScrape` array in `lib/integrations/src/lob-gov-jo-puppeteer-scraper.ts`
4. Add its contract type mappings to `contractToLaws` and `initializeContractLawMappings()`
5. Restart the API server — the next startup sync will scrape the new law automatically

### Adding a New Contract Type

1. Add the new contract type to `contractToLaws` in the scraper
2. Add relevant article mappings in `initializeContractLawMappings()`
3. Clear the `contract_law_mappings` table in the database so mappings are re-seeded on next startup:
   ```sql
   DELETE FROM contract_law_mappings;
   ```
4. Restart the server

### Connecting to the RAG Pipeline

The `contract_law_mappings` table is designed as the input to any RAG retrieval step:

```sql
-- Get all relevant article numbers for a given contract type
SELECT m.law_id, m.relevant_articles, l.full_text
FROM contract_law_mappings m
JOIN laws l ON l.law_id = m.law_id
WHERE m.contract_type = 'employment'
ORDER BY m.priority ASC;
```

The `full_text` column contains the complete law text. Use `relevant_articles` as the article numbers to extract from `full_text` for focused RAG context.

### Forcing a Manual Re-Scrape

Restart the API server — it always runs a full scrape on startup. Alternatively, expose the scraper lifecycle as an API endpoint (e.g. `POST /api/admin/sync`) and call it manually.

---

*Document generated 22 May 2026. Reflects system state after initial scrape: 4 laws, 2,295 articles, 7 contract-law mappings.*
