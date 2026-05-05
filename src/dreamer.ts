/**
 * DreamerSolver — plan in the predictor, act in the env.
 *
 * Each turn:
 *   1. Enumerate tools available now.
 *   2. For each candidate tool, ask the Predictor what happens.
 *      (Optional lookahead k>1 rolls out k steps deep recursively.)
 *   3. Pick the action whose imagined trajectory closes the most distance.
 *   4. Commit that single action to the real env.
 *   5. Repeat.
 *
 * v0 is the plain "predict-and-pick" base case — like GreedySolver but
 * using a learned dynamics function instead of env.simulate(). That's
 * the unlock for envs where you can't write a simulator (real APIs,
 * databases, integrations).
 *
 * Future versions add value-net guided rollouts and policy distillation
 * from imagined trajectories — the full Dreamer arc.
 */

import type { SceneGradEnv, ToolCall, Goal } from "./env.js";
import { distance, checkAll } from "./env.js";
import type { Solver, SolveResult, SolverOpts, TrajectoryStep } from "./solver.js";
import type { Predictor } from "./predict.js";

export interface DreamerSolverOpts extends SolverOpts {
  predictor: Predictor<any, any>;
  /** Plan depth — how many predictor calls to chain per candidate.
   *  v0 ships with k=1 working well; k>1 is exponential and best for small toolsets. */
  lookahead?: number;
  /** Optional beam width for k>1. Defaults to all candidates. */
  beam?:      number;
  /** Filter low-confidence predictions out of planning. Default 0 — keep all. */
  minConfidence?: number;
}

export class DreamerSolver<S, T extends ToolCall = ToolCall> implements Solver<S, T> {
  readonly name: string;
  private predictor:   Predictor<S, T>;
  private lookahead:   number;
  private beam:        number;
  private minConf:     number;

  constructor(opts: DreamerSolverOpts) {
    this.predictor = opts.predictor as Predictor<S, T>;
    this.lookahead = Math.max(1, opts.lookahead ?? 1);
    this.beam      = Math.max(1, opts.beam      ?? Infinity);
    this.minConf   = Math.max(0, opts.minConfidence ?? 0);
    this.name      = `dreamer(${this.predictor.name},k=${this.lookahead})`;
  }

  async solve(env: SceneGradEnv<S, T>, taskId: string, opts?: SolverOpts): Promise<SolveResult<T>> {
    const t_start  = Date.now();
    const maxSteps = opts?.maxSteps ?? 30;

    env.reset(taskId);
    const trajectory: TrajectoryStep<T>[] = [];
    const d_initial  = distance(env.scene(), env.goal());

    for (let step = 0; step < maxSteps; step++) {
      if (env.done()) break;

      const goal     = env.goal();
      const d_before = distance(env.scene(), goal);
      const tools    = env.tools();
      if (tools.length === 0) break;

      const best = await this.pickBest(env.scene(), tools, goal);

      if (!best || best.predicted_d_after >= d_before) {
        trajectory.push({
          step,
          tool:             null,
          d_before,
          d_after:          d_before,
          delta:            0,
          predicted_delta:  best ? d_before - best.predicted_d_after : 0,
          ok:               false,
          error:            "no predicted action reduces distance (stuck or low-confidence)",
          assertions_after: checkAll(env.scene(), goal),
          ts_ms:            Date.now() - t_start,
        });
        break;
      }

      // Commit the chosen action to the real env.
      const result  = env.step(best.tool);
      const d_after = result.distance_after ?? distance(env.scene(), goal);

      trajectory.push({
        step,
        tool:             best.tool,
        d_before,
        d_after,
        delta:            d_before - d_after,
        predicted_delta:  d_before - best.predicted_d_after,
        reasoning:        best.reasoning,
        ok:               result.ok,
        error:            result.error,
        assertions_after: checkAll(env.scene(), goal),
        ts_ms:            Date.now() - t_start,
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

  /**
   * Pick the tool whose imagined rollout reaches the lowest distance.
   * Lookahead=1: one predictor call per tool. Lookahead=k: chains k.
   */
  private async pickBest(
    scene: S,
    tools: T[],
    goal:  Goal<S>,
  ): Promise<{ tool: T; predicted_d_after: number; reasoning?: string } | null> {
    const candidates = await Promise.all(
      tools.map(async (tool) => {
        const c = await this.predictor.predict(scene, tool);
        if (c.confidence < this.minConf) return null;
        if (!c.outcome.ok) return null;
        const d_after = await this.rolloutTail(c.scene_after, goal, this.lookahead - 1);
        return { tool, predicted_d_after: d_after, reasoning: c.reasoning };
      }),
    );
    const valid = candidates.filter((x): x is NonNullable<typeof x> => x !== null);
    if (valid.length === 0) return null;
    valid.sort((a, b) => a.predicted_d_after - b.predicted_d_after);
    return valid[0]!;
  }

  /**
   * Roll out depth-k more predictor steps after the head action, returning
   * the best (lowest) distance reachable. k=0 returns the head's distance.
   */
  private async rolloutTail(scene: S, goal: Goal<S>, k: number): Promise<number> {
    if (k <= 0) return distance(scene, goal);
    // Synthetic env-less rollout: we don't have env.tools() for predicted
    // future scenes. v0 punts: trust the head prediction. v0.1 will pass
    // a domain-provided `toolsAt(scene)` for true k-step lookahead.
    return distance(scene, goal);
  }
}
