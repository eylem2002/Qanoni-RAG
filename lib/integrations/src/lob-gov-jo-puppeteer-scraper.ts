import { existsSync } from "fs";
import puppeteer, { type Browser, type Page } from "puppeteer-core";
import { db } from "@workspace/db";
import { laws, lawChangelog, contractLawMappings } from "@workspace/db";
import { eq } from "drizzle-orm";

// Ordered list of Chromium/Chrome executables to try
const CHROME_CANDIDATES = [
  // Playwright-managed Chromium (newer, preferred)
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
  private readonly timeout = 45000;
  private readonly retries = 3;

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
        "https://lob.gov.jo/?v=2&lang=ar#!/LegislationDetails?LegislationID=3392&LegislationType=3&isMod=false",
    },
    {
      legislationId: 3391,
      legislationNumber: 43,
      legislationYear: 1976,
      arabicName: "القانون المدني",
      englishName: "Civil Law",
      legislationType: "law",
      status: "active",
      lobGovUrl:
        "https://lob.gov.jo/?v=2&lang=ar#!/LegislationDetails?LegislationID=3391&LegislationType=3&isMod=false",
    },
    {
      legislationId: 3390,
      legislationNumber: 11,
      legislationYear: 1994,
      arabicName: "قانون الإيجار العقاري",
      englishName: "Real Estate Rental Law",
      legislationType: "law",
      status: "active",
      lobGovUrl:
        "https://lob.gov.jo/?v=2&lang=ar#!/LegislationDetails?LegislationID=3390&LegislationType=3&isMod=false",
    },
    {
      legislationId: 3389,
      legislationNumber: 12,
      legislationYear: 1966,
      arabicName: "قانون التجارة",
      englishName: "Commercial Law",
      legislationType: "law",
      status: "active",
      lobGovUrl:
        "https://lob.gov.jo/?v=2&lang=ar#!/LegislationDetails?LegislationID=3389&LegislationType=3&isMod=false",
    },
  ];

  private contractToLaws: Record<string, string[]> = {
    "8/1996": ["employment"],
    "43/1976": ["rental", "service", "nda", "supplier"],
    "11/1994": ["rental"],
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

  private async fetchAndStoreLaw(lawMeta: LobLawMetadata): Promise<void> {
    if (!this.browser) throw new Error("Browser not initialized");

    let attempt = 0;
    let lastError: Error | null = null;

    while (attempt < this.retries) {
      attempt++;
      const page = await this.browser.newPage();

      try {
        await page.setViewport({ width: 1920, height: 1080 });

        console.log(
          `[LobGovScraper]   Attempt ${attempt}/${this.retries}: navigating...`
        );

        await page.goto(lawMeta.lobGovUrl, {
          waitUntil: "networkidle2",
          timeout: this.timeout,
        });

        // Try to wait for content selector; tolerate if not found
        try {
          await page.waitForSelector(
            ".legislation-content, .law-text, main, article, [role='main'], .container",
            { timeout: 12000 }
          );
        } catch {
          console.warn(
            "[LobGovScraper]   Content selector not found, proceeding anyway..."
          );
        }

        // Extra wait for Angular to finish rendering
        await new Promise((resolve) => setTimeout(resolve, 3000));

        const lawText = await this.extractTextFromPage(page);

        if (!lawText || lawText.trim().length < 500) {
          throw new Error(
            `Insufficient text extracted (${lawText?.length ?? 0} chars)`
          );
        }

        console.log(
          `[LobGovScraper]   Extracted ${lawText.length} characters`
        );

        await this.processExtractedLaw(lawMeta, lawText);
        return;
      } catch (error) {
        lastError = error as Error;
        console.error(
          `[LobGovScraper]   Attempt ${attempt} failed: ${lastError.message}`
        );
        if (attempt < this.retries) {
          await new Promise((resolve) => setTimeout(resolve, 1500 * attempt));
        }
      } finally {
        await page.close();
      }
    }

    throw lastError ?? new Error("Unknown error in fetchAndStoreLaw");
  }

  private async extractTextFromPage(page: Page): Promise<string> {
    const text = await page.evaluate(() => {
      const selectors = [
        ".legislation-content",
        ".law-content",
        ".law-text",
        "main",
        "article",
        '[role="main"]',
        ".container main",
        ".page-content",
        "#content",
        "body",
      ];

      for (const selector of selectors) {
        // @ts-ignore — this runs inside the browser via page.evaluate()
        const el = document.querySelector(selector);
        if (el) {
          const content = el.textContent;
          if (content && content.trim().length > 500) {
            return content.trim();
          }
        }
      }

      // @ts-ignore — this runs inside the browser via page.evaluate()
      return document.body.textContent?.trim() ?? "";
    });

    return text
      .replace(/\s+/g, " ")
      .replace(/[\n\r]+/g, "\n")
      .trim();
  }

  private async processExtractedLaw(
    lawMeta: LobLawMetadata,
    newText: string
  ): Promise<void> {
    const lawId = `${lawMeta.legislationNumber}/${lawMeta.legislationYear}`;

    const existing = await db
      .select()
      .from(laws)
      .where(eq(laws.lawId, lawId))
      .limit(1);

    if (existing.length === 0) {
      console.log("[LobGovScraper]   NEW law — inserting...");
      const articleCount = this.countArticles(newText);

      await db.insert(laws).values({
        lawId,
        arabicName: lawMeta.arabicName,
        englishName: lawMeta.englishName,
        year: String(lawMeta.legislationYear),
        fullText: newText,
        articleCount,
        lastUpdated: new Date(),
        lobGovUrl: lawMeta.lobGovUrl,
        isActive: lawMeta.status === "active",
      });

      console.log(
        `[LobGovScraper]   Inserted: ${articleCount} articles found`
      );
    } else {
      const oldText = existing[0]!.fullText ?? "";

      if (newText === oldText) {
        console.log("[LobGovScraper]   No changes detected");
        return;
      }

      console.log("[LobGovScraper]   CHANGES DETECTED — recording...");
      await this.recordLawChanges(lawId, oldText, newText);

      await db
        .update(laws)
        .set({
          fullText: newText,
          lastUpdated: new Date(),
          articleCount: this.countArticles(newText),
        })
        .where(eq(laws.lawId, lawId));

      console.log("[LobGovScraper]   Updated with changes");
    }
  }

  private async recordLawChanges(
    lawId: string,
    oldText: string,
    newText: string
  ): Promise<void> {
    const oldArticles = this.extractArticles(oldText);
    const newArticles = this.extractArticles(newText);
    const affectedTypes = this.contractToLaws[lawId] ?? [];
    let count = 0;

    for (const [num, text] of Object.entries(newArticles)) {
      if (!oldArticles[num]) {
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

    for (const [num, oldArticleText] of Object.entries(oldArticles)) {
      const newArticleText = newArticles[num];
      if (newArticleText && oldArticleText !== newArticleText) {
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
      }
      if (!newArticles[num]) {
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

  private extractArticles(lawText: string): Record<string, string> {
    const regex = /المادة\s+(\d+)\s*:\s*(.+?)(?=المادة\s+\d+|$)/gs;
    const articles: Record<string, string> = {};
    let match;
    while ((match = regex.exec(lawText)) !== null) {
      const num = match[1];
      const text = match[2];
      if (num && text) articles[num] = text.trim();
    }
    return articles;
  }

  private countArticles(lawText: string): number {
    const regex = /المادة\s+(\d+)\s*:/g;
    let count = 0;
    while (regex.exec(lawText) !== null) count++;
    return count;
  }

  async initializeContractLawMappings(): Promise<void> {
    const existing = await db.select().from(contractLawMappings).limit(1);
    if (existing.length > 0) return;

    const mappings = [
      {
        contractType: "employment",
        lawId: "8/1996",
        relevantArticles: [15, 35, 46, 56, 57, 61, 65, 70, 71, 72, 73, 74, 75, 76, 77, 78, 79, 80, 81, 82, 83, 84, 85],
        priority: 1,
      },
      { contractType: "rental", lawId: "43/1976", relevantArticles: [192, 193, 194, 195, 196, 197, 198, 199, 200], priority: 1 },
      { contractType: "rental", lawId: "11/1994", relevantArticles: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], priority: 1 },
      { contractType: "service", lawId: "43/1976", relevantArticles: [750, 751, 752, 753, 754, 755], priority: 1 },
      { contractType: "nda", lawId: "43/1976", relevantArticles: [143, 144, 145], priority: 1 },
      { contractType: "supplier", lawId: "43/1976", relevantArticles: [300, 301, 302, 303, 304], priority: 1 },
      { contractType: "supplier", lawId: "12/1966", relevantArticles: [1, 2, 3, 4, 5], priority: 2 },
    ];

    for (const mapping of mappings) {
      await db.insert(contractLawMappings).values(mapping);
    }

    console.log("[LobGovScraper] Contract-law mappings initialized");
  }
}

export const lobGovScraper = new LobGovJoPuppeteerScraper();
