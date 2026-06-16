# Objective
Run a production-scope security scan across the Qanooni AI application and report only concrete, exploitable vulnerabilities.

# Relevant information
- Deployment is public (`https://jordanian-law-rag.replit.app`), so internet-reachable risk matters.
- Production scope: `artifacts/api-server`, `artifacts/legal-ai`, `lib/db`, `lib/integrations`, generated packages that affect runtime behavior.
- Dev-only and normally out of scope: `artifacts/mockup-sandbox/**`.
- Primary trust boundaries:
  - Public callers -> `/api/rag/*`, `/api/healthz`
  - Admin callers -> `/api/admin/*`
  - API -> PostgreSQL
  - API -> remote legislation site through Puppeteer
- Deterministic scan lead so far: committed `ADMIN_PASSWORD` secret in `.replit`.

# Tasks

### T001: Admin auth and secret exposure
- **Blocked By**: []
- **Details**:
  - Review admin auth middleware, admin routes, frontend login/session handling, deployment/config files, and scanner secret findings.
  - Validate exploitability of shared-password auth issues such as committed credentials, brute-force exposure, or credential reuse impact.
  - Files: `.replit`, `artifacts/api-server/src/lib/admin-auth.ts`, `artifacts/api-server/src/routes/admin/law-changes.ts`, `artifacts/legal-ai/src/App.tsx`, `artifacts/legal-ai/src/pages/login.tsx`, `artifacts/api-server/src/app.ts`
  - Acceptance: Confirmed findings or clear dismissal with rationale.

### T002: Public API and data exposure / abuse paths
- **Blocked By**: []
- **Details**:
  - Review `/api/rag/retrieve`, request validation, response contents, query behavior, and abuse potential from public internet traffic.
  - Check for injection, overbroad disclosure, and concrete DoS vectors.
  - Files: `artifacts/api-server/src/routes/rag.ts`, `lib/db/src/schema/laws.ts`, `lib/integrations/src/rag-law-retriever.ts`
  - Acceptance: Confirmed findings or clear dismissal with rationale.

### T003: Scraper/scheduler integrity and admin-triggered heavy operations
- **Blocked By**: []
- **Details**:
  - Review manual sync, scheduler behavior, Puppeteer launch/use, and changelog cleanup routines for production-reachable integrity or availability issues.
  - Validate whether any issue is exploitable in production rather than merely operationally brittle.
  - Files: `artifacts/api-server/src/lib/law-update-scheduler.ts`, `lib/integrations/src/lob-gov-jo-puppeteer-scraper.ts`, `artifacts/api-server/src/routes/admin/law-changes.ts`
  - Acceptance: Confirmed findings or clear dismissal with rationale.
