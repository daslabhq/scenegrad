/**
 * GreedySolver — pick the tool that closes the most gradient each step.
 *
 * Uses env.simulate() to dry-run every available tool, picks the one
 * with max delta = d_before - d_after. Stops when done() or when no
 * tool reduces distance (stuck).
 *
 * For ARC-style domains where tools have parametric args (e.g.
 * recolor(from, to)), the env exposes a discrete set of pre-bound
 * tool calls via tools() — greedy enumerates all of them.
 */

import type { SceneGradEnv, ToolCall } from "./env.js";
import { distance, checkAll } from "./env.js";
import type { Solver, SolveResult, SolverOpts, TrajectoryStep } from "./solver.js";

export class GreedySolver<S, T extends ToolCall = ToolCall> implements Solver<S, T> {
  name = "greedy";

  async solve(env: SceneGradEnv<S, T>, taskId: string, opts?: SolverOpts): Promise<SolveResult<T>> {
    const t_start = Date.now();
    const maxSteps = opts?.maxSteps ?? 30;

    env.reset(taskId);
    const trajectory: TrajectoryStep<T>[] = [];
    const d_initial = distance(env.scene(), env.goal());

    for (let step = 0; step < maxSteps; step++) {
      if (env.done()) break;

      const goal = env.goal();
      const d_before = distance(env.scene(), goal);

      // Try every available tool, pick the best.
      const candidates: Array<{ tool: T; d_after: number; delta: number }> = [];
      for (const tool of env.tools()) {
        if (!env.simulate) {
          throw new Error("GreedySolver requires env.simulate(); env did not provide one");
        }
        try {
          const result = env.simulate(tool);
          if (!result.ok) continue;
          const d_after = result.distance_after ?? distance(result.scene_after, goal);
          candidates.push({ tool, d_after, delta: d_before - d_after });
        } catch {
          // tool simulation threw — skip
          continue;
        }
      }

      candidates.sort((a, b) => b.delta - a.delta);
      const best = candidates[0];

      if (!best || best.delta <= 0) {
        // Stuck — no tool reduces distance. Greedy gives up.
        trajectory.push({
          step,
          tool: null,
          d_before,
          d_after: d_before,
          delta: 0,
          ok: false,
          error: "no tool reduces distance (stuck)",
          assertions_after: checkAll(env.scene(), goal),
          ts_ms: Date.now() - t_start,
        });
        break;
      }

      // Apply the best tool for real.
      const result = env.step(best.tool);
      const d_after = result.distance_after ?? distance(env.scene(), goal);

      trajectory.push({
        step,
        tool: best.tool,
        d_before,
        d_after,
        delta: d_before - d_after,
        ok: result.ok,
        error: result.error,
        assertions_after: checkAll(env.scene(), goal),
        ts_ms: Date.now() - t_start,
      });
    }

    const d_final = distance(env.scene(), env.goal());
    return {
      task_id:     taskId,
      solver:      this.name,
      success:     env.done(),
      steps:       trajectory.length,
      d_initial,
      d_final,
      duration_ms: Date.now() - t_start,
      trajectory,
    };
  }
}
