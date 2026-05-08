/**
 * Predictor — the world-model interface.
 *
 *   const p = new LLMPredictor({ model: "claude-haiku-4-5" });
 *   const c = await p.predict(scene, tool);
 *   // c.scene_after, c.outcome.ok, c.confidence, c.delta, ...
 *
 * A Predictor takes (scene, action) and returns a structured prediction of
 * what happens — predicted next scene, outcome distribution, change set,
 * confidence. The same shape an offline ML model, a kNN retriever over a
 * trace store, or a hand-coded simulator could implement.
 *
 * v0 ships LLMPredictor (LLM-as-predictor). v0.1+ adds retrieval-augmented
 * and distilled variants. All implement this single interface, so swapping
 * is one line in user code.
 */

import type { SceneGradEnv, ToolCall } from "./env.js";

/**
 * A patch describing what changed between two scenes. v0 carries a coarse
 * key-set diff; richer typed diffs land alongside scenecast canonical types.
 */
export interface ScenePatch {
  /** Top-level keys whose values changed (added / removed / changed). */
  changed_keys: string[];
  /** Top-level keys present in scene_after but not scene_before. */
  added_keys:   string[];
  /** Top-level keys present in scene_before but not scene_after. */
  removed_keys: string[];
}

/**
 * A downstream effect the predictor expects to follow from this action,
 * outside the immediate scene_after delta. Empty in v0; populated by
 * later predictors that learn a topology over integrations.
 */
export interface BlastEdge {
  /** What is affected — system / table / job / human. */
  target: string;
  /** Why — short human-readable rationale. */
  reason: string;
  /** Self-reported probability the effect occurs. */
  p:      number;
}

/** A reference to a similar past trajectory the predictor used as evidence. */
export interface Analogue {
  /** Source identifier — JSONL path, span id, etc. */
  ref:        string;
  /** Self-reported similarity ∈ [0,1]. */
  similarity: number;
  /** Optional one-line summary the predictor surfaces. */
  note?:      string;
}

/**
 * The structured prediction returned by Predictor.predict.
 *
 * `scene_after` is the predicted next scene — the same shape as
 * `env.scene()`. `outcome` is the predicted outcome distribution.
 * `delta` and `blast_radius` describe the change. `confidence`
 * carries the predictor's self-reported certainty.
 */
export interface Consequence<S> {
  scene_after:   S;
  outcome:       { ok: boolean; error_class?: string; p: number };
  delta:         ScenePatch;
  blast_radius:  BlastEdge[];
  confidence:    number;
  analogues:     Analogue[];
  /** Optional free-form rationale — useful in viewers and debugging. */
  reasoning?:    string;
}

/**
 * The world-model interface. Implementations: LLMPredictor (v0),
 * KNNPredictor (v0.1), DistilledPredictor (v0.3), …
 */
export interface Predictor<S, T extends ToolCall = ToolCall> {
  /** Identifier for telemetry + leaderboard reporting. */
  readonly name: string;
  /** Predict the consequence of `tool` applied to `scene`. */
  predict(scene: S, tool: T): Promise<Consequence<S>>;
}

// ---------------------------------------------------------------------------
// Helpers — usable by any Predictor implementation.
// ---------------------------------------------------------------------------

/**
 * Compute a top-level ScenePatch between two scenes by structural compare.
 * Cheap and generic; richer diffs land with canonical types in scenecast.
 */
export function diffScene<S>(before: S, after: S): ScenePatch {
  const b = (before ?? {}) as Record<string, unknown>;
  const a = (after  ?? {}) as Record<string, unknown>;
  const beforeKeys = new Set(Object.keys(b));
  const afterKeys  = new Set(Object.keys(a));

  const added_keys:   string[] = [];
  const removed_keys: string[] = [];
  const changed_keys: string[] = [];

  for (const k of afterKeys)  if (!beforeKeys.has(k)) added_keys.push(k);
  for (const k of beforeKeys) if (!afterKeys.has(k))  removed_keys.push(k);
  for (const k of afterKeys) {
    if (!beforeKeys.has(k)) continue;
    if (JSON.stringify(b[k]) !== JSON.stringify(a[k])) changed_keys.push(k);
  }
  return { added_keys, removed_keys, changed_keys };
}

/**
 * Adapt a Predictor to a SceneGradEnv.simulate() — useful for solvers that
 * already speak `simulate(tool) → StepResult`. The dreamer solver uses this
 * internally, but it's also handy for plugging a Predictor into existing
 * solvers like GreedySolver without modification.
 */
export function predictorAsSimulate<S, T extends ToolCall>(
  predictor: Predictor<S, T>,
  goalDistance: (scene: S) => number,
) {
  return async (scene: S, tool: T) => {
    const c = await predictor.predict(scene, tool);
    return {
      scene_after:    c.scene_after,
      ok:             c.outcome.ok,
      error:          c.outcome.error_class,
      distance_after: goalDistance(c.scene_after),
      confidence:     c.confidence,
    };
  };
}

/** Trivial self-check: does an env's simulate roughly match a predictor? */
export async function quickConsistencyCheck<S, T extends ToolCall>(
  env:       SceneGradEnv<S, T>,
  predictor: Predictor<S, T>,
  tool:      T,
): Promise<{ scene_match: boolean; confidence: number }> {
  if (!env.simulate) throw new Error("env.simulate required for consistency check");
  const actual    = env.simulate(tool);
  const predicted = await predictor.predict(env.scene(), tool);
  return {
    scene_match: JSON.stringify(actual.scene_after) === JSON.stringify(predicted.scene_after),
    confidence:  predicted.confidence,
  };
}
