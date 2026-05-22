# Qanooni AI — Legal RAG System

Admin dashboard and scraping pipeline for Qanooni AI's Jordanian law intelligence system. Scrapes laws from lob.gov.jo, stores them in PostgreSQL with article-level change detection, and provides an Arabic RTL admin dashboard for the legal team.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 8080)
- `pnpm --filter @workspace/legal-ai run dev` — run the admin dashboard
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

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
- `artifacts/api-server/src/lib/law-update-scheduler.ts` — weekly scrape scheduler
- `artifacts/api-server/src/routes/` — Express route handlers
- `artifacts/api-server/build.mjs` — esbuild config (puppeteer-core in `external`)
- `artifacts/legal-ai/src/pages/` — admin dashboard pages (Dashboard, Pending Reviews, Law Registry, Change History)
- `lib/api-spec/openapi.yaml` — OpenAPI contract (source of truth for API)

## Architecture decisions

- **Puppeteer-only scraping** — lob.gov.jo is an Angular SPA with RSA-encrypted session tokens; axios/cheerio won't work. Puppeteer renders the full JS app.
- **Homepage warmup is critical** — navigating directly to a deep-link URL loads cached/wrong content. Must navigate to `https://lob.gov.jo/?v=2&lang=ar` first and wait 3s for RSA key exchange, then hash-navigate to the specific law.
- **Content threshold ≥8000 chars** — the site shell is ~2400 chars and partial loads are ~3276 chars; only ≥8000 chars means a real law loaded.
- **Article-level change detection** — each scrape computes SHA-256 of each article and compares to the previous version. Changed articles go into `law_changelog` as pending reviews.
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

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
