/**
 * Record a demo video of the viewer using Playwright.
 *
 * Usage:
 *   1. Start the static server first: `cd viewer && python3 -m http.server 7401`
 *   2. Run: `bun scripts/record-demo.ts`
 *   3. Convert: `ffmpeg -i out/demo.webm -vf "fps=15,scale=1100:-1" docs/demo.gif`
 *
 * The script visits the viewer, loads a trajectory, scrubs through with
 * pauses at interesting moments (drift annotation), then loads a second
 * trajectory. ~25 seconds.
 */

import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const URL = "http://localhost:7401/";
const OUT_DIR = "/Users/fm/git/daslab/ios2/Daslab/oss/scenegrad/docs/demo-recording";
mkdirSync(OUT_DIR, { recursive: true });

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1280, height: 800 },
  recordVideo: { dir: OUT_DIR, size: { width: 1280, height: 800 } },
});
const page = await context.newPage();

const wait = (ms: number) => page.waitForTimeout(ms);

async function setScrubber(idx: number) {
  await page.evaluate((i) => {
    const s = document.getElementById("scrubber") as HTMLInputElement;
    s.value = String(i);
    s.dispatchEvent(new Event("input", { bubbles: true }));
  }, idx);
}

// ── Scene 1: open the loader page ────────────────────────────────────────
await page.goto(URL, { waitUntil: "networkidle" });
await wait(900);

// ── Scene 2: load the recolor+mirror trajectory ──────────────────────────
await page.selectOption("#example-picker", "example-traces/scenegrad-arc-recolor_then_mirror-claude-haiku-4-5.jsonl");
await page.waitForSelector("#viewer:not(.hidden)");
await wait(1400);

// ── Scene 3: pause at step 0 — show the drift annotation prominently ────
await setScrubber(0);
await wait(2400);

// ── Scene 4: scrub forward to step 1 ─────────────────────────────────────
await setScrubber(1);
await wait(2200);

// ── Scene 5: open the raw JSON details ───────────────────────────────────
await page.click("#raw-step", { force: true }).catch(() => {});
await wait(1200);
await page.evaluate(() => {
  const d = document.querySelector("details");
  if (d) (d as HTMLDetailsElement).open = true;
});
await wait(1500);
await page.evaluate(() => {
  const d = document.querySelector("details");
  if (d) (d as HTMLDetailsElement).open = false;
});
await wait(500);

// ── Scene 6: load the AB Jordan-Lee trajectory ───────────────────────────
await page.click("#reset-btn");
await page.waitForSelector("#loader:not(.hidden)");
await wait(700);
await page.selectOption("#example-picker", "example-traces/scenegrad-ab-simple_email_sf_contact_phone_update-claude-haiku-4-5.jsonl");
await page.waitForSelector("#viewer:not(.hidden)");
await wait(1300);

// ── Scene 7: scrub through all steps slowly ──────────────────────────────
const total = parseInt(await page.textContent("#step-total") ?? "0", 10);
for (let i = 0; i < total; i++) {
  await setScrubber(i);
  await wait(700);
}
await wait(800);

await context.close();
await browser.close();

console.log(`✓ recording saved in ${OUT_DIR}/`);
