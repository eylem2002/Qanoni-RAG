# Qanooni AI — Legal RAG System

Admin dashboard and scraping pipeline for Qanooni AI's Jordanian law intelligence system. Scrapes laws from lob.gov.jo, stores them in PostgreSQL with article-level change detection, and provides an Arabic RTL admin dashboard for the legal team.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 8080)
- `pnpm --filter @workspace/legal-ai run dev` — run the admin dashboard
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string, `ADMIN_PASSWORD` — dashboard password

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)
- Scraper: Puppeteer Core (headless Chromium at `/nix/store/.../chromium-1080/chrome-linux/chrome`)
- Frontend: React + Vite, RTL Arabic, dark navy theme

## Where things live

- `lib/integrations/src/lob-gov-jo-puppeteer-scraper.ts` — main scraper (Puppeteer + Angular SPA warmup)
- `lib/db/src/schema/laws.ts` — DB schema: laws, law_versions, law_changelog, contract_law_mappings
- `artifacts/api-server/src/lib/law-update-scheduler.ts` — weekly scrape scheduler + sync state + manual trigger
- `artifacts/api-server/src/lib/admin-auth.ts` — HTTP Basic Auth middleware (protects all /admin routes)
- `artifacts/api-server/src/routes/admin/law-changes.ts` — Express route handlers (pending, history, laws, status, sync, acknowledge)
- `artifacts/api-server/build.mjs` — esbuild config (puppeteer-core in `external`)
- `artifacts/legal-ai/src/pages/` — admin dashboard pages (Dashboard, Pending Reviews, Law Registry, Change History, Login)
- `lib/api-spec/openapi.yaml` — OpenAPI contract (source of truth for API)
- `lib/api-client-react/src/custom-fetch.ts` — fetch wrapper with `setAuthHeader()` for Basic Auth
- `lib/api-client-react/src/` — generated React Query hooks (auto-generated, do not edit)

## Architecture decisions

- **Puppeteer-only scraping** — lob.gov.jo is an Angular SPA with RSA-encrypted session tokens; axios/cheerio won't work. Puppeteer renders the full JS app.
- **Homepage warmup is critical** — navigating directly to a deep-link URL loads cached/wrong content. Must navigate to `https://lob.gov.jo/?v=2&lang=ar` first and wait 3s for RSA key exchange, then hash-navigate to the specific law.
- **Content threshold ≥8000 chars** — the site shell is ~2400 chars and partial loads are ~3276 chars; only ≥8000 chars means a real law loaded.
- **Article-level change detection** — strips UI chrome (`تفسير N`, `ارتباطات المادة`) then compares article maps by SHA. Changed articles go into `law_changelog` as pending reviews.
- **Safety assertion ≥20 articles** — scraper throws before any DB write if fewer than 20 articles parsed, preventing silent data corruption.
- **law_versions populated** — every new law inserts version 1; every change inserts a new version with a human-readable summary (e.g. "3 modified, 1 added").
- **Lean API responses** — `/laws` endpoint excludes `full_text` (277 KB for Civil Law); response is ~2 KB instead of 635 KB.
- **HTTP Basic Auth** — all `/api/admin/*` routes protected. Frontend login screen stores credentials in `sessionStorage` and injects `Authorization: Basic ...` header on every request via `setAuthHeader()`.
- **In-memory sync state** — scheduler tracks `inProgress`, `lastSyncAt`, `lastSyncStatus`, `nextSyncAt`. Exposed via `GET /admin/law-changes/status`. Manual trigger via `POST /admin/law-changes/sync` (409 if already running).
- **Contract-law mappings** — static table mapping contract types (employment, rental, service, nda, supplier) to relevant law IDs and article numbers, used by the RAG pipeline.

## Product

**4 Jordanian laws stored**, **2,295 articles** extracted and indexed:

| Law | Year | Articles | Notes |
|-----|------|----------|-------|
| القانون المدني (Civil Law) | 43/1976 | 1,449 | Governs service, NDA, supplier, rental contracts |
| قانون التجارة (Commercial Law) | 12/1966 | 480 | Governs supplier contracts |
| قانون الملكية العقارية (Real Estate Law) | 13/2019 | 224 | Current real-estate/rental law (supersedes 11/1994) |
| قانون العمل (Labor Law) | 8/1996 | 142 | Governs employment contracts |

Scraper runs on startup + every Monday at 2AM. The legal team reviews any detected changes via the admin dashboard.

## Admin Dashboard

- **Login screen** — Arabic RTL password prompt. Password: see `ADMIN_PASSWORD` env var (currently `qanooni-legal-2026`).
- **Dashboard** — stats (laws, pending reviews, system status), Sync Now button, Last Sync timestamp, priority action items, recent laws list. All panels show error states on API failure.
- **Pending Reviews** — lists unacknowledged law changes grouped by law, with old/new text previews and per-change acknowledge buttons.
- **Law Registry** — all 4 monitored laws with article count, last-updated date, active status, and lob.gov.jo link.
- **Change History** — full audit trail of all detected changes (acknowledged + pending).

## API Endpoints

All admin endpoints require `Authorization: Basic base64(admin:<ADMIN_PASSWORD>)`.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/healthz` | Health check |
| GET | `/api/admin/law-changes/status` | Sync state (inProgress, lastSyncAt, etc.) |
| POST | `/api/admin/law-changes/sync` | Trigger immediate sync (409 if already running) |
| GET | `/api/admin/law-changes/laws` | All stored laws (no full_text) |
| GET | `/api/admin/law-changes/pending` | Unreviewed changes grouped by law |
| GET | `/api/admin/law-changes/history` | Full change audit trail |
| POST | `/api/admin/law-changes/:id/acknowledge` | Mark a change as reviewed |

## User preferences

- Arabic RTL throughout the dashboard (direction: rtl, font: Tajawal)
- Dark navy sidebar, clean white content area
- Law IDs formatted as `number/year` (e.g. `43/1976`)

## Gotchas

- **Must warm up Angular session** before navigating to any law. Without this, the SPA loads wrong/cached content.
- `puppeteer-core` must remain in the `external` list in `artifacts/api-server/build.mjs` (it's a native binary, can't be bundled).
- `puppeteer-core` must be in `dependencies` (not `devDependencies`) in `artifacts/api-server/package.json`.
- Article format on lob.gov.jo: `المادة N\n\nارتباطات المادة\n[text]` — NOT `المادة N:`.
- Civil Law (43/1976) is 277KB — loads reliably with the homepage warmup strategy.
- ID 3408 = قانون الملكية العقارية 13/2019 (NOT the old rental law 11/1994 which is no longer on lob.gov.jo).
- UI chrome stripped by `stripUiElements()` before article comparison — prevents `تفسير N` and `الاحكام القضائية N` counts from triggering false-positive change detections. Three known UI elements stripped: `تفسير N`, `التشريعات المرتبطة N`, `الاحكام القضائية N`.
- OpenAPI schema names must NOT end in "Response" if they also appear as TypeScript types — Orval generates both a Zod schema and a TS interface with the same name, causing TS2308 conflicts on `export *`.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
