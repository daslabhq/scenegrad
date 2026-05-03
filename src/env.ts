/**
 * SceneGradEnv — the contract every domain implements.
 *
 * scenegrad reframe: an agent's job is to close the gap between
 * scene_now and scene_then, where scene_then is a set of assertions.
 *
 * Domain author writes: scene(), goal(), tools(), step().
 * Framework derives: distance, simulate, solver dispatch, telemetry,
 * scrubbable trajectories — all from the same four methods.
 */

export type Distance = number;

export interface Assertion<S> {
  /** Human-readable name; surfaces in scrubber + agent prompts. */
  name: string;
  /** Check the assertion against a scene.
   *  - satisfied: did the goal hold?
   *  - gap: how far off (0 = satisfied; can be 1 binary or N graduated)
   *  - weight: optional scaling for distance contribution
   */
  check(scene: S): { satisfied: boolean; gap: number; weight?: number };
}

export interface Goal<S> {
  assertions: Assertion<S>[];
  /** Optional: combine per-assertion gaps into a scalar.
   *  Default: weighted sum. */
  reduce?: (gaps: number[]) => number;
}

export interface StepResult<S> {
  scene_after: S;
  ok: boolean;
  error?: string;
  /** Optional: env can pre-compute new distance to spare a recompute. */
  distance_after?: Distance;
}

/** A tool descriptor. Domains usually narrow this with a discriminated union. */
export interface ToolCall {
  name: string;
  args: Record<string, unknown>;
}

export interface SceneGradEnv<S, T extends ToolCall = ToolCall> {
  /** Reset to a specific task. Returns initial scene. */
  reset(taskId?: string): S;

  /** Current scene. Cheap read. */
  scene(): S;

  /** Goal as assertions. May vary per task. */
  goal(): Goal<S>;

  /** Tools available right now. May vary by state. */
  tools(): T[];

  /** Apply one tool. Mutates env state. */
  step(tool: T): StepResult<S>;

  /** Goal reached? */
  done(): boolean;

  /**
   * OPTIONAL — dry-run a tool. Returns predicted scene_after without
   * committing. If absent, framework defaults to clone-step-restore
   * via JSON round-trip on `scene()`. Override for cheaper simulation
   * when scenes are large.
   */
  simulate?(tool: T): StepResult<S>;
}

// ---------------------------------------------------------------------------
// Framework-derived helpers — work for any SceneGradEnv impl
// ---------------------------------------------------------------------------

/**
 * Default distance: weighted sum of unmet-assertion gaps.
 * Satisfied assertions contribute 0.
 */
export function distance<S>(scene: S, goal: Goal<S>): Distance {
  const gaps = goal.assertions.map(a => {
    const r = a.check(scene);
    if (r.satisfied) return 0;
    return (r.gap ?? 1) * (r.weight ?? 1);
  });
  return goal.reduce ? goal.reduce(gaps) : gaps.reduce((a, b) => a + b, 0);
}

/**
 * Per-assertion check result — surfaces in trajectories so we can see
 * which specific goals are unmet at each step.
 */
export interface AssertionState {
  name: string;
  satisfied: boolean;
  gap: number;
}

export function checkAll<S>(scene: S, goal: Goal<S>): AssertionState[] {
  return goal.assertions.map(a => {
    const r = a.check(scene);
    return { name: a.name, satisfied: r.satisfied, gap: r.satisfied ? 0 : (r.gap ?? 1) };
  });
}

/**
 * Default simulate: clone via JSON, apply step, restore. Works for any
 * env with JSON-serializable scenes and pure-functional tools.
 */
export function defaultSimulate<S, T extends ToolCall>(
  env: SceneGradEnv<S, T>,
  tool: T,
): StepResult<S> {
  if (env.simulate) return env.simulate(tool);
  // Snapshot, step, restore via private re-reset isn't generic enough — instead,
  // require domain to either implement simulate() or accept that step() is pure
  // and we'll restore via deep-clone of the result.
  const before = JSON.parse(JSON.stringify(env.scene())) as S;
  const result = env.step(tool);
  // Caller is responsible for not relying on this if env.step mutates external state
  // beyond `scene()`. ARC + most pure-data domains are fine.
  // Restore — this is the imperfect bit; domains with side effects MUST override.
  (env as any).__restoreScene?.(before);
  return result;
}
