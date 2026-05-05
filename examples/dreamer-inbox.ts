/**
 * Dreamer-inbox — same inbox onboarding task, three runs side-by-side.
 *
 *   1. LLMSolver          → acts directly in the env, current behavior
 *   2. DreamerSolver(LLM) → predicts each candidate's outcome, picks best, then acts
 *   3. evalWorldModel     → measures how accurate the LLM-as-predictor actually is
 *
 * The point of v0: ship the surface end-to-end with the LLM as a placeholder
 * predictor. Future versions swap the predictor (kNN over a trace store,
 * fine-tuned, learned) without changing the example or the eval.
 *
 * Run: ANTHROPIC_API_KEY=... bun examples/dreamer-inbox.ts
 */

import {
  defineEnv,
  LLMSolver,
  DreamerSolver,
  LLMPredictor,
  evalWorldModel,
  formatMetrics,
} from "scenegrad";

type Status = "unread" | "archived" | "flagged" | "replied";
type Mail   = { id: number; from: string; subject: string; status: Status };

const isImportantSender = (from: string) =>
  /boss@|ceo@|vip@/.test(from) || /calendar@|meeting@/.test(from);

const inbox = defineEnv({
  init: () => ({
    messages: [
      { id: 1, from: "boss@co",     subject: "Q3 plan?",     status: "unread" as Status },
      { id: 2, from: "spam@x.com",  subject: "YOU WON!!!",   status: "unread" as Status },
      { id: 3, from: "calendar@co", subject: "Mtg 2pm tmrw", status: "unread" as Status },
    ] as Mail[],
  }),

  goal: () => [
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
        const wrongly = s.messages.filter((m: Mail) =>
          m.status === "archived" && isImportantSender(m.from));
        return { satisfied: wrongly.length === 0, gap: wrongly.length, weight: 5 };
      },
    },
  ],

  tools: (s) => s.messages
    .filter((m: Mail) => m.status === "unread")
    .flatMap((m: Mail) => [
      { name: "archive", args: { id: m.id } },
      { name: "flag",    args: { id: m.id } },
      { name: "reply",   args: { id: m.id } },
    ]),

  step: (s, t) => ({
    messages: s.messages.map((m: Mail) =>
      m.id === (t.args as any).id ? { ...m, status: t.name as Status } : m
    ),
  }),

  describeTask: (s) => {
    const unread = s.messages.filter((m: Mail) => m.status === "unread");
    return [
      "INBOX:",
      ...s.messages.map((m: Mail) =>
        `  [${m.status.padEnd(8)}] #${m.id} from ${m.from}: "${m.subject}"`),
      "",
      `${unread.length} unread. archive (delete), flag (handle later), or reply.`,
      "Important senders (boss@, calendar@) must NOT be archived.",
    ].join("\n");
  },
});

function dump(label: string, r: { success: boolean; steps: number; d_initial: number; d_final: number; duration_ms: number; trajectory: any[] }) {
  console.log(`\n=== ${label} ===`);
  console.log(`success=${r.success}  steps=${r.steps}  d:${r.d_initial}→${r.d_final}  ${r.duration_ms}ms`);
  for (const t of r.trajectory) {
    const tool = t.tool ? `${t.tool.name}(${JSON.stringify(t.tool.args)})` : "(none)";
    const pred = t.predicted_delta !== undefined ? `  pred-Δ=${t.predicted_delta}` : "";
    console.log(`  #${t.step} ${tool}  d:${t.d_before}→${t.d_after}  Δ=${t.delta}${pred}`);
    if (t.reasoning) console.log(`     "${t.reasoning}"`);
  }
}

if (!process.env.ANTHROPIC_API_KEY) {
  console.error("ANTHROPIC_API_KEY not set");
  process.exit(1);
}

// 1. baseline: LLMSolver acts directly
const llm = new LLMSolver({
  model: "claude-haiku-4-5",
  describeTask: () => (inbox as any).describeTask?.() ?? "",
});
dump("LLMSolver — acts directly", await llm.solve(inbox, "default", { maxSteps: 10 }));

// 2. tier 4: DreamerSolver predicts each candidate, picks best, then commits
const predictor = new LLMPredictor({ model: "claude-haiku-4-5" });
const dreamer   = new DreamerSolver({ predictor, lookahead: 1 });
dump("DreamerSolver(LLM) — plans in predictor, acts once", await dreamer.solve(inbox, "default", { maxSteps: 10 }));

// 3. measure how good the predictor actually is. Use the LLMSolver run as
// the action sequence, then replay through env+predictor side-by-side.
const baseRun  = await llm.solve(inbox, "default", { maxSteps: 10 });
const actions  = baseRun.trajectory.map(s => s.tool).filter((t): t is any => t !== null);
const metrics  = await evalWorldModel({
  env:       inbox,
  predictor,
  tasks:     [{ taskId: "default", actions }],
});

console.log("\n=== world-model accuracy on this task ===");
console.log(formatMetrics(metrics, { perStep: true }));
