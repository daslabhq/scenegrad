/**
 * Tier-0 demo: drop scenegrad into a Vercel AI SDK agent in 2 lines.
 *
 * No goal. No assertions. No snapshot. Just a JSONL trace of every tool
 * call the agent makes, scrubbable in the scenegrad viewer.
 *
 * This is the lowest-friction entry point. The dev gets a better debug
 * experience than console.log, with zero design work upfront. They can
 * level up by adding `snapshot` and `goal` later — see onboarding.ts and
 * support-triage-aisdk.ts for tier-1 and tier-2.
 *
 * Run: ANTHROPIC_API_KEY=... bun examples/trace-only-aisdk.ts
 */

import { generateText, tool, stepCountIs } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { z } from "zod";
import { trace } from "scenegrad";

// ── Your existing agent code ──────────────────────────────────────────────

const tools = {
  search_logs: tool({
    description: "Search application logs for a query string.",
    inputSchema: z.object({ query: z.string(), since: z.string().optional() }),
    execute: async ({ query }) => {
      // (mock) — real implementation would query your logging service
      if (/timeout|504/i.test(query)) {
        return { matches: 12, sample: "504 from upstream at 14:02:37" };
      }
      return { matches: 0, sample: null };
    },
  }),
  check_status_page: tool({
    description: "Check the public status page for known incidents.",
    inputSchema: z.object({ service: z.string() }),
    execute: async ({ service }) => ({
      service, incident: false, last_updated: "2026-05-03T13:55:00Z"
    }),
  }),
  draft_response: tool({
    description: "Draft a customer-facing response. Returns the draft text.",
    inputSchema: z.object({ tone: z.enum(["empathetic", "technical"]), summary: z.string() }),
    execute: async ({ tone, summary }) => ({
      draft: `[${tone}] ${summary}`,
    }),
  }),
};

// ── The two scenegrad lines ───────────────────────────────────────────────

const t = trace.start({ name: "support-debug" });

// ── Your existing AI SDK call, with one extra prop ────────────────────────

if (!process.env.ANTHROPIC_API_KEY) {
  console.error("ANTHROPIC_API_KEY not set");
  process.exit(1);
}

const result = await generateText({
  model: anthropic("claude-haiku-4-5"),
  stopWhen: stepCountIs(6),
  tools,
  onStepFinish: t.captureStep,         // ← only addition
  prompt: "Customer reports: webhooks failing with 504s for the last 30 min. Investigate and draft a response.",
});

t.dump("./viewer/example-traces/scenegrad-trace-support-debug.jsonl");

// ── Inspect the captured trace ─────────────────────────────────────────────

console.log(`\nAgent text: ${result.text}\n`);
console.log(`Captured ${t.trajectory().length} steps:`);
for (const step of t.trajectory()) {
  const tool = step.tool ? `${step.tool.name}(${JSON.stringify(step.tool.args).slice(0, 60)})` : "(none)";
  console.log(`  #${step.step}  ${tool}  +${step.ts_ms}ms`);
}
console.log(`\n→ trace dumped to viewer/example-traces/scenegrad-trace-support-debug.jsonl`);
console.log(`  open viewer/index.html and load it to scrub.\n`);
