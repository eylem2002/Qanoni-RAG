import axios, { type AxiosInstance } from "axios";
import * as cheerio from "cheerio";
import { db } from "@workspace/db";
import {
  laws,
  lawChangelog,
  contractLawMappings,
} from "@workspace/db";
import { eq } from "drizzle-orm";

export class LobGovJoScraper {
  private baseUrl = "https://lob.gov.jo";
  private http: AxiosInstance;

  private contractToLaws: Record<string, Array<{ lawId: string; name: string; priority: number }>> = {
    employment: [{ lawId: "8/1996", name: "قانون العمل", priority: 1 }],
    rental: [
      { lawId: "43/1976", name: "القانون المدني", priority: 1 },
      { lawId: "11/1994", name: "قانون الإيجار العقاري", priority: 1 },
    ],
    service: [{ lawId: "43/1976", name: "القانون المدني", priority: 1 }],
    nda: [{ lawId: "43/1976", name: "القانون المدني", priority: 1 }],
    supplier: [
      { lawId: "43/1976", name: "القانون المدني", priority: 1 },
      { lawId: "12/1966", name: "قانون التجارة", priority: 2 },
    ],
  };

  constructor() {
    this.http = axios.create({
      baseURL: this.baseUrl,
      timeout: 15000,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
    });
  }

  async updateAllLaws(): Promise<void> {
    const lawsToFetch = [
      { lawId: "8/1996", name: "قانون العمل" },
      { lawId: "43/1976", name: "القانون المدني" },
      { lawId: "11/1994", name: "قانون الإيجار العقاري" },
      { lawId: "12/1966", name: "قانون التجارة" },
    ];

    for (const law of lawsToFetch) {
      try {
        await this.fetchAndStoreLaw(law.lawId, law.name);
      } catch (error) {
        console.error(`[LobGovScraper] Failed to fetch ${law.lawId}:`, error);
      }
    }
  }

  private async fetchAndStoreLaw(lawId: string, arabicName: string): Promise<void> {
    const parts = lawId.split("/");
    const number = parts[0];
    const year = parts[1] ?? "";
    const lawUrl = `${this.baseUrl}/ar/law/${number}/${year}`;

    const response = await this.http.get(lawUrl);
    const newText = this.extractLawText(response.data as string);

    if (!newText || newText.trim().length < 200) {
      console.warn(`[LobGovScraper] Failed to extract text from ${lawId}`);
      return;
    }

    const existingLaw = await db
      .select()
      .from(laws)
      .where(eq(laws.lawId, lawId))
      .limit(1);

    if (existingLaw.length === 0) {
      const articleCount = this.countArticles(newText);
      await db.insert(laws).values({
        lawId,
        arabicName,
        year,
        fullText: newText,
        articleCount,
        lastUpdated: new Date(),
        lobGovUrl: lawUrl,
        isActive: true,
      });
    } else {
      const oldText = existingLaw[0]!.fullText;
      if (newText !== oldText) {
        await this.recordLawChanges(lawId, oldText, newText);
        await db
          .update(laws)
          .set({
            fullText: newText,
            lastUpdated: new Date(),
            articleCount: this.countArticles(newText),
          })
          .where(eq(laws.lawId, lawId));
      }
    }
  }

  private extractLawText(html: string): string {
    const $ = cheerio.load(html);
    let text =
      $(".law-content").text() ||
      $(".law-text").text() ||
      $("main").text() ||
      $("article").text() ||
      $(".content").text() ||
      $("body").text();

    text = text
      .replace(/\s+/g, " ")
      .replace(/[\n\r]+/g, "\n")
      .trim();

    return text;
  }

  private async recordLawChanges(
    lawId: string,
    oldText: string,
    newText: string
  ): Promise<void> {
    const oldArticles = this.extractArticles(oldText);
    const newArticles = this.extractArticles(newText);

    const affectedTypes = Object.entries(this.contractToLaws)
      .filter(([, lawList]) => lawList.some((l) => l.lawId === lawId))
      .map(([type]) => type);

    for (const [articleNum, newArticleText] of Object.entries(newArticles)) {
      if (!oldArticles[articleNum]) {
        await db.insert(lawChangelog).values({
          lawId,
          articleNumber: parseInt(articleNum),
          changeType: "added",
          newText: newArticleText,
          affectedContractTypes: affectedTypes,
          detectedAt: new Date(),
        });
      }
    }

    for (const [articleNum, oldArticleText] of Object.entries(oldArticles)) {
      const newArticleText = newArticles[articleNum];
      if (newArticleText && oldArticleText !== newArticleText) {
        await db.insert(lawChangelog).values({
          lawId,
          articleNumber: parseInt(articleNum),
          changeType: "modified",
          oldText: oldArticleText,
          newText: newArticleText,
          affectedContractTypes: affectedTypes,
          detectedAt: new Date(),
        });
      }
      if (!newArticles[articleNum]) {
        await db.insert(lawChangelog).values({
          lawId,
          articleNumber: parseInt(articleNum),
          changeType: "removed",
          oldText: oldArticleText,
          affectedContractTypes: affectedTypes,
          detectedAt: new Date(),
        });
      }
    }
  }

  private extractArticles(lawText: string): Record<string, string> {
    const articleRegex = /المادة\s+(\d+)\s*:\s*(.+?)(?=المادة\s+\d+|$)/gs;
    const articles: Record<string, string> = {};
    let match;
    while ((match = articleRegex.exec(lawText)) !== null) {
      const articleNum = match[1]!;
      const articleText = match[2]!.trim();
      articles[articleNum] = articleText;
    }
    return articles;
  }

  private countArticles(lawText: string): number {
    const articleRegex = /المادة\s+(\d+)\s*:/g;
    let count = 0;
    while (articleRegex.exec(lawText) !== null) count++;
    return count;
  }

  async initializeContractLawMappings(): Promise<void> {
    const existing = await db.select().from(contractLawMappings).limit(1);
    if (existing.length > 0) {
      return;
    }

    const mappings = [
      {
        contractType: "employment",
        lawId: "8/1996",
        relevantArticles: [15, 35, 46, 56, 57, 61, 65, 70, 71, 72, 73, 74, 75, 76, 77, 78, 79, 80, 81, 82, 83, 84, 85],
        priority: 1,
      },
      {
        contractType: "rental",
        lawId: "43/1976",
        relevantArticles: [192, 193, 194, 195, 196, 197, 198, 199, 200],
        priority: 1,
      },
      {
        contractType: "rental",
        lawId: "11/1994",
        relevantArticles: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
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
  }
}

export const lobGovScraper = new LobGovJoScraper();
