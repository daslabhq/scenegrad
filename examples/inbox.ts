/**
 * Inbox — minimal real-agent scenegrad example.
 *
 * 3 messages, 3 tools (archive / flag / reply), LLM picks per message.
 * Demonstrates: TDD-shaped iteration on assertions, drift detection,
 * gap closure across multi-step decisions.
 *
 * Run: ANTHROPIC_API_KEY=... bun examples/inbox.ts
 */

import { defineEnv, LLMSolver } from "scenegrad";

type Status = "unread" | "archived" | "flagged" | "replied";
type Mail = { id: number; from: string; subject: string; status: Status };

// ---------------------------------------------------------------------------
// Iteration 1 — minimum spec
// "Goal: no unread messages." That's it.
// ---------------------------------------------------------------------------

const inbox_v1 = defineEnv({
  init: () => ({
    messages: [
      { id: 1, from: "boss@co",      subject: "Q3 plan?",      status: "unread" as Status },
      { id: 2, from: "spam@x.com",   subject: "YOU WON!!!",    status: "unread" as Status },
      { id: 3, from: "calendar@co",  subject: "Mtg 2pm tmrw",  status: "unread" as Status },
    ] as Mail[],
  }),

  goal: () => [{
    name: "no unread messages",
    check: (s) => {
      const unread = s.messages.filter((m: Mail) => m.status === "unread").length;
      return { satisfied: unread === 0, gap: unread };
    },
  }],

  tools: (s) => s.messages
    .filter((m: Mail) => m.status === "unread")
    .flatMap((m: Mail) => [
      { name: "archive", args: { id: m.id } },
      { name: "flag",    args: { id: m.id } },
      { name: "reply",   args: { id: m.id } },
    ]),

  step: (s, t) => ({
    messages: s.messages.map((m: Mail) =>
      m.id === (t.args as any).id
        ? { ...m, status: t.name as Status }
        : m
    ),
  }),

  describeTask: (s, _goal) => {
    const unread = s.messages.filter((m: Mail) => m.status === "unread");
    return [
      "INBOX:",
      ...s.messages.map((m: Mail) =>
        `  [${m.status.padEnd(8)}] #${m.id} from ${m.from}: "${m.subject}"`),
      "",
      `${unread.length} unread. Choose archive (delete), flag (needs my attention later), or reply.`,
      "Pick wisely — the goal is to clear unread mail correctly, not just clear it.",
    ].join("\n");
  },
});

// ---------------------------------------------------------------------------
// Iteration 2 — caught the over-archiver
// Add: important mail must be flagged or replied to, not archived.
// ---------------------------------------------------------------------------

const isImportantSender = (from: string) =>
  /boss@|ceo@|vip@/.test(from) || /calendar@|meeting@/.test(from);

const inbox_v2 = defineEnv({
  init: () => inbox_v1.reset(),
  goal: (s) => [
    {
      name: "no unread messages",
      check: (s) => {
        const unread = s.messages.filter((m: Mail) => m.status === "unread").length;
        return { satisfied: unread === 0, gap: unread };
      },
    },
    {
      name: "important mail not archived (flag or reply only)",
      check: (s) => {
        const wrongly_archived = s.messages.filter((m: Mail) =>
          m.status === "archived" && isImportantSender(m.from));
        return {
          satisfied: wrongly_archived.length === 0,
          gap: wrongly_archived.length,
          weight: 5,  // ← heavy penalty: archiving boss is 5x worse than leaving unread
        };
      },
    },
  ],
  tools: (s) => inbox_v1.tools(),
  step: (s, t) => inbox_v1.step(t).scene_after,
  describeTask: (s) => (inbox_v1 as any).describeTask?.() ?? "",
});

// ---------------------------------------------------------------------------
// Run iteration 1 vs iteration 2 side-by-side
// ---------------------------------------------------------------------------

async function run(label: string, env: ReturnType<typeof defineEnv>) {
  const solver = new LLMSolver({
    model: "claude-haiku-4-5",
    describeTask: () => (env as any).describeTask?.() ?? "",
  });
  console.log(`\n=== ${label} ===`);
  const r = await solver.solve(env, "default", { maxSteps: 10 });
  console.log(`success=${r.success}  steps=${r.steps}  d:${r.d_initial}→${r.d_final}  ${r.duration_ms}ms`);
  for (const t of r.trajectory) {
    const tool = t.tool ? `${t.tool.name}(${JSON.stringify(t.tool.args)})` : "(none)";
    console.log(`  #${t.step} ${tool}  d:${t.d_before}→${t.d_after}  Δ=${t.delta} pred=${t.predicted_delta}`);
    if (t.reasoning) console.log(`     "${t.reasoning}"`);
  }
}

if (!process.env.ANTHROPIC_API_KEY) {
  console.error("ANTHROPIC_API_KEY not set");
  process.exit(1);
}

await run("iteration 1: spec = 'no unread mail'",                     inbox_v1);
await run("iteration 2: + 'important mail not archived' (weight 5)",  inbox_v2);
