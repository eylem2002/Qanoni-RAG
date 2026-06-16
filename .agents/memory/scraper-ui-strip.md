---
name: Scraper UI strip patterns
description: lob.gov.jo injects UI counter elements into article body text; all must be stripped before comparison or they cause false-positive change detections.
---

## The rule
`stripUiElements()` in `lib/integrations/src/lob-gov-jo-puppeteer-scraper.ts` must strip every lob.gov.jo UI element before comparing article text or storing changelog entries.

## Known UI elements (as of June 2026)

| Pattern | Arabic label | What it is | False positives caused |
|---|---|---|---|
| `^تفسير \d+` | Judicial interpretations count | How many scholarly interpretations link to this article | 17 in القانون المدني |
| `^التشريعات المرتبطة \d+` | Related legislation count | How many other laws reference this article | unknown |
| `^الاحكام القضائية \d+` | Judicial rulings count | How many court decisions cite this article | 186 in قانون التجارة |
| `ارتباطات المادة` | Article relationships label | UI section heading, not law text | — |

**Why:** lob.gov.jo is an Angular SPA. `document.body.innerText` includes all rendered text, including dynamic counters that increment whenever a new court ruling or interpretation is linked to an article. These are NOT changes to the law text itself.

**How to apply:** Any time the site adds a new counter-style UI element and the next scrape produces a flood of "modified" entries with identical-looking text, check whether a new pattern needs to be added to `stripUiElements()`. The tell is: DB entries where `regexp_replace(new_text, '^<new_pattern>', '') = old_text`.

## Cleaning PRODUCTION data (dev and prod DBs are separate)
The dev database and the published app's production database are independent. Cleaning the dev DB has zero effect on what a user sees in the published app. The `executeSql` production environment is READ-ONLY (replica), so production rows cannot be deleted with it.

**Rule:** to mutate production data, go through the deployed app, not the DB tool. A reusable admin endpoint `POST /api/admin/law-changes/cleanup-false-positives` performs the strip-and-purge; it must be DEPLOYED first, then invoked against the published `.replit.app` URL with Basic auth.

**Why:** when a user reports a fix "not working" after you cleaned dev, suspect they are viewing the published app backed by the prod DB. Always confirm which DB the symptom lives in (read-only prod SELECT) before assuming the cleanup failed.

## Cleanup procedure for new false positives (dev, direct SQL)
```sql
-- 1. Delete pure false positives (only diff was the UI element)
DELETE FROM law_changelog
WHERE change_type = 'modified'
  AND regexp_replace(new_text, '^<pattern>\s+\d+\s*', '', 'g')
    = regexp_replace(old_text, '^<pattern>\s+\d+\s*', '', 'g');

-- 2. Strip prefix from remaining records that have the element but also real changes
UPDATE law_changelog
SET
  old_text = regexp_replace(old_text, '^<pattern>\s+\d+\s*', '', 'g'),
  new_text = regexp_replace(new_text, '^<pattern>\s+\d+\s*', '', 'g')
WHERE change_type = 'modified'
  AND (old_text ~ '^<pattern>\s+\d+' OR new_text ~ '^<pattern>\s+\d+');
```
