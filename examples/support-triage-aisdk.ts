/**
 * Support-ticket triage agent — Vercel AI SDK + scenegrad observer mode.
 *
 * Genuine multi-step useful agent: read a ticket → enrich with account
 * context → check KB for matches → decide route (auto-resolve / escalate
 * to T2 / escalate to VIP) → take that route.
 *
 * scenegrad observer sits alongside, snapshots a mock CRM/KB world
 * after each tool, gives the agent a runtime checklist via status()
 * injected into the system prompt.
 *
 * Showcases:
 *   - Vercel AI SDK's `generateText` with tools + stopWhen
 *   - scenegrad observer attached via onStepFinish (one extra line)
 *   - Per-turn status() injection that keeps the agent on policy
 *   - Trajectory + assertion deltas as observable artifacts
 *
 * Run: ANTHROPIC_API_KEY=... bun examples/support-triage-aisdk.ts
 */

import { generateText, tool, stepCountIs } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { z } from "zod";
import { observe } from "scenegrad";

// ---------------------------------------------------------------------------
// Mock world — in a real app this is your CRM / KB / ticketing API
// ---------------------------------------------------------------------------

interface Ticket {
  id:        string;
  subject:   string;
  body:      string;
  customer:  string;
  status:    "new" | "investigating" | "auto-resolved" | "escalated-t2" | "escalated-vip";
  enriched?: { tier: "free" | "pro" | "enterprise"; ltv_usd: number; prior_incidents: number };
  kb_match?: string;
  reply?:    string;
}

interface World {
  ticket: Ticket;
  customer_db: Record<string, { tier: "free" | "pro" | "enterprise"; ltv_usd: number; prior_incidents: number }>;
  kb: Array<{ id: string; title: string; matches: string[] }>;
}

// Seed a realistic-feeling ticket
const world: World = {
  ticket: {
    id:       "TKT-9341",
    subject:  "Webhook deliveries failing with 504",
    body:     "We've had 12 webhook timeouts since 2pm UTC. Our integration is critical for our checkout flow. Please advise ASAP.",
    customer: "acme-corp",
    status:   "new",
  },
  customer_db: {
    "acme-corp":    { tier: "enterprise", ltv_usd: 480_000, prior_incidents: 3 },
    "small-startup": { tier: "free",       ltv_usd: 0,        prior_incidents: 12 },
  },
  kb: [
    { id: "KB-101", title: "Webhook delivery troubleshooting",       matches: ["webhook", "504", "timeout", "delivery"] },
    { id: "KB-203", title: "Increase webhook timeout in dashboard",   matches: ["webhook", "504", "configuration"] },
    { id: "KB-405", title: "Reset password",                          matches: ["password", "login"] },
  ],
};

// ---------------------------------------------------------------------------
// Goal — what "done" means for this triage flow
// ---------------------------------------------------------------------------

const watcher = observe<World>({
  snapshot: async () => structuredClone(world),

  goal: (s) => [
    { name: "ticket_enriched_with_account_context",
      check: (s) => ({ satisfied: !!s.ticket.enriched, gap: 1, weight: 1 }) },

    { name: "kb_searched",
      check: (s) => ({ satisfied: s.ticket.kb_match !== undefined, gap: 1, weight: 1 }) },

    { name: "ticket_routed",
      check: (s) => ({
        satisfied: s.ticket.status !== "new" && s.ticket.status !== "investigating",
        gap: 1, weight: 2,
      }) },

    { name: "enterprise_ticket_must_escalate",
      check: (s) => {
        const isEnterprise = s.ticket.enriched?.tier === "enterprise";
        const wasAutoResolved = s.ticket.status === "auto-resolved";
        return {
          satisfied: !(isEnterprise && wasAutoResolved),
          gap: (isEnterprise && wasAutoResolved) ? 1 : 0,
          weight: 5,  // ← cardinal sin: don't auto-resolve enterprise tickets
        };
      } },
  ],
});

// ---------------------------------------------------------------------------
// Tools — Vercel AI SDK native
// ---------------------------------------------------------------------------

