/**
 * Generate a varied test suite of support-triage trajectories.
 *
 * 12 tickets across customer tiers and issue types. Some should auto-resolve,
 * some escalate-t2, some escalate-vip. The bulk viewer renders the
 * distribution so you can spot patterns at a glance.
 *
 * Run: ANTHROPIC_API_KEY=... bun scripts/generate-suite.ts [--model claude-haiku-4-5]
 *
 * Output: viewer/example-traces/suite/<id>.jsonl + viewer/example-traces/suite/manifest.json
 */

import { generateText, tool, stepCountIs } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { z } from "zod";
import { observe } from "scenegrad";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Types — same shape as examples/support-triage-aisdk.ts
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

interface CustomerProfile {
  tier: "free" | "pro" | "enterprise";
  ltv_usd: number;
  prior_incidents: number;
}

interface KBArticle {
  id: string;
  title: string;
  matches: string[];
}

const SHARED_KB: KBArticle[] = [
  { id: "KB-101", title: "Webhook delivery troubleshooting",     matches: ["webhook", "504", "timeout", "delivery"] },
  { id: "KB-203", title: "Increase webhook timeout in dashboard", matches: ["webhook", "504", "configuration"] },
  { id: "KB-405", title: "Reset password",                        matches: ["password", "login", "reset"] },
  { id: "KB-501", title: "Recover locked account",                matches: ["locked", "account", "login"] },
  { id: "KB-612", title: "Update billing address",                matches: ["billing", "address", "invoice"] },
  { id: "KB-701", title: "Export data via API",                   matches: ["export", "api", "csv", "data"] },
];

const CUSTOMER_DB: Record<string, CustomerProfile> = {
  "acme-corp":         { tier: "enterprise", ltv_usd: 480_000, prior_incidents: 3 },
  "stripe":            { tier: "enterprise", ltv_usd: 1_200_000, prior_incidents: 1 },
  "linear":            { tier: "enterprise", ltv_usd: 320_000, prior_incidents: 0 },
  "smallco":           { tier: "pro", ltv_usd: 12_400, prior_incidents: 2 },
  "gardenshop-llc":    { tier: "pro", ltv_usd: 8_900, prior_incidents: 5 },
  "indie-dev-john":    { tier: "pro", ltv_usd: 1_200, prior_incidents: 0 },
  "free-user-1":       { tier: "free", ltv_usd: 0, prior_incidents: 0 },
  "free-user-2":       { tier: "free", ltv_usd: 0, prior_incidents: 1 },
  "free-trial-acme":   { tier: "free", ltv_usd: 0, prior_incidents: 0 },
};

// ---------------------------------------------------------------------------
// 12 ticket variants — designed to exercise different paths
// ---------------------------------------------------------------------------

const TICKETS: { id: string; subject: string; body: string; customer: string }[] = [
  // Enterprise + critical → should escalate-vip
  { id: "TKT-9341", customer: "acme-corp",
    subject: "Webhook deliveries failing with 504",
    body: "We've had 12 webhook timeouts since 2pm UTC. Our integration is critical for our checkout flow. Please advise ASAP." },
  { id: "TKT-9342", customer: "stripe",
    subject: "Production outage — payment processing down",
    body: "Critical issue: payment processing has been failing for 8 minutes. We're losing revenue. Need immediate help." },
  { id: "TKT-9343", customer: "linear",
    subject: "Data export hung for 30 minutes",
    body: "Our scheduled data export to S3 has been stuck for 30 min. Blocking our weekly board report." },

  // Enterprise + non-critical → should still escalate (probably t2 or vip given tier)
  { id: "TKT-9344", customer: "acme-corp",
    subject: "Question about billing address change",
    body: "How do I update our billing address for next month's invoice? Just need to know the right form." },

  // Pro + technical issue → escalate-t2
  { id: "TKT-9345", customer: "smallco",
    subject: "API rate limit hit unexpectedly",
    body: "We're being rate-limited at 200 RPM but our plan says 1000. Can someone check?" },
  { id: "TKT-9346", customer: "gardenshop-llc",
    subject: "Export failing with weird error",
    body: "When I try to export our data via API I get 'malformed cursor' but I'm using the example from your docs." },

  // Pro + clear KB match → auto-resolve
  { id: "TKT-9347", customer: "indie-dev-john",
    subject: "Password reset not working",
    body: "I clicked forgot password and never got the email. Tried twice." },

  // Free + clear KB match → auto-resolve
  { id: "TKT-9348", customer: "free-user-1",
    subject: "Forgot my password",
    body: "Hi, I forgot my password. How do I reset it?" },
  { id: "TKT-9349", customer: "free-user-2",
    subject: "Locked out of account",
    body: "My account is locked after I typed the password wrong a few times. Help?" },

  // Free + complex → escalate-t2
  { id: "TKT-9350", customer: "free-trial-acme",
    subject: "Webhook setup confusion",
    body: "Trying to set up webhooks for the first time. Following the docs but getting 504s. Are webhooks supported on the free plan?" },

  // Free + simple billing question → auto-resolve via KB
  { id: "TKT-9351", customer: "free-user-1",
    subject: "How do I update my address?",
    body: "I moved last month, need to update my billing address." },

  // Enterprise + ambiguous → tests the cardinal-sin assertion
  { id: "TKT-9352", customer: "stripe",
    subject: "Quick password reset question",
    body: "Hi team, just need to reset my password. Should be quick." },
  // ^ This one is tricky — looks like a KB-match candidate but customer is enterprise.
  //   The agent SHOULD escalate-vip (or at minimum NOT auto-resolve), per cardinal-sin.
];

