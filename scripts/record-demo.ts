/**
 * Record the scenegrad demo gif.
 *
 * Story arc:
 *   1. Bulk view loads — 12 trajectories, see the distribution at a glance
 *   2. Filter to escalated-vip — 3 cards remain
 *   3. Click "All" — back to 12
 *   4. Click into the TKT-9341 card — drills into single-trace viewer
 *   5. Scrub through the trajectory — watch the ticket morph
 *
 * Usage:
 *   1. cd viewer && python3 -m http.server 7401 &
 *   2. bun scripts/record-demo.ts
 */

import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const URL = "http://localhost:7401/bulk.html";
const OUT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..", "docs", "demo-recording");
mkdirSync(OUT_DIR, { recursive: true });

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1280, height: 1100 },
  recordVideo: { dir: OUT_DIR, size: { width: 1280, height: 1100 } },
});
const page = await context.newPage();

const wait = (ms: number) => page.waitForTimeout(ms);

// Scene 1: bulk view loads
await page.goto(URL, { waitUntil: "networkidle" });
await wait(1700);

// Scene 2: filter to vip
await page.click('[data-filter="escalated-vip"]');
await wait(1800);

// Scene 3: back to all
await page.click('[data-filter=""]');
await wait(1300);

// Scene 4: filter to t2 briefly
await page.click('[data-filter="escalated-t2"]');
await wait(1500);

// Scene 5: back to all, then click TKT-9341 to drill in
await page.click('[data-filter=""]');
await wait(900);

// Click the first card (TKT-9341)
await page.click('a[href*="TKT-9341"]');
await page.waitForSelector("#viewer:not(.hidden)", { timeout: 5000 });
await wait(1400);

// Scene 6: scrub through the trajectory
async function setScrubber(idx: number) {
  await page.evaluate((i) => {
    const s = document.getElementById("scrubber") as HTMLInputElement;
    s.value = String(i);
    s.dispatchEvent(new Event("input", { bubbles: true }));
  }, idx);
}

const total = parseInt(await page.textContent("#step-total") ?? "0", 10);
for (let i = 0; i < total; i++) {
  await setScrubber(i);
  await wait(1700);
}
await wait(1800);

await context.close();
await browser.close();

console.log(`✓ recording saved in ${OUT_DIR}/`);
