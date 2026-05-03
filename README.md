# scenegrad

> **TDD for agents.** Write the assertion. Run. Watch the gap. Tighten.

```ts
import { defineEnv, GreedySolver } from "scenegrad";

const counter = defineEnv({
  init:  () => ({ count: 0 }),
  goal:  (s) => [{ name: "count = 5",
                   check: s => ({ satisfied: s.count === 5, gap: 5 - s.count }) }],
  tools: () => [{ name: "inc", args: {} }, { name: "dec", args: {} }],
  step:  (s, t) => t.name === "inc" ? { count: s.count + 1 } : { count: s.count - 1 },
});

const result = await new GreedySolver().solve(counter, "default");
// → success: true, steps: 5, gap closes 5→4→3→2→1→0
```

Four functions. The framework derives the metric, the loop, the trace, and the comparable result shape across runs and models.

---

## The thinking framework

We sense the scene / world now. We make assertions on it — sensor values, query responses, photos, descriptions. **It's always an *image of* the scene, not the scene itself.**

We have a future scene vaguely in mind. So we assert that as best we can. The diff between now and then is the gradient. Tools are actions that close it. We make progress, re-evaluate, sometimes redefine the goal as we learn. Reality is complex; the loop is simple.

scenegrad gives this loop a substrate:

| Layer | What you bring | What scenegrad gives you |
|---|---|---|
| 1. Mental model | The framing | Vocabulary: scene, goal, gradient, drift |
| 2. Scene description | Sensed data, typed | Trajectory format, scrubbable replay |
| 3. Distance / diff | Domain assertion impl (NL, visual, code) | `Assertion<S>` returning satisfied + gap + structured diff |
| 4. Action derivation | Your toolkit | Tool simulation, gap-closure ranking, swap-in solvers |
| 5. Execution | Your agent loop OR our solvers | Step-by-step trajectory, drift measurement |
| 6. Learning | Your analytics OR autocompile | Common shape so patterns find themselves |

Two gradients flow through this: **the agent's** (closing scene-now to scene-then per step) and **yours** (closing the spec to reality, by tightening assertions when behavior surprises you). Both are gradient descent. Both happen in the same framework.

---

## TDD for agents — a real example

Take a 3-message inbox. Goal: clear unread mail. Three tools: archive, flag, reply.

### Iteration 1 — minimum spec

```ts
const inbox = defineEnv({
  init: () => ({ messages: [
    { id: 1, from: "boss@co",     subject: "Q3 plan?",      status: "unread" },
    { id: 2, from: "spam@x.com",  subject: "YOU WON!!!",    status: "unread" },
    { id: 3, from: "calendar@co", subject: "Mtg 2pm tmrw",  status: "unread" },
  ]}),

  goal: () => [{
    name: "no unread messages",
    check: (s) => {
      const unread = s.messages.filter(m => m.status === "unread").length;
      return { satisfied: unread === 0, gap: unread };
    },
  }],

  tools: (s) => s.messages
    .filter(m => m.status === "unread")
    .flatMap(m => [
      { name: "archive", args: { id: m.id } },
      { name: "flag",    args: { id: m.id } },
      { name: "reply",   args: { id: m.id } },
    ]),

  step: (s, t) => ({
    messages: s.messages.map(m =>
      m.id === t.args.id ? { ...m, status: t.name } : m
    ),
  }),
});

await new LLMSolver({ model: "claude-haiku-4-5" }).solve(inbox, "default");
// → success: true (gap 3→0). But...
```

Run it. Some models (especially smaller ones) will pick the path of least resistance: **archive everything**. Gap closes 3→0. ✓ technically. ✗ in spirit. Your boss's Q3 question got deleted.

### Iteration 2 — caught the over-archiver

You watch the trajectory, see the violation, add an assertion that catches it:

```ts
goal: () => [
  { name: "no unread messages", check: ... },
  { name: "important mail not archived (flag or reply only)",
    check: (s) => {
      const wrongly_archived = s.messages.filter(m =>
        m.status === "archived" && isImportantSender(m.from));
      return { satisfied: wrongly_archived.length === 0,
               gap: wrongly_archived.length,
               weight: 5 };  // ← archiving boss is 5x worse than leaving unread
    } },
],
```