// ---------------------------------------------------------------------------
// Tools — same as support-triage example, but parameterized by world ref
// ---------------------------------------------------------------------------

function buildTools(world: { ticket: Ticket; kb: KBArticle[] }, recordStep: (tool: string, args: any) => Promise<void>) {
  const recorded = <I, O>(name: string, exec: (input: I) => Promise<O> | O) =>
    async (input: I) => {
      const result = await exec(input);
      await recordStep(name, input);
      return result;
    };

  return {
    read_ticket: tool({
      description: "Read the current ticket details.",
      inputSchema: z.object({}),
      execute: recorded("read_ticket", async () => world.ticket),
    }),
    enrich_with_account: tool({
      description: "Look up the customer's account tier, LTV, and incident history.",
      inputSchema: z.object({ customer_id: z.string() }),
      execute: recorded("enrich_with_account", async ({ customer_id }) => {
        const profile = CUSTOMER_DB[customer_id];
        if (!profile) return { error: "customer not found" };
        world.ticket.enriched = profile;
        world.ticket.status = "investigating";
        return profile;
      }),
    }),
    search_kb: tool({
      description: "Search the knowledge base for articles matching keywords from the ticket.",
      inputSchema: z.object({ keywords: z.array(z.string()) }),
      execute: recorded("search_kb", async ({ keywords }) => {
        const matches = world.kb.filter(article =>
          keywords.some(k => article.matches.some(m => m.toLowerCase().includes(k.toLowerCase()))));
        const best = matches[0];
        world.ticket.kb_match = best?.id ?? "no-match";
        return { matches, best_match: best };
      }),
    }),
    auto_resolve: tool({
      description: "Auto-resolve with a KB-based reply. Only for non-enterprise + clear KB match.",
      inputSchema: z.object({ reply: z.string() }),
      execute: recorded("auto_resolve", async ({ reply }) => {
        world.ticket.reply = reply;
        world.ticket.status = "auto-resolved";
        return { ok: true };
      }),
    }),
    escalate_t2: tool({
      description: "Escalate to Tier-2 engineering support. For non-VIP technical issues.",
      inputSchema: z.object({ reason: z.string() }),
      execute: recorded("escalate_t2", async ({ reason }) => {
        world.ticket.reply = `Escalated to T2: ${reason}`;
        world.ticket.status = "escalated-t2";
        return { ok: true };
      }),
    }),
    escalate_vip: tool({
      description: "Escalate to VIP support team. For enterprise customers with critical or any urgent issues.",
      inputSchema: z.object({ reason: z.string(), urgency: z.enum(["high", "critical"]) }),
      execute: recorded("escalate_vip", async ({ reason, urgency }) => {
        world.ticket.reply = `[${urgency.toUpperCase()}] Escalated to VIP: ${reason}`;
        world.ticket.status = "escalated-vip";
        return { ok: true };
      }),
    }),
  };
}

// ---------------------------------------------------------------------------
// Run one ticket end-to-end, dump JSONL
// ---------------------------------------------------------------------------

