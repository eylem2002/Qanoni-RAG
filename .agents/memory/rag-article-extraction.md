---
name: RAG article extraction vs stored full_text
description: Why the RAG article extractor needs extra UI-chrome stripping that the scraper does not.
---

# RAG article extraction from stored law full_text

The RAG endpoint (`extractArticleTexts`) re-parses a law's RAW stored `full_text` to slice out
specific article bodies. The scraper's `extractArticles`/`stripUiElements` run on freshly rendered
page text and never re-parse the stored column, so the two parsers are NOT interchangeable.

**Rule:** any UI-chrome line that embeds the token `المادة N` (notably `تعديلات المادة N`, the
amendments label) MUST be stripped *before* the article-boundary split in the RAG extractor.

**Why:** the boundary regex uses a lookahead `(?=المادة\s+\d+...)`. The `المادة N` embedded inside
`تعديلات المادة N` satisfied that lookahead and truncated the captured body to the bare label
`تعديلات`. This hit Jordanian Labor Law 8/1996 only (its articles carry that line); the other 3
laws don't render it, so they extracted fine and the bug looked law-specific.

**How to apply:** strip such chrome line-anchored (`/^\s*تعديلات المادة\s+\d+\s*$/gm`) so legitimate
in-body references can't be deleted. Verify any change by running the extractor against the real
`laws.full_text` for all stored laws and asserting zero article bodies equal the string `تعديلات`.
The stored `full_text` legitimately begins with site nav chrome (`الصفحة الرئيسية ...`); that is
normal, not a bad scrape.