const tools = {
  read_ticket: tool({
    description: "Read the current ticket details.",
    inputSchema: z.object({}),
    execute: async () => world.ticket,
  }),

  enrich_with_account: tool({
    description: "Look up the customer's account tier, LTV, and incident history.",
    inputSchema: z.object({
      customer_id: z.string().describe("e.g. acme-corp"),
    }),
    execute: async ({ customer_id }) => {
      const profile = world.customer_db[customer_id];
      if (!profile) return { error: "customer not found" };
      world.ticket.enriched = profile;
      world.ticket.status = "investigating";
      return profile;
    },
  }),

  search_kb: tool({
    description: "Search the knowledge base for articles matching keywords from the ticket.",
    inputSchema: z.object({
      keywords: z.array(z.string()).describe("e.g. ['webhook', '504']"),
    }),
    execute: async ({ keywords }) => {
      const matches = world.kb.filter(article =>
        keywords.some(k => article.matches.some(m => m.toLowerCase().includes(k.toLowerCase()))));
      const best = matches[0];
      world.ticket.kb_match = best?.id ?? "no-match";
      return { matches, best_match: best };
    },
  }),

  auto_resolve: tool({
    description: "Auto-resolve the ticket with a KB-based reply. Only use for non-enterprise + clear KB match.",
    inputSchema: z.object({
      reply: z.string().describe("The auto-response to send"),
    }),
    execute: async ({ reply }) => {
      world.ticket.reply = reply;
      world.ticket.status = "auto-resolved";
      return { ok: true, status: "auto-resolved" };
    },
  }),

  escalate_t2: tool({
    description: "Escalate to Tier-2 engineering support. Use for non-VIP technical issues.",
    inputSchema: z.object({
      reason: z.string(),
    }),
    execute: async ({ reason }) => {
      world.ticket.reply = `Escalated to T2: ${reason}`;
      world.ticket.status = "escalated-t2";
      return { ok: true, status: "escalated-t2" };
    },
  }),

  escalate_vip: tool({
    description: "Escalate to VIP support team. Use for enterprise customers with critical issues.",
    inputSchema: z.object({
      reason:  z.string(),
      urgency: z.enum(["high", "critical"]),
    }),
    execute: async ({ reason, urgency }) => {
      world.ticket.reply = `[${urgency.toUpperCase()}] Escalated to VIP: ${reason}`;
      world.ticket.status = "escalated-vip";
      return { ok: true, status: "escalated-vip" };
    },
  }),
};

// ---------------------------------------------------------------------------
// Run — agent loop with status injection
// ---------------------------------------------------------------------------

if (!process.env.ANTHROPIC_API_KEY) {
  console.error("ANTHROPIC_API_KEY not set");
  process.exit(1);
}

console.log(`\nTicket: ${world.ticket.id} — "${world.ticket.subject}"`);
console.log(`Customer: ${world.ticket.customer}`);
console.log(`Body: ${world.ticket.body}\n`);

const initial = await watcher.status();
console.log(`[scenegrad: ${initial.satisfied.length}/${initial.assertions.length} done]\n`);

const result = await generateText({
  model: anthropic("claude-haiku-4-5"),
  stopWhen: stepCountIs(8),
  tools,

  // The system prompt is regenerated on every step via `prepareStep` —
  // so the agent always sees fresh status from scenegrad.
  prepareStep: async ({ stepNumber }) => {
    const status = await watcher.status();
    return {
      system: [
        "You are a support ticket triage agent.",
        "",
        "Policy:",
        "  1. Always enrich the ticket with account context FIRST.",
        "  2. Always search the KB for matching articles.",
        "  3. Route the ticket: auto_resolve (clear KB match + non-enterprise),",
        "     escalate_t2 (technical issues, non-VIP), or",
        "     escalate_vip (enterprise customers with urgency).",
        "  4. Enterprise customers MUST be escalated to VIP, never auto-resolved.",
        "",
        `Progress: ${status.satisfied.length}/${status.assertions.length} satisfied.`,
        `Still unmet: ${status.unmet.map(a => a.name).join(", ") || "(none — done)"}.`,
      ].join("\n"),
    };
  },

  // scenegrad's only line of integration: re-snapshot the world after each tool result.
  onStepFinish: async ({ toolCalls }) => {
    for (const call of toolCalls ?? []) {
      await watcher.recordStep({
        tool: { name: call.toolName, args: (call as any).input ?? (call as any).args ?? {} },
      });
    }
    if (!toolCalls || toolCalls.length === 0) await watcher.recordStep({});
  },

  prompt: `Triage ticket ${world.ticket.id}. Read it, enrich it, search the KB, then route.`,
});

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

const final = await watcher.status();
console.log(`\n=== Final ===`);
console.log(`status: ${world.ticket.status}`);
console.log(`reply:  ${world.ticket.reply ?? "(none)"}`);
console.log(`done:   ${final.done ? "✓ all assertions satisfied" : `✗ ${final.unmet.length} unmet`}`);
console.log(`gap:    ${final.gap}`);
console.log(`steps:  ${watcher.trajectory().length}`);

console.log(`\nTrajectory:`);
for (const t of watcher.trajectory()) {
  const tool = t.tool ? `${t.tool.name}` : "(none)";
  console.log(`  #${t.step} ${tool}  d:${t.d_before}→${t.d_after} (Δ${t.delta})`);
}

console.log(`\nFinal assertion state:`);
for (const a of final.assertions) {
  console.log(`  ${a.satisfied ? "✓" : "✗"} ${a.name}${a.satisfied ? "" : `  (gap ${a.gap})`}`);
}

console.log(`\nUsage: ${result.usage.inputTokens} in, ${result.usage.outputTokens} out`);
