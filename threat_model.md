# Threat Model

## Project Overview

Qanooni AI is a pnpm-monorepo legal intelligence system with a public Express API and a React admin dashboard. In production it runs as a public autoscale deployment on Replit, stores Jordanian law text and change history in PostgreSQL, exposes a public RAG retrieval endpoint for downstream contract generation, and exposes an admin-only law operations surface protected by a shared HTTP Basic Auth password.

Production scope for this scan includes `artifacts/api-server`, `artifacts/legal-ai`, `lib/db`, `lib/integrations`, and generated client/spec packages that affect those runtime paths. `artifacts/mockup-sandbox` is dev-only and should be ignored unless future scans show it is production-reachable.

## Assets

- **Admin control plane** — the ability to trigger scrapes, acknowledge legal changes, inspect history, and clean up records. Compromise gives operational control over the corpus update workflow.
- **Admin credential material** — the shared `ADMIN_PASSWORD` value and any derived Basic Auth header stored or transmitted by the app. Compromise grants full access to every admin endpoint.
- **Law corpus and version history** — `laws`, `law_versions`, `law_changelog`, and `contract_law_mappings`. Integrity matters because downstream legal generation depends on these records.
- **RAG outputs** — article excerpts and version identifiers returned to contract-generation consumers. Integrity and availability matter because callers rely on them to build legal documents.
- **Application secrets and infrastructure access** — `DATABASE_URL`, `ADMIN_PASSWORD`, and any deployment/runtime configuration that grants database or admin access.

## Trust Boundaries

- **Browser to API** — all frontend and external consumer traffic crosses this boundary. The browser and any public caller are untrusted.
- **Public to admin API** — `/api/rag/*` and `/api/healthz` are public, while `/api/admin/*` must enforce stronger server-side authentication and resist internet-origin attacks.
- **API to PostgreSQL** — the server can read and modify the full law corpus and audit history. Injection or broken authorization at the API layer would directly expose or tamper with database contents.
- **API to external legislation site** — the scraper drives a remote Angular site through Puppeteer. Failures or attacker-induced repeated runs can affect availability and corpus integrity.
- **Production to dev-only artifacts** — mockup/demo code exists in the repository but is assumed non-production unless explicitly wired into deployed routes or assets.

## Scan Anchors

- **Production entry points:** `artifacts/api-server/src/index.ts`, `artifacts/api-server/src/app.ts`, `artifacts/legal-ai/src/main.tsx`
- **Public surface:** `artifacts/api-server/src/routes/rag.ts`, `artifacts/api-server/src/routes/health.ts`
- **Admin/auth surface:** `artifacts/api-server/src/lib/admin-auth.ts`, `artifacts/api-server/src/routes/admin/law-changes.ts`, `artifacts/legal-ai/src/App.tsx`
- **High-risk background/data paths:** `artifacts/api-server/src/lib/law-update-scheduler.ts`, `lib/integrations/src/lob-gov-jo-puppeteer-scraper.ts`, `lib/db/src/schema/laws.ts`
- **Usually ignore unless production reachability changes:** `artifacts/mockup-sandbox/**`

## Threat Categories

### Spoofing

The main spoofing risk is unauthorized access to `/api/admin/*`. Because the application uses a single shared HTTP Basic Auth password rather than per-user sessions, the system must keep that credential secret, make it hard to guess online, and never expose it in repository files, client assets, or logs. Every admin route must continue to enforce authentication server-side regardless of frontend state.

### Tampering

Admin endpoints can trigger background syncs, acknowledge change records, and modify stored changelog text. The application must ensure only authenticated admins can invoke those state-changing routes and that database operations remain parameterized and scoped to the intended records. The scraper must reject partial or corrupted fetches before writing to the corpus so bad upstream content does not silently poison downstream legal retrieval.

### Information Disclosure

The highest disclosure risk is leakage of the shared admin credential or database-backed admin data. The system must not commit live credentials into repo-managed files, embed them in client bundles, or return unnecessary sensitive data in public responses. Logs and error responses must continue to avoid disclosing authorization headers, cookies, stack traces, or internal database details.

### Denial of Service

The public RAG endpoint and the admin-triggered scraper both perform non-trivial server work. The application must prevent unauthenticated or low-effort internet traffic from exhausting expensive operations, and it must ensure repeated sync attempts cannot wedge the service or consume unbounded browser/database resources.

### Elevation of Privilege

Any attacker who obtains or guesses the shared admin password immediately becomes a full admin because there is no finer-grained role separation. The system must therefore treat `ADMIN_PASSWORD` as a high-value secret, resist brute-force attempts against the admin boundary, and avoid design choices that turn a single leaked string into broad operational control.