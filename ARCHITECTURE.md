# Qanooni AI — Legal RAG System: Architecture Reference

> **Audience:** Developers joining the project. Covers every layer of the system — monorepo
> structure, database schema, scraper internals, API endpoints, authentication, change-detection
> algorithm, false-positive cleanup, RAG retrieval contract, and the admin frontend.

---

## Table of Contents

1. [What This System Does](#1-what-this-system-does)
2. [Monorepo Structure](#2-monorepo-structure)
3. [Tech Stack](#3-tech-stack)
4. [Database Schema](#4-database-schema)
5. [The Scraper — How It Works](#5-the-scraper--how-it-works)
6. [Change Detection Algorithm](#6-change-detection-algorithm)
7. [False-Positive Cleanup](#7-false-positive-cleanup)
8. [Weekly Scheduler](#8-weekly-scheduler)
9. [API Server — All Endpoints](#9-api-server--all-endpoints)
10. [Authentication](#10-authentication)
11. [RAG Retrieval — How the Contracts System Uses This](#11-rag-retrieval--how-the-contracts-system-uses-this)
12. [Contract-Law Mappings](#12-contract-law-mappings)
13. [Admin Dashboard (Frontend)](#13-admin-dashboard-frontend)
14. [Layered Architecture (Backend)](#14-layered-architecture-backend)
15. [Environment Variables](#15-environment-variables)
16. [Running the Project Locally](#16-running-the-project-locally)
17. [Known Sharp Edges](#17-known-sharp-edges)

---

## 1. What This System Does

Qanooni AI generates legal contracts for Jordanian law. Its AI must know the *current* text of
relevant laws — an outdated employment contract could be legally invalid if Parliament amended the
Labor Law.

This system solves three problems:

| Problem | Solution |
|---|---|
| Acquiring law text | Puppeteer scrapes `lob.gov.jo` (the official Jordanian legislative database) |
| Detecting changes | Article-by-article diffing against the stored version on every scrape |
| Human review | RTL admin dashboard for the legal team to review and acknowledge each change |

The system currently monitors **4 laws** (~2,295 articles, ~635 KB of Arabic law text).

---

## 2. Monorepo Structure

```
Jordanian-Law-RAG/
├── artifacts/
│   ├── api-server/          Express API server (Node.js, port 3001)
│   ├── legal-ai/            Admin dashboard (React + Vite, port 4000)
│   └── mockup-sandbox/      Isolated UI component dev/preview sandbox
│
├── lib/
│   ├── db/                  Drizzle ORM schema + PostgreSQL client
│   ├── integrations/        Puppeteer scraper + RAG retriever
│   ├── api-spec/            Shared Zod schemas (contract between server & client)
│   ├── api-client-react/    Auto-generated React Query hooks from api-spec
│   └── api-zod/             Zod validators re-exported for server-side use
│
├── scripts/                 One-off utility scripts
├── .env                     Local secrets (never committed)
├── .env.example             Template for new developers
├── pnpm-workspace.yaml      Workspace config, catalog, native-binary overrides
└── ARCHITECTURE.md          This file
```

### Package names

| Directory | Package name |
|---|---|
| `artifacts/api-server` | `@workspace/api-server` |
| `artifacts/legal-ai` | `@workspace/legal-ai` |
| `lib/db` | `@workspace/db` |
| `lib/integrations` | `@workspace/integrations` |
| `lib/api-spec` | `@workspace/api-spec` |
| `lib/api-client-react` | `@workspace/api-client-react` |

---

## 3. Tech Stack

| Layer | Technology |
|---|---|
| Package manager | pnpm workspaces |
| Language | TypeScript (strict) |
| API server | Express 5 |
| ORM | Drizzle ORM |
| Database | PostgreSQL |
| Web scraping | Puppeteer Core + system Chromium |
| Frontend | React 19, Vite 7, Tailwind CSS 4, shadcn/ui |
| State management | TanStack Query (React Query) |
| Frontend routing | Wouter |
| Logging | Pino + pino-http |
| Schema validation | Zod |

---

## 4. Database Schema

Four tables, all in `lib/db/src/schema/laws.ts`.

### `laws` — Current law text

| Column | Type | Description |
|---|---|---|
| `id` | serial PK | Auto-increment |
| `law_id` | varchar(50) UNIQUE | Natural key: `"43/1976"` (law number / year) |
| `arabic_name` | text | e.g. `"القانون المدني"` |
| `english_name` | text | e.g. `"Civil Law"` |
| `year` | varchar(4) | e.g. `"1976"` |
| `full_text` | text | Complete scraped body text (86–277 KB per law) |
| `article_count` | integer | Parsed article count from last scrape |
| `last_updated` | timestamp | When the row was last written |
| `lob_gov_url` | text | The exact URL scraped |
| `is_active` | boolean | False = law repealed / removed |
| `created_at` | timestamp | Row creation time |

### `law_versions` — Snapshot history

Every time a law changes, a new version row is inserted before overwriting `laws.full_text`.

| Column | Type | Description |
|---|---|---|
| `id` | serial PK | |
| `law_id` | varchar(50) | FK → `laws.law_id` |
| `version` | integer | Monotonically increasing (1, 2, 3…) |
| `full_text` | text | Full text at this version |
| `changes_summary` | text | e.g. `"3 added, 1 modified"` |
| `amendment_date` | timestamp | When the version was recorded |

### `law_changelog` — Article-level change log

One row per changed article per scrape cycle.

| Column | Type | Description |
|---|---|---|
| `id` | serial PK | |
| `law_id` | varchar(50) | Which law |
| `article_number` | integer | Which article |
| `change_type` | varchar(20) | `"added"` / `"modified"` / `"removed"` |
| `old_text` | text | Previous body (null for `added`) |
| `new_text` | text | New body (null for `removed`) |
| `affected_contract_types` | jsonb | e.g. `["employment"]` |
| `detected_at` | timestamp | Scrape time |
| `notified` | boolean | Reserved for future notification flow |
| `acknowledged_at` | timestamp | When the legal team reviewed and cleared it |

### `contract_law_mappings` — Which articles govern which contracts

Seeded once by the scraper on first run.

| Column | Type | Description |
|---|---|---|
| `id` | serial PK | |
| `contract_type` | varchar(50) | `"employment"` / `"rental"` / `"service"` / `"nda"` / `"supplier"` |
| `law_id` | varchar(50) | FK → `laws.law_id` |
| `relevant_articles` | jsonb | Array of article numbers, e.g. `[15, 35, 46, 56, 57]` |
| `priority` | integer | 1 = primary law, 2 = secondary |

---

## 5. The Scraper — How It Works

**Entry point:** `lib/integrations/src/lob-gov-jo-puppeteer-scraper.ts`  
**Exported singleton:** `lobGovScraper`

### Target site

`lob.gov.jo` is an Angular SPA with RSA-encrypted sessions. It does not expose a public API. The
scraper uses Puppeteer to drive a headless Chromium browser to render the page and extract
`body.innerText`.

### Scrape lifecycle

```
lobGovScraper.initialize()
  → Launch Chromium (finds executable from a list of known Nix/Linux/system paths)

lobGovScraper.updateAllLaws()
  → For each of the 4 laws:
      1. Navigate to the hash URL: #!/LegislationDetails?LegislationID=...
      2. Wait for Angular to render (network idle)
      3. Extract body.innerText (raw string, 86–277 KB)
      4. Parse into article map via extractArticles()
      5. Compare against stored version
      6. If changed: write to law_changelog, update laws, insert law_versions row

lobGovScraper.initializeContractLawMappings()
  → Seeds contract_law_mappings if the table is empty

lobGovScraper.shutdown()
  → Close the Chromium process
```

### The 4 monitored laws

| Law ID | Arabic name | English name | Governs |
|---|---|---|---|
| `8/1996` | قانون العمل | Labor Law | employment contracts |
| `43/1976` | القانون المدني | Civil Law | rental, service, NDA, supplier |
| `13/2019` | قانون الملكية العقارية | Real Estate Law | rental contracts (primary) |
| `12/1966` | قانون التجارة | Commercial Law | supplier contracts (secondary) |

### Article extraction

`lob.gov.jo` renders article headings as:

```
المادة 1 ارتباطات المادة <body text> المادة 2 ارتباطات المادة ...
```

The regex used:
```
/المادة\s+(\d+)(?:\s+ارتباطات المادة)?\s+([\s\S]+?)(?=المادة\s+\d+(?:\s+ارتباطات المادة)?|$)/g
```

Each captured body is then cleaned by `stripUiElements()` which removes Angular UI labels that
appear inside the rendered text but are not part of the law:

| UI element stripped | Why it causes false positives |
|---|---|
| `تفسير N` | Judicial interpretation count — changed 17 articles in Civil Law |
| `التشريعات المرتبطة N` | Related legislation count |
| `الاحكام القضائية N` | Judicial rulings count — changed 186 articles in Commercial Law |
| `ارتباطات المادة` | Article relationship navigation label |

---

## 6. Change Detection Algorithm

After each scrape, the extracted article map `{articleNumber: bodyText}` is compared against the
stored version using `articleMapsAreDifferent()`. This compares maps — not raw strings — so
whitespace or UI-chrome differences in the surrounding text do not trigger false changes.

```
oldArticles = extractArticles(existing laws.full_text)
newArticles = extractArticles(freshly scraped text)

for each article in newArticles:
  if not in oldArticles → INSERT law_changelog (changeType = "added")
  if text differs      → INSERT law_changelog (changeType = "modified")

for each article in oldArticles:
  if not in newArticles → INSERT law_changelog (changeType = "removed")
```

After recording, `laws.full_text` is overwritten with the fresh text and a new `law_versions` row
is inserted with a summary like `"3 modified, 1 added"`.

---

## 7. False-Positive Cleanup

Admin endpoint: `POST /api/admin/law-changes/cleanup-false-positives`

Even after UI chrome stripping, some false positives can accumulate over time (if a UI element was
added to the strip list after a scrape had already recorded it as a change). The cleanup endpoint
runs two passes:

### Pass 1 — Text stripping

Loads all unacknowledged `modified` changelog rows. For each one, strips UI chrome from both
`old_text` and `new_text` using the current `stripUiChrome()` function:

- If `strippedOld === strippedNew` → the change was pure UI noise → **delete the row**
- If either side changed after stripping → **update the row** with cleaned text

### Pass 2 — Flip-flop mirror pairs

Scrape instability can produce `X → Y` followed later by `Y → X` for the same article. If both
records are unacknowledged AND either:
- A side is a known corruption artifact (`"تعديلات"` placeholder or empty after stripping), OR
- The two detections are within 48 hours of each other (far shorter than the 1-week scrape cadence)

...both rows are deleted. This avoids erasing genuine legislative reversals (amendment then
rollback) which would be at least 1 week apart.

---

## 8. Weekly Scheduler

The server runs a single in-memory scheduler (`artifacts/api-server/src/jobs/lawSync.ts`).

**On startup:** triggers an immediate sync (`runLawSync("Startup")`).

**Recurring schedule:** every Monday at 02:00 AM. The delay is computed dynamically each time
`scheduleNext()` fires, so it self-corrects for daylight saving and server restarts.

```
function msUntilNextMonday2am():
  now = current time
  daysUntilMonday = (1 - now.getDay() + 7) % 7, minimum 1
  next = now + daysUntilMonday days, set time to 02:00:00
  return next - now
```

**Sync state** is held in a module-level object and exposed via `getSyncState()`:

```typescript
{
  inProgress: boolean       // true while scraper is running
  lastSyncAt: string | null // ISO timestamp of last completion
  lastSyncStatus: "success" | "error" | null
  nextSyncAt: string | null // ISO timestamp of next scheduled run
}
```

The state is visible in the dashboard and via `GET /api/admin/law-changes/status`.

---

## 9. API Server — All Endpoints

Base prefix: `/api`  
Server: Express 5 (port configured via `PORT` env var, default 3001 locally)

### Public endpoints (no auth)

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/healthz` | Health check. Returns `{"status":"ok"}` |
| `GET` | `/api/rag/retrieve?contractType=<type>` | RAG retrieval — used by the contracts system |

**`contractType` valid values:** `employment`, `rental`, `service`, `nda`, `supplier`

**`/api/rag/retrieve` response shape:**
```json
{
  "contractType": "employment",
  "lawVersionIds": ["8/1996@v3", "43/1976@v1"],
  "articleCount": 23,
  "articles": [
    {
      "lawId": "8/1996",
      "lawNameAr": "قانون العمل",
      "articleNumber": 15,
      "text": "...",
      "priority": 1,
      "lastUpdated": "2026-06-18T00:00:00.000Z"
    }
  ],
  "retrievedAt": "2026-06-18T21:00:00.000Z",
  "disclaimer": "هذه المواد القانونية مستخرجة من موقع ديوان التشريع والرأي الأردني..."
}
```

### Admin endpoints (HTTP Basic Auth required)

All under `/api/admin/law-changes/` — protected by the `adminAuth` middleware.

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/admin/law-changes/status` | Sync state (inProgress, lastSyncAt, nextSyncAt) |
| `POST` | `/api/admin/law-changes/sync` | Trigger an immediate scrape in the background |
| `GET` | `/api/admin/law-changes/pending` | All unacknowledged changes grouped by law |
| `POST` | `/api/admin/law-changes/:changeId/acknowledge` | Mark a single change as reviewed |
| `GET` | `/api/admin/law-changes/history` | Full changelog (all changes, acknowledged or not) |
| `POST` | `/api/admin/law-changes/cleanup-false-positives` | Run the false-positive cleanup algorithm |
| `GET` | `/api/admin/law-changes/laws` | All laws in the database with metadata |

**`/api/admin/law-changes/pending` response shape:**
```json
{
  "unreviewed": 2,
  "laws": [
    {
      "lawId": "43/1976",
      "lawName": "القانون المدني",
      "changesCount": 17,
      "affectedContractTypes": ["rental", "service"],
      "lastChangeAt": "2026-06-16T02:00:00.000Z",
      "details": [
        {
          "id": 42,
          "article": 192,
          "type": "modified",
          "oldText": "...",
          "newText": "...",
          "detectedAt": "2026-06-16T02:00:00.000Z"
        }
      ]
    }
  ]
}
```

---

## 10. Authentication

**Mechanism:** HTTP Basic Auth  
**Protected routes:** All `/api/admin/*`  
**Credentials:** username `admin`, password = `ADMIN_PASSWORD` env var

### How it works

The `adminAuth` middleware (`artifacts/api-server/src/api/middlewares/adminAuth.ts`):

1. If `ADMIN_PASSWORD` is not set → `503 Service Unavailable` (fail closed — never allows
   unauthenticated access)
2. If no `Authorization: Basic ...` header → `401` + `WWW-Authenticate` header
3. If username ≠ `admin` or password doesn't match → `401`
4. Otherwise → `next()`

### Frontend session

The React app stores the Basic Auth header in `sessionStorage` under key `qanooni_admin_auth`.
On page load it restores the header via `setAuthHeader()`. On logout it clears session storage,
clears the React Query cache, and redirects to the login page.

Login is verified by calling `GET /api/admin/law-changes/laws` — if it returns 200, the password
is correct and the session is saved.

---

## 11. RAG Retrieval — How the Contracts System Uses This

The RAG endpoint is the primary integration point between this system and the Qanoni contracts
generator (in the separate `Implement-It` repo).

**Flow:**

```
Contract system wants to generate an employment contract
  ↓
GET /api/rag/retrieve?contractType=employment
  ↓
RagLogic.retrieveArticles("employment")
  1. Find all contract_law_mappings rows where contractType = "employment"
  2. Fetch laws.full_text for each mapped law_id (deduplicated)
  3. Fetch latest law_versions.version number for each law (for version tracking)
  4. Extract only the relevant article numbers from full_text using extractArticleTexts()
  5. Return structured RagRetrieveResult
  ↓
Contract system receives:
  - Exact article texts in Arabic
  - law_version_ids (e.g. ["8/1996@v3"]) so the generated contract records
    which law version it was based on — enabling future audits
```

The `extractArticleTexts()` util (`artifacts/api-server/src/domains/rag/utils/extractArticles.ts`)
pre-strips UI chrome before extracting, because the stored `full_text` may contain artifacts from
earlier scrapes (before a strip rule was added). It also handles the "تعديلات المادة N" label
specific to Labor Law 8/1996 which embeds an article heading within the body text.

---

## 12. Contract-Law Mappings

Seeded by the scraper on first run. Defines which articles from which laws apply to each contract
type.

| Contract type | Law | Relevant articles |
|---|---|---|
| `employment` | Labor Law (8/1996) | 15, 35, 46, 56–85 |
| `rental` | Real Estate Law (13/2019) | 1–15 (primary) |
| `rental` | Civil Law (43/1976) | 192–200 (secondary) |
| `service` | Civil Law (43/1976) | 750–755 |
| `nda` | Civil Law (43/1976) | 143–145 |
| `supplier` | Civil Law (43/1976) | 300–304 (primary) |
| `supplier` | Commercial Law (12/1966) | 1–5 (secondary) |

`priority = 1` = primary law, `priority = 2` = secondary / supplementary.

---

## 13. Admin Dashboard (Frontend)

**Entry point:** `artifacts/legal-ai/`  
**Framework:** React 19, Vite 7, Tailwind CSS 4, shadcn/ui, Wouter routing

The dashboard is a fully Arabic-RTL-capable admin panel for the Qanooni legal team.

### Pages

| Route | Component | Description |
|---|---|---|
| `/` | `Dashboard` | Stats overview: law count, pending changes, sync status, "Sync Now" button |
| `/pending` | `PendingChanges` | All unacknowledged changes, grouped by law. Diff view of old vs new article text. Acknowledge button per change |
| `/laws` | `LawsList` | All 4 laws with article count, last update, and version info |
| `/history` | `HistoryLog` | Full changelog — all changes ever recorded, including acknowledged ones |
| (no route) | `Login` | Password entry page — shown when not authenticated |

### API client

All API calls go through `@workspace/api-client-react`, which provides auto-generated React Query
hooks:

```typescript
useGetSyncStatus()          // polls every 5s during active sync
useTriggerSync()            // mutation: POST /api/admin/law-changes/sync
useGetPendingLawChanges()   // GET /api/admin/law-changes/pending
useGetStoredLaws()          // GET /api/admin/law-changes/laws
useGetHistory()             // GET /api/admin/law-changes/history
useHealthCheck()            // GET /api/healthz
```

All admin hooks include the `Authorization: Basic ...` header automatically via `setAuthHeader()`.

### Layout

Responsive two-panel layout:
- **Desktop:** fixed left sidebar with nav links + bottom user/logout section
- **Mobile:** collapsible drawer with hamburger button in a sticky top bar

---

## 14. Layered Architecture (Backend)

The API server follows a strict 4-layer architecture:

```
Request
  │
  ▼
Controller  (artifacts/api-server/src/domains/*/controller.ts)
  │   Parses request, calls Logic, sends response. No DB access.
  │
  ▼
Logic       (artifacts/api-server/src/domains/*/logic/*.ts)
  │   Business rules. Orchestrates Repos. No HTTP types.
  │
  ▼
Repo        (artifacts/api-server/src/domains/*/repos/*.ts)
  │   All Drizzle queries. No business rules.
  │
  ▼
Infra/DB    (artifacts/api-server/src/infra/db/index.ts)
  │   Re-exports @workspace/db. Single import point for the domain layer.
  │
  ▼
PostgreSQL
```

### Domain layout

```
domains/
├── rag/
│   ├── routes.ts          GET /retrieve
│   ├── controller.ts
│   ├── logic/RagLogic.ts
│   ├── repos/RagRepo.ts
│   └── utils/extractArticles.ts
│
└── lawChanges/
    ├── routes.ts          All /admin/law-changes/* routes
    ├── controller.ts
    ├── logic/LawChangesLogic.ts
    ├── repos/LawChangesRepo.ts
    └── utils/stripUiChrome.ts
```

### Bootstrap sequence

```
index.ts
  → initApi()     — creates Express app, attaches pino-http, CORS, body parser
  → initRoutes()  — mounts /api router
  → initJobs()    — starts scraper sync + weekly scheduler
  → app.listen()
```

---

## 15. Environment Variables

All defined in `.env` at the monorepo root. Copy `.env.example` to get started.

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | Yes | Full PostgreSQL connection string |
| `ADMIN_PASSWORD` | Yes | Password for the admin dashboard |
| `PORT` | Yes | Port the Express server listens on |
| `BASE_PATH` | Yes | URL base path for the Vite frontend (usually `/`) |
| `LOG_LEVEL` | No | Pino log level: `trace`/`debug`/`info`/`warn`/`error` |

**Example `.env`:**
```env
DATABASE_URL=postgresql://alaaabdalqader@localhost:5432/qanooni_rag
ADMIN_PASSWORD=change-me-before-production
PORT=3001
BASE_PATH=/
LOG_LEVEL=info
```

### How env is loaded per package

| Package | Mechanism |
|---|---|
| `api-server` | `node --env-file=../../.env` flag in start/dev scripts |
| `db` (drizzle-kit) | `dotenv.config()` at the top of `drizzle.config.ts` |
| `legal-ai` (vite dev) | `PORT=xxxx BASE_PATH=/ pnpm run dev` inline env |
| `legal-ai` (vite build) | Defaults to port 8080, base `/` if not set |

---

## 16. Running the Project Locally

### Prerequisites

- Node.js 20+
- pnpm (`npm install -g pnpm`)
- PostgreSQL running locally

### Steps

```bash
# 1. Clone
git clone <repo-url>
cd Jordanian-Law-RAG

# 2. Install dependencies
pnpm install

# 3. Create .env (copy the example, fill in your DB password)
cp .env.example .env

# 4. Create the database
createdb qanooni_rag

# 5. Push schema
pnpm --filter @workspace/db run push

# 6. Build the API server
pnpm --filter @workspace/api-server run build

# 7. Start the API server (Terminal 1)
pnpm --filter @workspace/api-server run start

# 8. Start the frontend (Terminal 2)
cd artifacts/legal-ai
PORT=4000 BASE_PATH=/ pnpm run dev
```

### Verify

- API health: http://localhost:3001/api/healthz → `{"status":"ok"}`
- Frontend: http://localhost:4000
- Login with the `ADMIN_PASSWORD` from your `.env`

### Windows (PowerShell)

```powershell
# Step 8 (frontend) on Windows:
$env:PORT="4000"; $env:BASE_PATH="/"; pnpm run dev
```

---

## 17. Known Sharp Edges

### Chromium dependency

The scraper looks for Chromium at a hardcoded list of Nix/Linux paths. It will throw
`"No Chromium executable found"` on macOS and Windows. To fix, either:
- Add the local Chrome/Chromium path to the `CHROME_CANDIDATES` array in
  `lib/integrations/src/lob-gov-jo-puppeteer-scraper.ts`, or
- Install `puppeteer` (not `puppeteer-core`) and let it manage its own Chromium

The startup sync will fail with this error but the server continues running. Admin endpoints and
RAG retrieval work without Chromium.

### Article boundary regex brittleness

If `lob.gov.jo` ever changes its Angular template (e.g. removes `ارتباطات المادة` from headings),
the article regex will parse 0 articles. The scraper has an 8,000-character content guard before
committing to the DB, but the guard only catches completely empty pages — not a broken regex.
Add a post-scrape assertion: `articleCount > 50`.

### Single-process scheduler

`nextSyncAt` and `inProgress` state live in memory. A server restart resets them and triggers an
immediate re-sync. There is no distributed locking — running two instances of the API server would
cause duplicate concurrent scrapes.

### No real-time notifications

`law_changelog.notified` exists but the notification flow is not implemented. The legal team must
check the dashboard manually to see new changes.
