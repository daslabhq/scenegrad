# Protocol

The shapes scenegrad runs on. Five primitives, two derivations, one open frontier.

This document is the reference for *what* a scene is, *what* a gradient is, *what* a predictor returns. The library is one implementation of these shapes; future implementations (other languages, other runtimes, learned components) target the same shapes.

---

## The thesis in one paragraph

Your agent doesn't act on raw state; it acts on a **scene** — a typed, job-shaped view of the world that makes the next action obvious. Its loop is closing the diff between scene-now and the goal scene, with assertions defining "done," tools moving the world, and predictors imagining consequences before commit. Scene design is the craft.

---

## Primitives

### `Scene<S>`

The right rendering of the world for a specific job. Whatever your `snapshot()` function returns. Typed; the type parameter `S` is your domain shape.

```ts
type Scene = unknown;  // shape determined by your job
```

A scene is *not* the same as raw state. Same database powers many scenes; the scene a job uses is the one that makes its next action obvious. (See [scenecast](https://github.com/daslabhq/scenecast) for canonical scene shapes — Email, Message, Contact, Event, Task, Document — that domain-specific scenes extend.)

### `Assertion<S>`

A predicate over a scene with a graduated gap measure.

```ts
interface Assertion<S> {
  name: string;
  check(scene: S): { satisfied: boolean; gap: number; weight?: number };
}
```

Why graduated, not boolean: "almost done" needs to be a real number for distance to be meaningful. Binary assertions are gap=1 when unmet, gap=0 when satisfied; richer assertions (e.g. "12 cells off in this grid") return the count.

### `Goal<S>`

A list of assertions, optionally combined with a non-default reduction.

```ts
interface Goal<S> {
  assertions: Assertion<S>[];
  reduce?: (gaps: number[]) => number;  // default: weighted sum
}
```

### `Patch` — semantic diff between two scenes

```ts
interface ScenePatch {
  changed_keys: string[];
  added_keys:   string[];
  removed_keys: string[];
}
```

v0 ships a top-level key-set diff. Richer typed diffs land alongside scenecast canonical types — `EmailPatch`, `TicketPatch`, `RowPatch` — that respect domain meaning rather than byte-level structure.

### `ToolCall`

A typed action on a scene.

```ts
interface ToolCall {
  name: string;
  args: Record<string, unknown>;
}
```

Domains usually narrow this with a discriminated union per tool.

### `Predictor<S, T>`

A learned-or-LLM model of `predict(scene, action) → consequence`. The interface every world-model implementation targets.

```ts
interface Predictor<S, T extends ToolCall = ToolCall> {
  readonly name: string;
  predict(scene: S, tool: T): Promise<Consequence<S>>;
}

interface Consequence<S> {
  scene_after:  S;
  outcome:      { ok: boolean; error_class?: string; p: number };
  delta:        ScenePatch;
  blast_radius: BlastEdge[];      // downstream effects (often empty in v0)
  confidence:   number;            // calibrated [0,1]
  analogues:    Analogue[];        // historical neighbours
  reasoning?:   string;
}
```

---

## Derivations

These two functions follow from the primitives. The framework computes them; users rarely override.

### `distance(scene, goal): number`

Default: weighted sum of unmet-assertion gaps. Satisfied assertions contribute 0.

```ts
function distance<S>(scene: S, goal: Goal<S>): number {
  const gaps = goal.assertions.map(a => {
    const r = a.check(scene);
    if (r.satisfied) return 0;
    return (r.gap ?? 1) * (r.weight ?? 1);
  });
  return goal.reduce ? goal.reduce(gaps) : gaps.reduce((a, b) => a + b, 0);
}
```

### `gradient` — the action sequence that minimizes distance

There is no closed-form `gradient()` function. The gradient is *the work an agent does*. Solvers approximate it:

```
GreedySolver  : pick the action that maximizes Δdistance via env.simulate
LLMSolver     : ask the LLM to pick
DreamerSolver : ask a Predictor what each action would do, pick best, commit
```

Different solvers = different policies for following the gradient. They produce comparable `SolveResult` shapes so you can benchmark them on the same env.

---

## The trajectory

The wire format scenegrad emits — and the substrate every benchmark, viewer, and eval reads.

```ts
interface TrajectoryStep<T extends ToolCall = ToolCall> {
  step:              number;
  tool:              T | null;
  scene_before?:     unknown;
  scene_after?:      unknown;
  d_before:          number;
  d_after:           number;
  delta:             number;     // d_before - d_after; positive = closer to goal
  predicted_delta?:  number;     // solvers that predict gradient closure
  reasoning?:        string;
  ok:                boolean;
  error?:            string;
  assertions_after:  AssertionState[];
  ts_ms:             number;
}
```

Trajectories serialize as one JSON object per file (or JSONL across runs), with the inner shape compatible with [scene-otel](https://github.com/daslabhq/scene-otel) span events. The viewer reads JSONL; benches read JSONL; predictors train on JSONL.

---

## The evaluation surface

A predictor's quality is measurable: replay a known action sequence, compare predicted scene_after to actual scene_after, score.

```ts
interface WorldModelMetrics {
  outcome_acc:    number;   // P(predicted_ok == actual_ok)
  scene_match:    number;   // P(predicted scene deep-equals actual)
  delta_match:    number;   // P(predicted change-keys equal actual)
  avg_confidence: number;
  ece:            number;   // expected calibration error, 10-bin
}
```

This is the world-model-accuracy benchmark a predictor is judged against. Same shape can run inside scenebench as a leaderboard column across AutomationBench / τ-bench / LeRobot.

---

## What this protocol claims, in one line per primitive

- **Scene:** the right view of the world for the job — not raw state.
- **Assertion:** a graduated check over a scene; the unit "done" is built from.
- **Goal:** a set of assertions; aggregates to a scalar distance.
- **Patch:** semantic diff over the scene's typed shape, not bytes.
- **ToolCall:** a typed action whose effect is observable in the scene.
- **Predictor:** any function `(scene, action) → consequence` — LLM, kNN, distilled, learned.
- **Trajectory:** the wire-format record of an agent (or solver) closing a gradient.

Five primitives. Two derivations. One protocol surface that benchmarks, viewers, predictors, and evaluators all share.

---

## Open frontier

The interesting unsolved problems live at [`docs/open-questions.md`](./docs/open-questions.md). They're invitations, not gaps in the implementation.
