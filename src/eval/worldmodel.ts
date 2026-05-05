/**
 * worldmodel-accuracy — score a Predictor against a real environment.
 *
 *   const metrics = await evalWorldModel({ env, predictor, tasks });
 *   // { outcome_acc, scene_match, delta_match, avg_confidence, ece, ... }
 *
 * Replays a known sequence of tool calls. At each step:
 *   - capture scene_before
 *   - call predictor.predict(scene_before, tool) — record predicted scene
 *   - call env.step(tool) — observe actual scene_after
 *   - score predicted vs actual (deep equal on scene; classify on outcome)
 *
 * The metric set is deliberately small in v0; richer scoring (typed deltas,
 * blast-radius recall, calibration over outcome classes) lands alongside
 * scenecast canonical types and trace corpora.
 */

import type { SceneGradEnv, ToolCall } from "./../env.js";
import type { Predictor } from "./../predict.js";
import { diffScene } from "./../predict.js";
import type { Solver, SolverOpts } from "./../solver.js";

export interface WorldModelStepResult<T extends ToolCall = ToolCall> {
  task_id:        string;
  step:           number;
  tool:           T;
  predicted_ok:   boolean;
  actual_ok:      boolean;
  scene_match:    boolean;
  delta_match:    boolean;
  confidence:     number;
}

export interface WorldModelMetrics<T extends ToolCall = ToolCall> {
  predictor:      string;
  tasks:          number;
  steps:          number;
  outcome_acc:    number;   // P(predicted_ok == actual_ok)
  scene_match:    number;   // P(predicted scene_after deep-equals actual)
  delta_match:    number;   // P(predicted change-keys equal actual change-keys)
  avg_confidence: number;
  ece:            number;   // expected calibration error on scene_match
  per_step:       WorldModelStepResult<T>[];
}

export interface EvalTask<T extends ToolCall = ToolCall> {
  taskId?: string;
  /** Action sequence to replay against env. */
  actions: T[];
}

export interface EvalOpts<S, T extends ToolCall = ToolCall> {
  env:       SceneGradEnv<S, T>;
  predictor: Predictor<S, T>;
  tasks:     EvalTask<T>[];
}

export async function evalWorldModel<S, T extends ToolCall = ToolCall>(
  opts: EvalOpts<S, T>,
): Promise<WorldModelMetrics<T>> {
  const { env, predictor, tasks } = opts;
  const per_step: WorldModelStepResult<T>[] = [];

  for (const task of tasks) {
    const taskId = task.taskId ?? "default";
    env.reset(taskId);

    for (let i = 0; i < task.actions.length; i++) {
      const tool   = task.actions[i]!;
      const before = cloneScene(env.scene());

      const predicted = await predictor.predict(before, tool);
      const actual    = env.step(tool);

      const actualDelta    = diffScene(before, actual.scene_after);
      const predictedDelta = predicted.delta;

      per_step.push({
        task_id:      taskId,
        step:         i,
        tool,
        predicted_ok: predicted.outcome.ok,
        actual_ok:    actual.ok,
        scene_match:  jsonEq(predicted.scene_after, actual.scene_after),
        delta_match:  sameKeySet(actualDelta, predictedDelta),
        confidence:   predicted.confidence,
      });
    }
  }

  return aggregate(predictor.name, tasks.length, per_step);
}

/**
 * Convenience — run a Solver, capture its action sequence, hand to evalWorldModel.
 * Useful when you don't have ground-truth trajectories yet but want a quick
 * accuracy read on whatever an agent actually does.
 */
