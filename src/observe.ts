/**
 * Observer mode — scenegrad sits alongside an existing agent loop.
 *
 * You bring your agent (Vercel AI SDK, LangChain, custom). You give scenegrad:
 *   - snapshot(): how to fetch the current world state
 *   - goal(s):   what assertions define "done"
 *
 * scenegrad gives you back:
 *   - watcher.status()      — what's satisfied, what's unmet, current gap.
 *                             Inject into your system prompt so the agent
 *                             knows what's still left to do.
 *   - watcher.recordStep()  — call after each tool runs. scenegrad
 *                             re-snapshots the world and computes the delta.
 *   - watcher.trajectory()  — full timeline of steps + assertion states.
 *   - watcher.done()        — all assertions satisfied?
 *
 * This is the primary integration mode for production agents — your loop
 * stays the same, scenegrad observes the world (not just tool calls).
 */

import type { Assertion, AssertionState, ToolCall } from "./env.js";
import { distance, checkAll } from "./env.js";

export interface ObserveSpec<S> {
  /** Fetch the current world state. May be async. Called whenever
   *  scenegrad needs a fresh view (status, recordStep). */
  snapshot: () => Promise<S> | S;

  /** Assertions defining "done." May depend on current scene. */
  goal: (s: S) => Assertion<S>[];

  /** Optional: side-channel handlers for emitted events (e.g. write to
   *  JSONL, push to viewer over WebSocket). */
  exporters?: ((event: ObserverEvent) => void | Promise<void>)[];
}

export type ObserverEvent =
  | { kind: "step";     step: TrajectoryStep }
  | { kind: "snapshot"; scene: unknown; ts_ms: number }
  | { kind: "done";     final_status: ObserverStatus<unknown> };

export interface ObserverStatus<S> {
  scene:        S;
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
  ok:                 boolean;
  error?:             string;
  ts_ms:              number;
}

export class Watcher<S> {
  private trajectory_: TrajectoryStep[] = [];
  private lastScene?:  S;
  private startTs:     number;

  constructor(private spec: ObserveSpec<S>) {
    this.startTs = Date.now();
  }

  /** Take a fresh snapshot of the world. Caches as lastScene. */
  async takeSnapshot(): Promise<S> {
    const s = await this.spec.snapshot();
    this.lastScene = s;
    await this.emit({ kind: "snapshot", scene: s, ts_ms: Date.now() - this.startTs });
    return s;
  }

  /** Re-snapshot and compute current goal status — what's satisfied,
   *  what's unmet, current gap. Inject into your system prompt. */
  async status(): Promise<ObserverStatus<S>> {
    const scene = await this.takeSnapshot();
    const assertions_arr = this.spec.goal(scene);
    const goal = { assertions: assertions_arr };
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

  /** Record one step (a tool call's effect). Call after the tool runs.
   *  scenegrad re-snapshots, computes the delta, fires exporters. */
  async recordStep(args: {
    tool?:             ToolCall | null;
    predicted_delta?:  number;
    reasoning?:        string;
    ok?:               boolean;
    error?:            string;
  } = {}): Promise<TrajectoryStep> {
    const before = this.lastScene ?? await this.takeSnapshot();
    const goalBefore = { assertions: this.spec.goal(before) };
    const d_before = distance(before, goalBefore);
    const assertions_before = checkAll(before, goalBefore);

    // Re-snapshot — assume the tool has mutated the world externally.
    const after = await this.spec.snapshot();
    this.lastScene = after;
    const goalAfter = { assertions: this.spec.goal(after) };
    const d_after = distance(after, goalAfter);
    const assertions_after = checkAll(after, goalAfter);

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
      ok:                args.ok ?? true,
      error:             args.error,
      ts_ms:             Date.now() - this.startTs,
    };

    this.trajectory_.push(step);
    await this.emit({ kind: "step", step });
    return step;
  }

  /** Quick check — all assertions satisfied? Re-snapshots. */
  async done(): Promise<boolean> {
    const s = await this.spec.snapshot();
    return this.spec.goal(s).every(a => a.check(s).satisfied);
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

/** Factory — create a watcher from a spec. */
export function observe<S>(spec: ObserveSpec<S>): Watcher<S> {
  return new Watcher(spec);
}