Re-run. Now if the agent archives `boss@co`, gap goes from 3 → 2+5 = 7. Distance *increased*. The greedy baseline would never pick that move; if your LLM does, you see it immediately and the trajectory is comparable across runs.

### Iteration 3 — caught the lazy replier

Inspecting the new trace: the agent replied to `calendar@co`, but the reply body was empty. Add:

```ts
{ name: "replies have non-empty body",
  check: (s) => {
    const empty_replies = s.messages.filter(m =>
      m.status === "replied" && (!m.reply_body || m.reply_body.length < 10));
    return { satisfied: empty_replies.length === 0,
             gap: empty_replies.length, weight: 3 };
  } },
```

Re-run. Agent must now compose real responses or take a different path.

That's the loop. Three iterations, each catches a real failure mode. **Your assertion set IS the spec.** It's executable, version-controllable, regression-detectable. Future models, future prompts, future toolkit changes — same suite catches the same regressions.

This is what TDD looks like for agents. You weren't doing prompt engineering; you were tightening the spec until the agent's behavior converged.

---

## What you write vs. what scenegrad gives you

| You write | scenegrad gives you |
|---|---|
| `init()` — initial scene | Trajectory format (scene-otel-compatible JSONL) |
| `goal(s)` — assertions for "done" | `distance(scene, goal)` — uniform progress metric |
| `tools(s)` — available actions | Tool simulation via `simulate()` |
| `step(s, t)` — pure transition | Greedy + LLM solvers polymorphic over your env |
| | Per-step gap closure rate |
| | Predicted-vs-actual delta (drift detection) |
| | Per-assertion satisfaction trace |
| | Scrubbable trajectory in scene-otel viewer |
| | Comparable result shape across solvers, models, runs |

You bring the four functions. Everything else derives.

---

## Why this isn't another agent framework

If you already use… | scenegrad adds…
---|---
LangChain / LangGraph | Drift measurement and per-task evaluation. LangChain orchestrates; scenegrad measures.
OpenTelemetry / Phoenix | A vocabulary for *what* to observe (scene + goal + diff), not just *how* to ship spans.
Custom eval scripts | A common shape so your evals are comparable across runs, models, teams.
System prompts to constrain behavior | A way to say "done" the framework can VERIFY, not just hope the LLM honors.

scenegrad doesn't replace your agent. It instruments your task so behavior becomes measurable, comparable, and refinable.

---

## What scenegrad does NOT do

- **Doesn't write your distance function.** Domain-specific. Sometimes hard.
- **Doesn't induce your toolkit.** You author it; [autocompile](https://github.com/mirkokiefer/autocompile) refines.
- **Doesn't solve local-optima / dead-end paths.** It exposes them; your solver picks the search strategy.
- **Doesn't replace your agent.** Your agent runs whatever loop it runs; scenegrad measures it.
- **Doesn't unify cross-domain distance.** ARC's "12 cells off" and SAP's "3 audit controls violated" aren't directly comparable — each domain owns its units.

---

## Install + run

```bash
npm install scenegrad
# optional, for LLMSolver:
npm install @anthropic-ai/sdk

# try the examples
bun examples/counter.ts                                  # no LLM, ~0ms
ANTHROPIC_API_KEY=... bun examples/inbox.ts              # 3-msg inbox, ~5s
```

## Status

v0.0.1 — substrate types, defineEnv, GreedySolver, LLMSolver (Anthropic), JSONL trace format.

Reference benches live in [scene-bench](https://github.com/daslabhq/scene-bench): ARC-trajectory ships first; AutomationBench next (806 real tasks); S4Bench (SAP) and LeRobot (robotics) follow.

## Related

- [`scene-otel`](https://github.com/daslabhq/scene-otel) — wire format scenegrad emits trajectories in
- [`scene-state`](https://github.com/daslabhq/scene-state) — typed scene shapes + multi-size widgets that render trajectories visually
- [`scene-bench`](https://github.com/daslabhq/scene-bench) — benchmarks built on scenegrad
- [`autocompile`](https://github.com/mirkokiefer/autocompile) — observes accumulated trajectories, hardens patterns to code

## License

MIT.
