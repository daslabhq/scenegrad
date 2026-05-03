/**
 * Solver — given an env, run until done or out of budget.
 *
 * Two solvers ship in v0.0.1: GreedySolver and LLMSolver. Both
 * polymorphic over SceneGradEnv. Both produce the same trajectory
 * shape so they're directly comparable on a leaderboard.
 */

import type { SceneGradEnv, ToolCall, AssertionState, Distance } from "./env.js";
import { distance, checkAll } from "./env.js";

export interface TrajectoryStep<T extends ToolCall = ToolCall> {
  step:               number;
  tool:               T | null;       // null if rejected/no candidate found
  d_before:           Distance;
  d_after:            Distance;
  delta:              Distance;        // d_before - d_after (positive = closer to goal)
  predicted_delta?:   Distance;        // LLM solver only — agent's claimed closure
  reasoning?:         string;          // LLM solver only — agent's stated reason
  ok:                 boolean;
  error?:             string;
  assertions_after:   AssertionState[];
  ts_ms:              number;
}

export interface SolveResult<T extends ToolCall = ToolCall> {
  task_id:           string;
  solver:            string;
  model?:            string;
  success:           boolean;
  steps:             number;
  d_initial:         Distance;
  d_final:           Distance;
  duration_ms:       number;
  trajectory:        TrajectoryStep<T>[];
}

export interface SolverOpts {
  maxSteps?:   number;
  /** Per-step timeout in ms (LLM solver only). */
  stepTimeoutMs?: number;
}

export interface Solver<S, T extends ToolCall = ToolCall> {
  name: string;
  solve(env: SceneGradEnv<S, T>, taskId: string, opts?: SolverOpts): Promise<SolveResult<T>>;
}
