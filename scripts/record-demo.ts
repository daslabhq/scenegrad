/**
 * Record the scenegrad demo gif.
 *
 * One trajectory: a support-triage agent built with Vercel AI SDK.
 * Watch the gap close from 4 → 0 across 5 steps as the agent reads
 * the ticket, enriches with account context, searches the KB, and
 * escalates an enterprise customer's critical issue to VIP.
 *
 * Usage:
 *   1. cd viewer && python3 -m http.server 7401 &
 *   2. bun scripts/record-demo.ts
 *   3. ffmpeg -i recording/*.webm -vf "fps=10,scale=860:-1" docs/demo.gif
 */

import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const URL = "http://localhost:7401/";
const OUT_DIR = "/Users/fm/git/daslab/ios2/Daslab/oss/scenegrad/docs/demo-recording";
mkdirSync(OUT_DIR, { recursive: true });

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1280, height: 760 },
  recordVideo: { dir: OUT_DIR, size: { width: 1280, height: 760 } },
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

await page.goto(URL, { waitUntil: "networkidle" });
await wait(700);

// Pick the support triage trajectory — the wow demo.
await page.selectOption("#example-picker", "example-traces/scenegrad-support-triage-haiku-4-5.jsonl");
await page.waitForSelector("#viewer:not(.hidden)");
await wait(1500);

// Scrub through every step with dwell time on each.
const total = parseInt(await page.textContent("#step-total") ?? "0", 10);
for (let i = 0; i < total; i++) {
  await setScrubber(i);
  await wait(1400);   // dwell so viewer can register what changed
}
await wait(1800);     // hold on the final state

await context.close();
await browser.close();

console.log(`✓ recording saved in ${OUT_DIR}/`);
