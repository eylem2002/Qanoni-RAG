/**
 * Fast parallel LegislationID scanner for lob.gov.jo
 * Opens 8 pages concurrently to scan a wide range of IDs quickly.
 *
 * Run with: pnpm --filter @workspace/scripts run discover-law-ids
 */

import { existsSync } from "fs";
import puppeteer, { type Browser } from "puppeteer-core";

const CHROME_CANDIDATES = [
  "/nix/store/0n9rl5l9syy808xi9bk4f6dhnfrvhkww-playwright-browsers-chromium/chromium-1080/chrome-linux/chrome",
  "/nix/store/ia69plrrvn7czdhn3flq1ll39i92ixab-chromium-92.0.4515.159/bin/chromium",
  "/usr/bin/chromium-browser",
  "/usr/bin/chromium",
];

function findChromium(): string {
  for (const p of CHROME_CANDIDATES) {
    if (existsSync(p)) return p;
  }
  throw new Error("No Chromium found");
}

// Laws we want to find
const TARGET_LAWS = [
  { name: "قانون العمل", number: 8, year: 1996 },
  { name: "القانون المدني", number: 43, year: 1976 },
  { name: "قانون الإيجار العقاري", number: 11, year: 1994 },
  { name: "قانون التجارة", number: 12, year: 1966 },
];

interface ScanResult {
  id: number;
  number: string | null;
  year: string | null;
  title: string | null;
  textLength: number;
  isLaw: boolean;
}

async function checkId(browser: Browser, id: number): Promise<ScanResult> {
  const page = await browser.newPage();
  // Disable images and CSS to speed up loading
  await page.setRequestInterception(true);
  page.on("request", (req) => {
    if (["image", "stylesheet", "font", "media"].includes(req.resourceType())) {
      req.abort();
    } else {
      req.continue();
    }
  });

  try {
    const url = `https://lob.gov.jo/?v=2&lang=ar#!/LegislationDetails?LegislationID=${id}&LegislationType=3&isMod=false`;
    await page.goto(url, { waitUntil: "networkidle2", timeout: 20000 });

    // Wait just a bit for Angular to render
    await new Promise((r) => setTimeout(r, 4000));

    return await page.evaluate((legislationId) => {
      // @ts-ignore
      const text = document.body.innerText || "";
      const numMatch = text.match(/رقم التشريع\s*\n?\s*(\d+)/);
      const yearMatch = text.match(/سنة التشريع\s*\n?\s*(\d+)/);
      const nameMatch = text.match(/(قانون|نظام|تعديل|اتفاقية|مرسوم)\s[^\n]{3,60}/);
      const hasContent =
        text.includes("رقم التشريع") && text.includes("سنة التشريع");
      const isLaw =
        (nameMatch ? nameMatch[0] : "").includes("قانون") ||
        text.includes("قانون العمل") ||
        text.includes("القانون المدني");

      return {
        id: legislationId,
        number: numMatch ? numMatch[1] : null,
        year: yearMatch ? yearMatch[1] : null,
        title: nameMatch ? nameMatch[0].trim().substring(0, 60) : null,
        textLength: text.length,
        isLaw,
      };
    }, id);
  } catch {
    return { id, number: null, year: null, title: null, textLength: 0, isLaw: false };
  } finally {
    await page.close();
  }
}

async function scanRange(
  browser: Browser,
  start: number,
  end: number,
  concurrency = 6
): Promise<void> {
  console.log(`\nScanning IDs ${start}–${end} (concurrency=${concurrency})...`);

  const ids = Array.from({ length: end - start + 1 }, (_, i) => start + i);

  for (let i = 0; i < ids.length; i += concurrency) {
    const batch = ids.slice(i, i + concurrency);
    const results = await Promise.all(batch.map((id) => checkId(browser, id)));

    for (const r of results) {
      if (r.number && r.year) {
        const isTarget = TARGET_LAWS.some(
          (l) => String(l.number) === r.number && String(l.year) === r.year
        );
        const marker = isTarget ? " *** TARGET FOUND ***" : "";
        const typeStr = r.isLaw ? "قانون" : "نظام/other";
        console.log(
          `  ID ${r.id}: ${typeStr} #${r.number}/${r.year} — "${r.title || "?"}"${marker}`
        );
      } else if (r.textLength > 3000) {
        console.log(`  ID ${r.id}: content (${r.textLength} chars) — no metadata`);
      }
      // else: skip empty/shell pages
    }
  }
}

async function main() {
  const executablePath = findChromium();
  console.log(`Chromium: ${executablePath}`);
  console.log(`Looking for: ${TARGET_LAWS.map((l) => `${l.name} (${l.number}/${l.year})`).join(", ")}\n`);

  const browser = await puppeteer.launch({
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

  try {
    // We know 3392 = نظام 67/1997. Scan broader ranges to find قانون entries.
    // Try several non-contiguous ranges to cover more ground quickly.
    await scanRange(browser, 100, 150, 5);
    await scanRange(browser, 500, 560, 5);
    await scanRange(browser, 1000, 1060, 5);
    await scanRange(browser, 2000, 2060, 5);
    await scanRange(browser, 2500, 2560, 5);
    await scanRange(browser, 3000, 3050, 5);
    await scanRange(browser, 3100, 3150, 5);
    await scanRange(browser, 3200, 3250, 5);
    await scanRange(browser, 3300, 3385, 5);
    await scanRange(browser, 3395, 3450, 5);
  } finally {
    await browser.close();
  }

  console.log("\nScan complete.");
}

main().catch(console.error);
