import { existsSync } from "fs";
import puppeteer, { type Browser, type Page } from "puppeteer-core";
import { db } from "@workspace/db";
import { laws, lawChangelog, contractLawMappings, lawVersions } from "@workspace/db";
import { eq, max } from "drizzle-orm";

// Ordered list of Chromium/Chrome executables to try
const CHROME_CANDIDATES = [
  // macOS — Google Chrome
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  // macOS — Chromium
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  // Playwright-managed Chromium (newer, preferred — Linux/Nix)
  "/nix/store/0n9rl5l9syy808xi9bk4f6dhnfrvhkww-playwright-browsers-chromium/chromium-1080/chrome-linux/chrome",
  // System Chromium via nix
  "/nix/store/ia69plrrvn7czdhn3flq1ll39i92ixab-chromium-92.0.4515.159/bin/chromium",
  // Common Linux paths
  "/usr/bin/chromium-browser",
  "/usr/bin/chromium",
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
];

function findChromiumExecutable(): string {
  for (const path of CHROME_CANDIDATES) {
    if (existsSync(path)) return path;
  }
  throw new Error(
    "No Chromium executable found. Tried: " + CHROME_CANDIDATES.join(", ")
  );
}

interface LobLawMetadata {
  legislationId: number;
  legislationNumber: number;
  legislationYear: number;
  arabicName: string;
  englishName?: string;
  legislationType: "law" | "system" | "treaty" | "decision";
  status: "active" | "inactive";
  lobGovUrl: string;
}

export class LobGovJoPuppeteerScraper {
  private browser: Browser | null = null;
  private readonly timeout = 60000;
  private readonly retries = 3;

  // Verified LegislationIDs — manually confirmed on lob.gov.jo
  // LegislationType=2 is the correct type for قانون (primary laws)
  private lawsToScrape: LobLawMetadata[] = [
    {
      legislationId: 3392,
      legislationNumber: 8,
      legislationYear: 1996,
      arabicName: "قانون العمل",
      englishName: "Labor Law",
      legislationType: "law",
      status: "active",
      lobGovUrl:
        "https://lob.gov.jo/?v=2&lang=ar#!/LegislationDetails?LegislationID=3392&LegislationType=2&isMod=false",
    },
    {
      legislationId: 536,
      legislationNumber: 43,
      legislationYear: 1976,
      arabicName: "القانون المدني",
      englishName: "Civil Law",
      legislationType: "law",
      status: "active",
      lobGovUrl:
        "https://lob.gov.jo/?v=2&lang=ar#!/LegislationDetails?LegislationID=536&LegislationType=2&isMod=false",
    },
    {
      // قانون الملكية العقارية #13/2019 — the current Jordanian real-estate law
      // that supersedes the old Rental Law 11/1994 (which is no longer on lob.gov.jo)
      legislationId: 3408,
      legislationNumber: 13,
      legislationYear: 2019,
      arabicName: "قانون الملكية العقارية",
      englishName: "Real Estate Property Law",
      legislationType: "law",
      status: "active",
      lobGovUrl:
        "https://lob.gov.jo/?v=2&lang=ar#!/LegislationDetails?LegislationID=3408&LegislationType=2&isMod=false",
    },
    {
      legislationId: 1028,
      legislationNumber: 12,
      legislationYear: 1966,
      arabicName: "قانون التجارة",
      englishName: "Commercial Law",
      legislationType: "law",
      status: "active",
      lobGovUrl:
        "https://lob.gov.jo/?v=2&lang=ar#!/LegislationDetails?LegislationID=1028&LegislationType=2&isMod=false",
    },
  ];

  // Maps law IDs to the contract types they govern
  private contractToLaws: Record<string, string[]> = {
    "8/1996": ["employment"],
    "43/1976": ["rental", "service", "nda", "supplier"],
    "13/2019": ["rental"],
    "12/1966": ["supplier"],
  };