async function runOne(seed: { id: string; subject: string; body: string; customer: string }, model: string, outDir: string) {
  const world = {
    ticket: { ...seed, status: "new" } as Ticket,
    kb: SHARED_KB,
  };

  const watcher = observe<Ticket>({
    snapshot: async () => structuredClone(world.ticket),
    goal: (t) => [
      { name: "ticket_enriched_with_account_context",
        check: (t) => ({ satisfied: !!t.enriched, gap: 1, weight: 1 }) },
      { name: "kb_searched",
        check: (t) => ({ satisfied: t.kb_match !== undefined, gap: 1, weight: 1 }) },
      { name: "ticket_routed",
        check: (t) => ({ satisfied: t.status !== "new" && t.status !== "investigating", gap: 1, weight: 2 }) },
      { name: "enterprise_ticket_must_escalate",
        check: (t) => ({
          satisfied: !(t.enriched?.tier === "enterprise" && t.status === "auto-resolved"),
          gap: (t.enriched?.tier === "enterprise" && t.status === "auto-resolved") ? 1 : 0,
          weight: 5,
        }) },
    ],
  });

  await watcher.takeSnapshot();

  const recordStep = async (toolName: string, args: any) => {
    await watcher.recordStep({ tool: { name: toolName, args } });
  };

  const tools = buildTools(world, recordStep);
  const client = anthropic(model);

  const startedAt = Date.now();

  const result = await generateText({
    model: client,
    stopWhen: stepCountIs(8),
    tools,
    providerOptions: { anthropic: { disableParallelToolUse: true } },
    prepareStep: async () => {
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
          "     escalate_vip (enterprise customers OR critical issues).",
          "  4. Enterprise customers MUST be escalated (T2 or VIP), never auto-resolved.",
          "",
          `Progress: ${status.satisfied.length}/${status.assertions.length} satisfied.`,
          `Still unmet: ${status.unmet.map(a => a.name).join(", ") || "(none — done)"}.`,
        ].join("\n"),
      };
    },
    prompt: `Triage ticket ${world.ticket.id}. Read it, enrich it, search the KB, then route.`,
  });

  const final = await watcher.status();
  const duration_ms = Date.now() - startedAt;

  // Dump JSONL
  const traj = watcher.trajectory();
  const start_ns = (Date.now() - duration_ms) * 1e6;
  const span = {
    trace_id:       Array.from({ length: 32 }, () => "0123456789abcdef"[Math.floor(Math.random() * 16)]).join(""),
    span_id:        Array.from({ length: 16 }, () => "0123456789abcdef"[Math.floor(Math.random() * 16)]).join(""),
    parent_span_id: null,
    name:           `support-triage.${seed.id}.${model}`,
    start_time_ns:  start_ns,
    end_time_ns:    Date.now() * 1e6,
    kind: 0,
    status: { code: final.done ? 0 : 2 },
    attributes: {
      "bench.task_id":     `support-triage-${seed.id}`,
      "bench.solver":      "observer",
      "bench.model":       model,
      "bench.success":     final.done,
      "bench.steps":       traj.length,
      "bench.d_initial":   traj[0]?.d_before ?? 0,
      "bench.d_final":     final.gap,
      "bench.duration_ms": duration_ms,
      "bench.input_tokens":  result.usage?.inputTokens ?? 0,
      "bench.output_tokens": result.usage?.outputTokens ?? 0,
    },
    events: traj.flatMap((t) => {
      const ts_ns = start_ns + t.ts_ms * 1e6;
      const out: any[] = [];
      if (t.tool) {
        out.push({
          name: "scene.set", time_ns: ts_ns,
          attributes: {
            "scene.key": "tool", "scene.kind": "intent",
            "scene.value": JSON.stringify({ tool: t.tool, reasoning: t.reasoning }),
            "scene.value.type": "json", "scene.value.size": 0, "scene.commit_hash": "",
            "scene.description": t.tool.name,
          },
        });
      }
      out.push({
        name: "scene.set", time_ns: ts_ns + 1,
        attributes: {
          "scene.key": "distance", "scene.kind": "actual",
          "scene.value": JSON.stringify({ d_before: t.d_before, d_after: t.d_after, delta: t.delta }),
          "scene.value.type": "json", "scene.value.size": 0, "scene.commit_hash": "",
          "scene.description": `step ${t.step}`,
        },
      });
      if (t.scene_after !== undefined) {
        const sceneStr = JSON.stringify(t.scene_after);
        out.push({
          name: "scene.set", time_ns: ts_ns + 2,
          attributes: {
            "scene.key": "scene", "scene.kind": "actual",
            "scene.value": sceneStr,
            "scene.value.type": "json", "scene.value.size": sceneStr.length, "scene.commit_hash": "",
            "scene.description": `world state after step ${t.step}`,
          },
        });
      }
      return out;
    }),
  };

  const fname = `${seed.id}-${model.replace(/\./g, "_")}.jsonl`;
  const fpath = join(outDir, fname);
  writeFileSync(fpath, JSON.stringify(span) + "\n");

  console.log(`  ✓ ${seed.id}  ${world.ticket.status.padEnd(15)}  d:${traj[0]?.d_before ?? 0}→${final.gap}  ${traj.length}st  ${duration_ms}ms`);
  return {
    file:       fname,
    id:         seed.id,
    subject:    seed.subject,
    customer:   seed.customer,
    final_status: world.ticket.status,
    success:    final.done,
    steps:      traj.length,
    duration_ms,
    model,
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const argv = process.argv.slice(2);
  const modelArg = argv.find((_, i) => argv[i - 1] === "--model");
  const model = modelArg ?? "claude-haiku-4-5";

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("ANTHROPIC_API_KEY not set");
    process.exit(1);
  }

  const outDir = join(process.cwd(), "viewer", "example-traces", "suite");
  mkdirSync(outDir, { recursive: true });

  console.log(`Generating ${TICKETS.length} trajectories with ${model} → ${outDir}`);

  const manifest: any[] = [];
  for (const ticket of TICKETS) {
    try {
      manifest.push(await runOne(ticket, model, outDir));
    } catch (e) {
      console.error(`  ✗ ${ticket.id} failed:`, e);
    }
  }

  const manifestPath = join(outDir, "manifest.json");
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");

  // Summary
  console.log(`\n=== Summary ===`);
  const byStatus: Record<string, number> = {};
  for (const m of manifest) byStatus[m.final_status] = (byStatus[m.final_status] ?? 0) + 1;
  for (const [s, c] of Object.entries(byStatus)) console.log(`  ${s.padEnd(20)} ${c}`);
  console.log(`\n→ manifest at ${manifestPath}`);
}

await main();