export async function tasksFromSolver<S, T extends ToolCall>(
  env:     SceneGradEnv<S, T>,
  solver:  Solver<S, T>,
  taskIds: string[],
  opts?:   SolverOpts,
): Promise<EvalTask<T>[]> {
  const out: EvalTask<T>[] = [];
  for (const id of taskIds) {
    const r = await solver.solve(env, id, opts);
    const actions = r.trajectory
      .map(s => s.tool)
      .filter((t): t is T => t !== null);
    out.push({ taskId: id, actions });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function aggregate<T extends ToolCall>(
  predictorName: string,
  taskCount:     number,
  per_step:      WorldModelStepResult<T>[],
): WorldModelMetrics<T> {
  const n = per_step.length;
  if (n === 0) {
    return {
      predictor: predictorName, tasks: taskCount, steps: 0,
      outcome_acc: 0, scene_match: 0, delta_match: 0,
      avg_confidence: 0, ece: 0, per_step,
    };
  }
  const outcome_acc    = per_step.filter(s => s.predicted_ok === s.actual_ok).length / n;
  const scene_match    = per_step.filter(s => s.scene_match).length / n;
  const delta_match    = per_step.filter(s => s.delta_match).length / n;
  const avg_confidence = per_step.reduce((a, s) => a + s.confidence, 0) / n;
  const ece            = expectedCalibrationError(per_step);
  return {
    predictor: predictorName, tasks: taskCount, steps: n,
    outcome_acc, scene_match, delta_match, avg_confidence, ece, per_step,
  };
}

/**
 * 10-bin expected calibration error, comparing reported confidence
 * against scene_match as the empirical correctness signal.
 */
function expectedCalibrationError<T extends ToolCall>(per_step: WorldModelStepResult<T>[]): number {
  const bins = 10;
  const buckets: Array<{ conf: number[]; correct: number[] }> = [];
  for (let i = 0; i < bins; i++) buckets.push({ conf: [], correct: [] });
  for (const s of per_step) {
    const idx = Math.min(bins - 1, Math.max(0, Math.floor(s.confidence * bins)));
    buckets[idx]!.conf.push(s.confidence);
    buckets[idx]!.correct.push(s.scene_match ? 1 : 0);
  }
  const n = per_step.length;
  let ece = 0;
  for (const b of buckets) {
    if (b.conf.length === 0) continue;
    const avgConf    = b.conf.reduce((a, x) => a + x, 0) / b.conf.length;
    const avgCorrect = b.correct.reduce((a, x) => a + x, 0) / b.correct.length;
    ece += (b.conf.length / n) * Math.abs(avgConf - avgCorrect);
  }
  return ece;
}

function cloneScene<S>(s: S): S {
  return JSON.parse(JSON.stringify(s)) as S;
}

function jsonEq(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function sameKeySet(a: { changed_keys: string[]; added_keys: string[]; removed_keys: string[] },
                    b: { changed_keys: string[]; added_keys: string[]; removed_keys: string[] }): boolean {
  const setEq = (x: string[], y: string[]) => {
    if (x.length !== y.length) return false;
    const xs = new Set(x); for (const k of y) if (!xs.has(k)) return false;
    return true;
  };
  return setEq(a.changed_keys, b.changed_keys)
      && setEq(a.added_keys,   b.added_keys)
      && setEq(a.removed_keys, b.removed_keys);
}

/** Pretty-print metrics as a one-line summary + optional table. */
export function formatMetrics<T extends ToolCall>(m: WorldModelMetrics<T>, opts?: { perStep?: boolean }): string {
  const lines: string[] = [];
  lines.push(
    `${m.predictor}  tasks=${m.tasks}  steps=${m.steps}  ` +
    `outcome=${(m.outcome_acc * 100).toFixed(1)}%  ` +
    `scene=${(m.scene_match * 100).toFixed(1)}%  ` +
    `delta=${(m.delta_match * 100).toFixed(1)}%  ` +
    `conf=${m.avg_confidence.toFixed(2)}  ` +
    `ece=${m.ece.toFixed(3)}`
  );
  if (opts?.perStep) {
    for (const s of m.per_step) {
      lines.push(
        `  ${s.task_id} #${s.step} ${s.tool.name}` +
        `  ok:${flag(s.predicted_ok === s.actual_ok)}` +
        `  scene:${flag(s.scene_match)}` +
        `  delta:${flag(s.delta_match)}` +
        `  conf=${s.confidence.toFixed(2)}`
      );
    }
  }
  return lines.join("\n");
}

const flag = (b: boolean) => b ? "Y" : "N";