  async initialize(): Promise<void> {
    const executablePath = findChromiumExecutable();
    console.log(`[LobGovScraper] Launching Chromium: ${executablePath}`);
    try {
      this.browser = await puppeteer.launch({
        executablePath,
        headless: true,
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-dev-shm-usage",
          "--disable-gpu",
          "--single-process",
          "--no-zygote",
        ],
      });
      console.log("[LobGovScraper] Browser initialized successfully");
    } catch (error) {
      console.error("[LobGovScraper] Failed to initialize Puppeteer:", error);
      throw error;
    }
  }

  async shutdown(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      console.log("[LobGovScraper] Browser closed");
    }
  }

  async updateAllLaws(): Promise<void> {
    if (!this.browser) {
      throw new Error("Browser not initialized. Call initialize() first.");
    }

    console.log("[LobGovScraper] Starting law scrape cycle...");
    let successCount = 0;
    let failureCount = 0;

    for (const lawMeta of this.lawsToScrape) {
      try {
        console.log(
          `[LobGovScraper] Processing: ${lawMeta.arabicName} (${lawMeta.legislationNumber}/${lawMeta.legislationYear})`
        );
        await this.fetchAndStoreLaw(lawMeta);
        successCount++;
      } catch (error) {
        console.error(
          `[LobGovScraper] Failed: ${lawMeta.arabicName} — ${error}`
        );
        failureCount++;
      }
    }

    console.log(
      `[LobGovScraper] Cycle complete: ${successCount} succeeded, ${failureCount} failed`
    );
  }

  /**
   * Warm up the Angular session on the homepage so RSA keys are initialized,
   * then navigate to the specific legislation page via hash change.
   * This avoids the "wrong cached content" bug that occurs when navigating
   * directly to a deep link before the Angular app has its session.
   */
  private async fetchAndStoreLaw(lawMeta: LobLawMetadata): Promise<void> {
    if (!this.browser) throw new Error("Browser not initialized");

    let attempt = 0;
    let lastError: Error | null = null;

    while (attempt < this.retries) {
      attempt++;
      const page = await this.browser.newPage();

      try {
        await page.setViewport({ width: 1920, height: 1080 });

        // ── Step 1: Warm up Angular session on the homepage ─────────────────
        console.log(
          `[LobGovScraper]   Attempt ${attempt}/${this.retries}: warming up Angular session...`
        );
        await page.goto("https://lob.gov.jo/?v=2&lang=ar", {
          waitUntil: "networkidle0",
          timeout: this.timeout,
        });
        // Wait for Angular + RSA key exchange to complete
        await new Promise((resolve) => setTimeout(resolve, 3000));

        // ── Step 2: Navigate to the specific legislation via hash change ──────
        console.log(
          `[LobGovScraper]   Navigating to LegislationID=${lawMeta.legislationId}...`
        );
        const hash = `#!/LegislationDetails?LegislationID=${lawMeta.legislationId}&LegislationType=2&isMod=false`;
        await page.evaluate((h) => {
          // @ts-ignore
          window.location.hash = h;
        }, hash);

        // ── Step 3: Wait for Angular to decrypt and render the law ───────────
        console.log("[LobGovScraper]   Waiting for law content to render...");
        const rendered = await page
          .waitForFunction(
            () => {
              // @ts-ignore
              const text = document.body.innerText || "";
              // Law content is rendered when we see the metadata labels
              // AND substantial text (the bare shell is ~2400 chars)
              return (
                text.includes("رقم التشريع") &&
                text.includes("سنة التشريع") &&
                text.length > 8000
              );
            },
            { timeout: 45000, polling: 1000 }
          )
          .then(() => true)
          .catch(() => false);

        if (!rendered) {
          console.warn(
            "[LobGovScraper]   Content render timed out — checking what we have..."
          );
        }

        // Extra buffer for any trailing Angular digest cycles
        await new Promise((resolve) => setTimeout(resolve, 2000));

        const lawText = await this.extractTextFromPage(page);
        const charCount = lawText.trim().length;

        // Require at least 8000 chars — any less is just the site shell
        if (charCount < 8000) {
          throw new Error(
            `Insufficient content: ${charCount} chars (need ≥8000). Law page may not have rendered.`
          );
        }

        // Verify the year appears in the rendered text (stronger signal than number)
        const yearStr = String(lawMeta.legislationYear);
        if (!lawText.includes(yearStr)) {
          throw new Error(
            `Year ${yearStr} not found in extracted text — likely loaded wrong law for ID=${lawMeta.legislationId}`
          );
        }

        console.log(`[LobGovScraper]   Extracted ${charCount} characters`);
        const isActive = this.parseIsActiveFromText(lawText);
        console.log(`[LobGovScraper]   Status: ${isActive ? "ساري (active)" : "غير ساري (inactive)"}`);
        await this.processExtractedLaw(lawMeta, lawText, isActive);
        return;
      } catch (error) {
        lastError = error as Error;
        console.error(
          `[LobGovScraper]   Attempt ${attempt} failed: ${lastError.message}`
        );
        if (attempt < this.retries) {
          const delay = 3000 * attempt;
          console.log(`[LobGovScraper]   Retrying in ${delay / 1000}s...`);
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      } finally {
        await page.close();
      }
    }

    throw lastError ?? new Error("Unknown error in fetchAndStoreLaw");
  }

  private async extractTextFromPage(page: Page): Promise<string> {
    const text = await page.evaluate(() => {
      // lob.gov.jo renders law content inside Angular templates.
      // The full body innerText is the most reliable source — it includes
      // the law text after Angular has decrypted and rendered it.
      // @ts-ignore — this runs inside the browser via page.evaluate()
      return document.body.innerText?.trim() ?? "";
    });

    return text
      .replace(/[ \t]+/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  private parseIsActiveFromText(text: string): boolean {
    // lob.gov.jo renders "حالة التشريع" followed by "ساري" or "غير ساري"
    const match = text.match(/حالة التشريع\s*(غير ساري|ساري)/);
    if (match) return match[1] === "ساري";
    // Default to active if the status label isn't found — don't wrongly deactivate
    return true;
  }

  private async processExtractedLaw(
    lawMeta: LobLawMetadata,
    newText: string,
    isActive: boolean
  ): Promise<void> {
    const lawId = `${lawMeta.legislationNumber}/${lawMeta.legislationYear}`;

    // Parse articles up-front so we can run the safety assertion before
    // touching the database. UI elements are stripped inside extractArticles().
    const newArticles = this.extractArticles(newText);
    const articleCount = Object.keys(newArticles).length;

    // ── Safety assertion ─────────────────────────────────────────────────────
    // If fewer than 20 articles were parsed, something is wrong: either the
    // page didn't render properly, or lob.gov.jo changed its HTML structure.
    // Committing 0 articles would silently corrupt the stored law text.
    // The smallest monitored law (قانون العمل) has 142 articles.
    const MIN_ARTICLES = 20;
    if (articleCount < MIN_ARTICLES) {
      throw new Error(
        `Safety check failed: only ${articleCount} articles parsed for ${lawId} ` +
          `(expected ≥${MIN_ARTICLES}). ` +
          `Possible causes: page rendered incorrectly, lob.gov.jo changed its format, ` +
          `or wrong law loaded. Refusing to commit to prevent data corruption.`
      );
    }

    const existing = await db
      .select()
      .from(laws)
      .where(eq(laws.lawId, lawId))
      .limit(1);

    if (existing.length === 0) {
      console.log("[LobGovScraper]   NEW law — inserting...");

      await db.insert(laws).values({
        lawId,
        arabicName: lawMeta.arabicName,
        englishName: lawMeta.englishName,
        year: String(lawMeta.legislationYear),
        fullText: newText,
        articleCount,
        lastUpdated: new Date(),
        lobGovUrl: lawMeta.lobGovUrl,
        isActive,
      });

      // Record initial version
      await db.insert(lawVersions).values({
        lawId,
        version: 1,
        fullText: newText,
        changesSummary: `Initial import — ${articleCount} articles`,
        amendmentDate: new Date(),
      });

      console.log(
        `[LobGovScraper]   Inserted: ${articleCount} articles parsed`
      );
    } else {
      const oldText = existing[0]!.fullText ?? "";

      // Compare article maps (not raw strings) so that UI element rendering
      // noise (e.g. "تفسير N" counts changing) never registers as a legal change.
      // Both sides are already stripped inside extractArticles().
      const oldArticles = this.extractArticles(oldText);
      const hasChanges = this.articleMapsAreDifferent(oldArticles, newArticles);

      if (!hasChanges) {
        console.log("[LobGovScraper]   No changes detected");
        // Always sync isActive and keep full_text current so the next scrape
        // has the freshest raw text and an accurate active status.
        const oldIsActive = existing[0]!.isActive;
        if (newText !== oldText || isActive !== oldIsActive) {
          await db
            .update(laws)
            .set({ fullText: newText, lastUpdated: new Date(), isActive })
            .where(eq(laws.lawId, lawId));
          if (isActive !== oldIsActive) {
            console.log(`[LobGovScraper]   Status changed: ${oldIsActive ? "active→inactive" : "inactive→active"}`);
          }
        }
        return;
      }

      console.log("[LobGovScraper]   CHANGES DETECTED — recording...");
      await this.recordLawChanges(lawId, oldArticles, newArticles);

      await db
        .update(laws)
        .set({ fullText: newText, lastUpdated: new Date(), articleCount, isActive })
        .where(eq(laws.lawId, lawId));

      // Record new version snapshot
      const [maxRow] = await db
        .select({ v: max(lawVersions.version) })
        .from(lawVersions)
        .where(eq(lawVersions.lawId, lawId));
      const nextVersion = (maxRow?.v ?? 0) + 1;
      const addedCount = Object.keys(newArticles).filter((k) => !(k in oldArticles)).length;
      const removedCount = Object.keys(oldArticles).filter((k) => !(k in newArticles)).length;
      const modifiedCount = Object.keys(newArticles).filter(
        (k) => k in oldArticles && oldArticles[k] !== newArticles[k]
      ).length;
      await db.insert(lawVersions).values({
        lawId,
        version: nextVersion,
        fullText: newText,
        changesSummary: [
          addedCount > 0 ? `${addedCount} added` : null,
          modifiedCount > 0 ? `${modifiedCount} modified` : null,
          removedCount > 0 ? `${removedCount} removed` : null,
        ]
          .filter(Boolean)
          .join(", "),
        amendmentDate: new Date(),
      });

      console.log("[LobGovScraper]   Updated with changes");
    }
  }

  /**
   * Returns true if the two article maps differ in any meaningful way:
   * articles added, removed, or with changed body text.
   */
  private articleMapsAreDifferent(
    oldArticles: Record<string, string>,
    newArticles: Record<string, string>
  ): boolean {
    const oldKeys = Object.keys(oldArticles);
    const newKeys = Object.keys(newArticles);
    if (oldKeys.length !== newKeys.length) return true;
    for (const key of newKeys) {
      if (newArticles[key] !== oldArticles[key]) return true;
    }
    return false;
  }

  private async recordLawChanges(
    lawId: string,
    oldArticles: Record<string, string>,
    newArticles: Record<string, string>
  ): Promise<void> {
    const affectedTypes = this.contractToLaws[lawId] ?? [];
    let count = 0;

    // Added articles
    for (const [num, text] of Object.entries(newArticles)) {
      if (oldArticles[num] === undefined) {
        await db.insert(lawChangelog).values({
          lawId,
          articleNumber: parseInt(num),
          changeType: "added",
          newText: text,
          affectedContractTypes: affectedTypes,
          detectedAt: new Date(),
        });
        count++;
      }
    }

    // Modified or removed articles
    for (const [num, oldArticleText] of Object.entries(oldArticles)) {
      const newArticleText = newArticles[num];
      if (newArticleText !== undefined && oldArticleText !== newArticleText) {
        await db.insert(lawChangelog).values({
          lawId,
          articleNumber: parseInt(num),
          changeType: "modified",
          oldText: oldArticleText,
          newText: newArticleText,
          affectedContractTypes: affectedTypes,
          detectedAt: new Date(),
        });
        count++;
      } else if (newArticleText === undefined) {
        await db.insert(lawChangelog).values({
          lawId,
          articleNumber: parseInt(num),
          changeType: "removed",
          oldText: oldArticleText,
          affectedContractTypes: affectedTypes,
          detectedAt: new Date(),
        });
        count++;
      }
    }

    console.log(`[LobGovScraper]   Recorded ${count} article-level changes`);
  }

  /**
   * Strip lob.gov.jo UI chrome from article body text before storing or comparing.
   *
   * The Angular app injects several UI elements into body.innerText that are NOT
   * part of the law itself:
   *   - "تفسير N"  — count of judicial interpretations linked to this article
   *   - "التشريعات المرتبطة N" — count of related legislation links
   *   - "ارتباطات المادة" — article relationship UI label
   *
   * Without stripping these, UI updates (e.g. a new interpretation being added to
   * an article) appear as law changes. Known false-positive sources:
   *   - "تفسير N" (judicial interpretations count) — triggered 17 false positives in القانون المدني
   *   - "الاحكام القضائية N" (judicial rulings count) — triggered 186 false positives in قانون التجارة
   */
  private stripUiElements(text: string): string {
    return text
      .replace(/^تفسير\s+\d+\s*/gm, "")
      .replace(/^التشريعات المرتبطة\s+\d+\s*/gm, "")
      .replace(/^الاحكام القضائية\s+\d+\s*/gm, "")
      .replace(/ارتباطات المادة\s*/g, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  /**
   * Extract articles from lob.gov.jo rendered text.
   *
   * lob.gov.jo format (from innerText): "المادة 1 ارتباطات المادة <text> المادة 2 ..."
   * The phrase "ارتباطات المادة" appears between the article number and the body.
   * We capture everything up to the next "المادة N" or end of string.
   *
   * UI elements (تفسير N, التشريعات المرتبطة N) are stripped from each article body
   * via stripUiElements() so that rendering noise never registers as a legal change.
   */
  private extractArticles(lawText: string): Record<string, string> {
    const articles: Record<string, string> = {};

    // Match "المادة <number>" optionally followed by "ارتباطات المادة"
    // then capture the body up to the next article heading
    const regex =
      /المادة\s+(\d+)(?:\s+ارتباطات المادة)?\s+([\s\S]+?)(?=المادة\s+\d+(?:\s+ارتباطات المادة)?|$)/g;

    let match;
    while ((match = regex.exec(lawText)) !== null) {
      const num = match[1];
      const rawText = match[2];
      if (num && rawText) {
        // lob.gov.jo's Angular SPA non-deterministically renders the article
        // number twice. The regex above consumes one "المادة N" heading, and the
        // duplicate leaks into the captured body. Strip a leading repeat of THIS
        // article's own heading so identical law text doesn't alternate between
        // "with heading" / "without heading" and trigger false-positive changes.
        const dupHeading = new RegExp(`^\\s*المادة\\s+${num}\\b\\s*`);
        const body = rawText.replace(dupHeading, "");
        const cleaned = this.stripUiElements(body);
        // Skip articles that only contain the amendments tab label — for
        // heavily-amended laws (e.g. قانون العمل) lob.gov.jo renders the
        // "تعديلات" tab as the visible content for replaced articles. We
        // exclude them rather than failing the entire import; the MIN_ARTICLES
        // check still guards against a completely failed page render.
        if (cleaned.length > 0 && cleaned.trim() !== "تعديلات") {
          articles[num] = cleaned;
        }
      }
    }
    return articles;
  }

  private countArticles(lawText: string): number {
    // Count distinct article numbers — "المادة N" where N is a number
    const matches = lawText.match(/المادة\s+\d+/g);
    if (!matches) return 0;
    // Deduplicate: same article number referenced in multiple places
    const unique = new Set(matches.map((m) => m.match(/\d+/)?.[0]));
    unique.delete(undefined as unknown as string);
    return unique.size;
  }

  async initializeContractLawMappings(): Promise<void> {
    const existing = await db.select().from(contractLawMappings).limit(1);
    if (existing.length > 0) return;

    const mappings = [
      {
        contractType: "employment",
        lawId: "8/1996",
        relevantArticles: [
          15, 35, 46, 56, 57, 61, 65, 70, 71, 72, 73, 74, 75, 76, 77, 78, 79,
          80, 81, 82, 83, 84, 85,
        ],
        priority: 1,
      },
      {
        contractType: "rental",
        lawId: "43/1976",
        relevantArticles: [192, 193, 194, 195, 196, 197, 198, 199, 200],
        priority: 2,
      },
      {
        contractType: "rental",
        lawId: "13/2019",
        relevantArticles: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
        priority: 1,
      },
      {
        contractType: "service",
        lawId: "43/1976",
        relevantArticles: [750, 751, 752, 753, 754, 755],
        priority: 1,
      },
      {
        contractType: "nda",
        lawId: "43/1976",
        relevantArticles: [143, 144, 145],
        priority: 1,
      },
      {
        contractType: "supplier",
        lawId: "43/1976",
        relevantArticles: [300, 301, 302, 303, 304],
        priority: 1,
      },
      {
        contractType: "supplier",
        lawId: "12/1966",
        relevantArticles: [1, 2, 3, 4, 5],
        priority: 2,
      },
    ];

    for (const mapping of mappings) {
      await db.insert(contractLawMappings).values(mapping);
    }

    console.log("[LobGovScraper] Contract-law mappings initialized");
  }
}

export const lobGovScraper = new LobGovJoPuppeteerScraper();
