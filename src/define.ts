/**
 * defineEnv — factory for SceneGradEnv from four pure functions.
 *
 * Trade ceremony for clarity: write 4 functions, not a 7-method class.
 *
 *   const task = defineEnv({
 *     init:  () => ({ count: 0 }),
 *     goal:  (s) => [{ name: "count = 5",
 *                      check: s => ({ satisfied: s.count === 5, gap: 5 - s.count }) }],
 *     tools: (s) => [{ name: "inc" }, { name: "dec" }],
 *     step:  (s, t) => t.name === "inc" ? { count: s.count + 1 } : { count: s.count - 1 },
 *   });
 *
 *   const result = await new GreedySolver().solve(task, "default");
 */

import type { SceneGradEnv, ToolCall, Goal, Assertion, StepResult } from "./env.js";

export interface EnvSpec<S, T extends ToolCall = ToolCall> {
  /** Build the initial scene. Called by reset(). */
  init:  (taskId?: string) => S;
  /** Goal as a list of assertions. May depend on current scene. */
  goal:  (s: S) => Assertion<S>[];
  /** Tools available right now. May depend on current scene. */
  tools: (s: S) => T[];
  /** Pure transition: scene + tool → new scene. Throw on invalid args. */
  step:  (s: S, t: T) => S;
  /** Optional: optional describeTask override for LLMSolver prompts. */
  describeTask?: (s: S, goal: Goal<S>) => string;
}

class FunctionalEnv<S, T extends ToolCall> implements SceneGradEnv<S, T> {
  private state: S;
  constructor(private spec: EnvSpec<S, T>) {
    this.state = spec.init();
  }

  reset(taskId?: string): S {
    this.state = this.spec.init(taskId);
    return this.state;
  }
  scene(): S { return this.state; }
  goal(): Goal<S> { return { assertions: this.spec.goal(this.state) }; }
  tools(): T[] { return this.spec.tools(this.state); }

  step(tool: T): StepResult<S> {
    try {
      const after = this.spec.step(this.state, tool);
      this.state = after;
      return { scene_after: after, ok: true };
    } catch (e) {
      return { scene_after: this.state, ok: false, error: String(e) };
    }
  }

  done(): boolean {
    return this.spec.goal(this.state).every(a => a.check(this.state).satisfied);
  }

  simulate(tool: T): StepResult<S> {
    try {
      const after = this.spec.step(this.state, tool);
      return { scene_after: after, ok: true };
    } catch (e) {
      return { scene_after: this.state, ok: false, error: String(e) };
    }
  }

  /** Optional describeTask for LLMSolver — exposed so callers can wire it. */
  describeTask?(): string {
    return this.spec.describeTask?.(this.state, this.goal()) ?? "";
  }
}

export function defineEnv<S, T extends ToolCall = ToolCall>(spec: EnvSpec<S, T>): SceneGradEnv<S, T> & {
  describeTask?(): string;
} {
  return new FunctionalEnv(spec);
}
