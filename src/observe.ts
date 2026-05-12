/**
 * Observer mode — scenegrad sits alongside an existing agent loop.
 *
 * Three tiers of value, each opt-in:
 *
 *   tier 0: trace        — just capture tool calls. No snapshot, no goal.
 *                          Drop in 2 lines, get a scrubbable replay.
 *   tier 1: + snapshot   — also capture world state between calls.
 *                          See what *changed*, not just what was called.
 *   tier 2: + goal       — gap-closure measurement, drift detection,
 *                          status() injection for runtime guidance.
 *
 * One API; opt into more by passing more fields. Pay only for what you use.
 */

import type { Assertion, AssertionState, Goal, ToolCall } from "./env.js";
import { distance, checkAll } from "./env.js";

export interface ObserveSpec<S = unknown> {
  /** Optional. How to fetch the current world state.
   *  Without this: only tool-call timing is captured. */
  snapshot?: () => Promise<S> | S;

  /** Optional. Goal defining "done."
   *  Accepts either a mark Predicate (preferred, going forward) or a list
   *  of legacy Assertions. Without it: no gap measurement, no status() —
   *  pure trace. */
  goal?: (s: S) => Goal<S> | Assertion<S>[];

  /** Optional. Side-channel handlers for emitted events. */
  exporters?: ((event: ObserverEvent) => void | Promise<void>)[];

  /** Optional friendly name for the trace (surfaces in the viewer). */
  name?: string;
}

export type ObserverEvent =
  | { kind: "step";     step: TrajectoryStep }
  | { kind: "snapshot"; scene: unknown; ts_ms: number }
  | { kind: "done";     final_status: ObserverStatus<unknown> };

export interface ObserverStatus<S> {
  scene:        S | undefined;
  assertions:   AssertionState[];
  satisfied:    AssertionState[];
  unmet:        AssertionState[];
  gap:          number;
  done:         boolean;
}

export interface TrajectoryStep {
  step:               number;
  tool:               ToolCall | null;
  predicted_delta?:   number;
  reasoning?:         string;
  d_before:           number;
  d_after:            number;
  delta:              number;
  assertions_before:  AssertionState[];
  assertions_after:   AssertionState[];
  scene_before?:      unknown;
  scene_after?:       unknown;
  ok:                 boolean;
  error?:             string;
  ts_ms:              number;
}

export class Watcher<S = unknown> {
  private trajectory_: TrajectoryStep[] = [];
  private lastScene?:  S;
  private startTs:     number;

  constructor(private spec: ObserveSpec<S>) {
    this.startTs = Date.now();
  }

  /** Friendly name (defaults to "trace"). */
  get name(): string { return this.spec.name ?? "trace"; }

  /** Take a fresh snapshot of the world. Returns undefined if no snapshot
   *  function was provided (tier-0). */
  async takeSnapshot(): Promise<S | undefined> {
    if (!this.spec.snapshot) return undefined;
    const s = await this.spec.snapshot();
    this.lastScene = s;
    await this.emit({ kind: "snapshot", scene: s, ts_ms: Date.now() - this.startTs });
    return s;
  }

  /** Re-snapshot and compute current goal status. Tier 2.
   *  Without snapshot+goal, returns a vacant status (gap 0, no assertions). */
  async status(): Promise<ObserverStatus<S>> {
    const scene = await this.takeSnapshot();
    if (!this.spec.goal || scene === undefined) {
      return { scene, assertions: [], satisfied: [], unmet: [], gap: 0, done: true };
    }
    const goal = normalizeGoal(this.spec.goal(scene));
    const all = checkAll(scene, goal);
    return {
      scene,
      assertions: all,
      satisfied:  all.filter(a => a.satisfied),
      unmet:      all.filter(a => !a.satisfied),
      gap:        distance(scene, goal),
      done:       all.every(a => a.satisfied),
    };
  }

  /** Record one step. Call after the tool runs.
   *  - With snapshot+goal: re-snapshots, computes deltas, detects drift.
   *  - With snapshot only: captures world before/after, no deltas.
   *  - Tier 0: just records the tool call + timing. */
  async recordStep(args: {
    tool?:             ToolCall | null;
    predicted_delta?:  number;
    reasoning?:        string;
    ok?:               boolean;
    error?:            string;
  } = {}): Promise<TrajectoryStep> {
    const before = this.lastScene;
    let after: S | undefined;
    let d_before = 0, d_after = 0;
    let assertions_before: AssertionState[] = [];
    let assertions_after:  AssertionState[] = [];

    if (this.spec.snapshot) {
      // re-snapshot to capture world delta
      after = await this.spec.snapshot();
      this.lastScene = after;

      if (this.spec.goal && before !== undefined) {
        const goalBefore = normalizeGoal(this.spec.goal(before));
        d_before = distance(before, goalBefore);
        assertions_before = checkAll(before, goalBefore);
      }
      if (this.spec.goal && after !== undefined) {
        const goalAfter = normalizeGoal(this.spec.goal(after));
        d_after = distance(after, goalAfter);
        assertions_after = checkAll(after, goalAfter);
      }
    }

    const step: TrajectoryStep = {
      step:              this.trajectory_.length,
      tool:              args.tool ?? null,
      predicted_delta:   args.predicted_delta,
      reasoning:         args.reasoning,
      d_before,
      d_after,
      delta:             d_before - d_after,
      assertions_before,
      assertions_after,
      scene_before:      before,
      scene_after:       after,
      ok:                args.ok ?? true,
      error:             args.error,
      ts_ms:             Date.now() - this.startTs,
    };

    this.trajectory_.push(step);
    await this.emit({ kind: "step", step });
    return step;
  }

  /** Quick check — all assertions satisfied?
   *  Tier 0/1: always true (no goal to check). */
  async done(): Promise<boolean> {
    if (!this.spec.goal || !this.spec.snapshot) return true;
    const s = await this.spec.snapshot();
    const goal = normalizeGoal(this.spec.goal(s));
    return checkAll(s, goal).every(a => a.satisfied);
  }

  /** Full trajectory so far. */
  trajectory(): TrajectoryStep[] {
    return [...this.trajectory_];
  }

  /** Reset the watcher (drop trajectory, clear cache). */
  reset(): void {
    this.trajectory_ = [];
    this.lastScene = undefined;
    this.startTs = Date.now();
  }

  private async emit(event: ObserverEvent) {
    if (!this.spec.exporters) return;
    for (const e of this.spec.exporters) {
      try { await e(event); } catch { /* exporter errors should not break the agent loop */ }
    }
  }
}

/** Factory — create a watcher from a spec. All fields optional. */
export function observe<S = unknown>(spec: ObserveSpec<S> = {}): Watcher<S> {
  return new Watcher(spec);
}

/**
 * Coerce whatever the user's `goal()` callback returns into the canonical
 * Goal<S> shape. Accepts:
 *   - mark Predicate         → returned as-is (preferred)
 *   - { assertions: [...] }  → returned as-is (legacy AssertionGoal)
 *   - Assertion[]            → wrapped as { assertions: [...] } (legacy direct)
 */
function normalizeGoal<S>(g: Goal<S> | Assertion<S>[]): Goal<S> {
  return Array.isArray(g) ? { assertions: g } : g;
}
