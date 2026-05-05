# scenegrad

> **Trace your agent's world, not just its tool calls.**
> Drop in 2 lines. Scrub a timeline of typed scenes — what your agent saw, what changed, where it drifted.

[![v0.0.1](https://img.shields.io/badge/version-v0.0.1--alpha-orange)](https://github.com/daslabhq/scenegrad)
[![license](https://img.shields.io/badge/license-MIT-blue)](./LICENSE)

[![scenegrad viewer](./docs/demo.gif)](https://daslabhq.github.io/scenegrad/bulk.html)

**[→ Try the live demo](https://daslabhq.github.io/scenegrad/bulk.html)** · **[Single-trace viewer](https://daslabhq.github.io/scenegrad/)**

---

## The bug logs hide

Your agent ran a 6-step onboarding flow. The trace says it succeeded. The user complains next morning that no welcome email arrived.

With logs, you dig for an hour. With scenegrad, you scrub the trajectory and see step 4 — agent claimed `welcome_sent: true` in its working memory; the world snapshot says `welcome_at: null`. Drift caught in 30 seconds.

```ts
import { trace } from "scenegrad";

const t = trace.start({
  snapshot: async () => ({
    user:         await db.users.findOne({ session_id }),
    welcome_sent: await emails.exists({ template: "welcome" }),
  }),
});

// your existing Vercel AI SDK / Anthropic SDK / LangChain loop, untouched:
const result = await generateText({
  model: anthropic("claude-haiku-4-5"),
  tools: { /* your tools, unchanged */ },
  onStepFinish: t.captureStep,         // ← only addition
  prompt: "...",
});

t.dump("./traces/run.jsonl");
```

```bash
npx scenegrad view ./traces           # bulk view of every JSONL in ./traces
npx scenegrad view ./traces/run.jsonl # single-trace view
```

> **v0.0.1 note:** the CLI requires [Bun](https://bun.sh) on your PATH. Node-compatible bin compilation lands in v0.0.2.

---

## Five words you'll meet, all you need

scenegrad has a small vocabulary. Each word is just the obvious name for what you're already looking at.

### Scene — the world your agent acts on

Same database. Three jobs. Three scenes:

```
support-triage scene  →  ticket card + customer LTV + recent thread
inbox triage scene    →  message list + sender importance + status
data-migration scene  →  source schema + target schema + row diff
```

A **scene** is the right rendering of the world for a specific job. Your `snapshot()` function returns it. Typed shapes for common scenes (Email, Message, Contact, Event, Task, Document) live in [`scenecast`](https://github.com/daslabhq/scenecast); your domain-specific ones extend them.

### Diff — what changed, semantically

Step 3 archived message #2. The scene before vs after differs in one field: `status: unread → archived`. That reads as one semantic change, not a byte-level mess. scenegrad diffs over the scene's typed shape, not over JSON bytes.

### Goal + assertions — what "done" means

Done is a list of assertions on the scene. *No unread messages. Important mail not archived. Welcome email sent.* An assertion has a `satisfied` flag and a `gap` measure, so "almost done" is a real number, not vibes.

### Gradient — the work that closes the diff

Goal scene minus current scene = a gap. The action sequence that closes the gap is the gradient. **Gradient = the work the agent has to do.** No backprop, no math — just "the actions from now to done." When the gradient stops shrinking, your agent is stuck and you can see it.

### Predictor — imagine before commit

For irreversible actions (real APIs, prod databases, outbound email), you want to know what'll happen *before* committing. A predictor takes `(scene, action)` and returns the imagined next scene + confidence. v0 ships an LLM predictor; the abstraction is built so kNN, distilled, and learned predictors swap in later.

That's the whole vocabulary. Five words.

---

## The five-tier ladder

Adopt at the tier that matches your pain. Same trajectory format flows through all five — you can level up later without restructuring.

| Tier | The pain it solves | What you write |
|---|---|---|
| **0 — trace** | "I can't tell from logs whether my agent worked" | `trace.start()` + 1 hook |
| **1 — + snapshot** | "I want to see what changed in the *world*, not just what was *called*" | `snapshot: () => fetchWorld()` |
| **2 — + goal** | "I want my agent grounded in actual world state, not its working memory" | `goal: (s) => [...assertions]` |
| **3 — + solver** | "I want a typed env to benchmark agents in" | `defineEnv` + `LLMSolver` / `GreedySolver` |
| **4 — + predictor** | "My agent's about to call an irreversible API. I want it to think first." | `Predictor` + `DreamerSolver` |

---

## Tier 0 — drop in, get a scrubbable replay

Two lines. Works alongside Vercel AI SDK, Anthropic SDK, LangChain, or your own loop.

```ts
import { trace } from "scenegrad";
const t = trace.start();

const result = await generateText({
  model: anthropic("claude-haiku-4-5"),
  tools: { /* unchanged */ },
  onStepFinish: t.captureStep,
  prompt: "...",
});

t.dump("./traces/run.jsonl");
```

That's it. No goal to design. No assertions to write. No restructuring of your agent. You get a scrubbable timeline that replaces logs.

---

## Tier 1 — add a snapshot, see what changed

When tools mutate external state, seeing the *delta* is more useful than seeing the *call*.

```ts
const t = trace.start({
  snapshot: async () => ({
    user:         await db.users.findOne({ session_id }),
    welcome_sent: await emails.exists({ template: "welcome" }),
  }),
});
```

Now each step captures `scene_before` and `scene_after`. The viewer renders the world delta per step — and surfaces the moment the agent's belief diverges from the world.

---

## Tier 2 — add a goal, get drift detection + status() at runtime

Define what "done" looks like as assertions. The same spec serves both runtime guidance and post-hoc evaluation.

```ts
const watcher = observe({
  snapshot: async () => fetchWorld(),
  goal: (s) => [
    { name: "name_collected",     check: (s) => ({ satisfied: !!s.user?.name,    gap: 1 }) },
    { name: "email_collected",    check: (s) => ({ satisfied: !!s.user?.email,   gap: 1 }) },
    { name: "role_specified",     check: (s) => ({ satisfied: !!s.user?.role,    gap: 1 }) },
    { name: "welcome_email_sent", check: (s) => ({ satisfied: s.welcome_sent,     gap: 1 }) },
  ],
});

const status = await watcher.status();

const result = await generateText({
  model: anthropic("..."),
  system: `Onboarding. Still unmet: ${status.unmet.map(a => a.name).join(", ")}.`,
  tools: { /* unchanged */ },
  onStepFinish: async ({ toolCalls }) => {
    for (const c of toolCalls ?? [])
      await watcher.recordStep({ tool: { name: c.toolName, args: c.input } });
  },
});
```

The agent's checklist is now grounded in *actual world state*, not its working memory. Post-hoc, you read the same assertions back through `watcher.trajectory()`. Spec written once; serves both runtime guidance and evaluation.

This is also TDD-shaped agent development: write the assertion → run → watch the gap → tighten. See `examples/inbox.ts` for the canonical three-iteration progression.

---

## Tier 3 — drive the loop yourself, for benches

When you want scenegrad to drive the agent (for benchmarks, comparing models, controlled tests):

```ts
import { defineEnv, LLMSolver, GreedySolver } from "scenegrad";

const task = defineEnv({
  init:  () => ({ count: 0 }),
  goal:  (s) => [{ name: "count = 5",
                   check: s => ({ satisfied: s.count === 5, gap: 5 - s.count }) }],
  tools: () => [{ name: "inc" }, { name: "dec" }],
  step:  (s, t) => t.name === "inc" ? { count: s.count + 1 } : { count: s.count - 1 },
});

await new GreedySolver().solve(task, "default");                          // optimal baseline
await new LLMSolver({ model: "claude-haiku-4-5" }).solve(task, "default"); // LLM-driven
```

Both produce the same `SolveResult` shape. Compare them on the same env to see how much the LLM drifts from the optimal greedy baseline.

---

## Tier 4 — predict before commit (for irreversible actions)

Your agent's about to call an irreversible API — write to prod, send an email, charge a card. You want it to *think* before picking. Tier 4 wraps every candidate action in a predictor first; the agent commits only the action whose imagined outcome closes the most distance.

```ts
import { defineEnv, LLMPredictor, DreamerSolver, evalWorldModel } from "scenegrad";

const env       = defineEnv({ /* same as tier 3 */ });
const predictor = new LLMPredictor({ model: "claude-haiku-4-5" });

// Plans in the predictor, commits one action at a time.
await new DreamerSolver({ predictor, lookahead: 1 }).solve(env, "default");

// Measure how good the predictor actually is — predicted vs actual scene_after.
const metrics = await evalWorldModel({
  env, predictor,
  tasks: [{ taskId: "default", actions: [/* known action sequence */] }],
});
// → outcome_acc, scene_match, delta_match, avg_confidence, ece (calibration)
```

`Predictor` is a one-method interface. v0 ships `LLMPredictor` as a placeholder; future predictors (kNN over a trace store, distilled-from-traces, fully learned) drop in via the same API — `new DreamerSolver({ predictor })` doesn't change.

The `evalWorldModel` metric scores predictors against real env traces — outcome accuracy, scene-match rate, delta-match rate, calibration. Ship a predictor → score it on any tier-3 env → publish the leaderboard column.

---

## Tier 4 — predictor + dreamer, plan in imagination

When env-side `simulate()` isn't available (real APIs, prod databases, irreversible actions), you can't enumerate-and-pick. Tier 4 swaps the simulator for a **Predictor** — a learned-or-LLM model of `predict(scene, action) → consequence`. `DreamerSolver` calls the predictor on each candidate, picks the one whose imagined outcome closes the most distance, and commits a single action to the real env.

```ts
import { defineEnv, LLMPredictor, DreamerSolver, evalWorldModel } from "scenegrad";

const env       = defineEnv({ /* same as tier 3 */ });
const predictor = new LLMPredictor({ model: "claude-haiku-4-5" });

// Plans in the predictor, commits one action at a time.
await new DreamerSolver({ predictor, lookahead: 1 }).solve(env, "default");

// Measure how good the predictor actually is — predicted vs actual scene_after.
const metrics = await evalWorldModel({
  env, predictor,
  tasks: [{ taskId: "default", actions: [/* known action sequence */] }],
});
// → outcome_acc, scene_match, delta_match, avg_confidence, ece (calibration)
```

`Predictor` is a one-method interface. v0 ships `LLMPredictor` as a placeholder; future predictors (kNN over a trace store, distilled-from-traces, fully learned) drop in via the same API — `new DreamerSolver({ predictor })` doesn't change.

The `evalWorldModel` metric is the world-model-accuracy benchmark a predictor is judged against. Ship a predictor → score it on any tier-3 env → publish the leaderboard column.

---

## Why this isn't another agent framework

| If you already use… | scenegrad adds… |
|---|---|
| LangChain / LangGraph | Drift measurement and per-task evaluation. LangChain orchestrates; scenegrad measures. |
| OpenTelemetry / Phoenix | A vocabulary for *what* to observe (scene + goal + diff), not just *how* to ship spans. |
| Custom eval scripts | A common shape so your evals are comparable across runs, models, teams. |

scenegrad doesn't replace your agent. It instruments your task so behavior becomes visible, comparable, refinable.

**Not the right fit if** your agent is single-call chat / RAG with no state mutation (Phoenix or Helicone serve that better), or you only need output scoring (Braintrust does that better — consider scenegrad alongside, not instead).

---

## Scenes are the unit of agent work

Your agent doesn't act on raw state; it acts on a **scene** — a typed, job-shaped view of the world that makes the next action obvious. Its loop is closing the diff between scene-now and the goal scene, with assertions defining "done," tools moving the world, and predictors imagining consequences before commit.

Scene design is the craft: a well-designed scene makes hard jobs solvable; a wrong one makes them impossible. The whole stack exists to make that craft tractable.

Read the protocol → [`PROTOCOL.md`](./PROTOCOL.md). Open questions → [`docs/open-questions.md`](./docs/open-questions.md).

---

## The stack

scenegrad sits in a four-repo stack. Each has a single job:

- **[`scenecast`](https://github.com/daslabhq/scenecast)** — typed scene shapes + multi-format renderers. *The vocabulary of scenes.*
- **[`scene-otel`](https://github.com/daslabhq/scene-otel)** — wire format. Every snapshot becomes an OTel span event readable in Phoenix, Honeycomb, Braintrust, etc.
- **`scenegrad`** *(this repo)* — gradients, solvers, predictors. *The verbs.*
- **[`scenebench`](https://github.com/daslabhq/scenebench)** — benchmarks built on the stack (AutomationBench, τ-bench, LeRobot adapters; S4Bench, more native benches coming).

Related: [`autocompile`](https://github.com/mirkokiefer/autocompile) — observes accumulated trajectories and hardens patterns to code.

---

## Install + run the examples

```bash
npm install scenegrad
# optional, for LLMSolver / LLMPredictor:
npm install @anthropic-ai/sdk
# optional, for tier-0 with Vercel AI SDK:
npm install ai @ai-sdk/anthropic zod

# tier 0 — drop-in trace, no goal
ANTHROPIC_API_KEY=... bun examples/trace-only-aisdk.ts

# tier 2 — observer mode with goal + status injection
ANTHROPIC_API_KEY=... bun examples/onboarding.ts                 # Anthropic SDK
ANTHROPIC_API_KEY=... bun examples/support-triage-aisdk.ts       # Vercel AI SDK

# tier 3 — solver mode (for benches)
bun examples/counter.ts                                           # no LLM
ANTHROPIC_API_KEY=... bun examples/inbox.ts                       # LLMSolver, TDD progression

# tier 4 — predictor + dreamer
ANTHROPIC_API_KEY=... bun examples/dreamer-inbox.ts               # LLMSolver vs DreamerSolver, plus eval
```

## Status

v0.0.1 — substrate types, `defineEnv`, `observe` (tiers 0/1/2), `trace.start()`, `GreedySolver`, `LLMSolver`, JSONL trace format, viewer scaffold. Tier 4 (`Predictor`, `DreamerSolver`, `evalWorldModel`) lands in v0.0.2.

Reference benches live in [scenebench](https://github.com/daslabhq/scenebench): ARC-trajectory ships first; AutomationBench (806 real tasks); S4Bench (SAP) and LeRobot (robotics) follow.

## License

MIT.
