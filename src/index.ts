/**
 * scenegrad — agents close the gap between scene-now and scene-then.
 *
 * Public API:
 *   - SceneGradEnv: the contract every domain implements
 *   - Goal, Assertion: assertion-shaped goal language
 *   - GreedySolver, LLMSolver: ship-with solvers
 *   - distance(), checkAll(): framework-derived helpers
 */

export type {
  SceneGradEnv,
  ToolCall,
  Goal,
  Assertion,
  StepResult,
  Distance,
  AssertionState,
} from "./env.js";

export { distance, checkAll } from "./env.js";

export type {
  Solver,
  SolverOpts,
  SolveResult,
  TrajectoryStep,
} from "./solver.js";

export { GreedySolver } from "./greedy.js";
export { LLMSolver } from "./llm.js";
export { defineEnv, type EnvSpec } from "./define.js";

// tier 4 — predictor (world model) + dreamer solver + eval.
// LLMPredictor is the v0 placeholder; future predictors (kNN over a trace
// store, distilled, fully learned) drop in via the same Predictor interface.
export type {
  Predictor,
  Consequence,
  ScenePatch,
  BlastEdge,
  Analogue,
} from "./predict.js";
export {
  diffScene,
  predictorAsSimulate,
  quickConsistencyCheck,
} from "./predict.js";
export { LLMPredictor, type LLMPredictorOpts } from "./predict-llm.js";
export { DreamerSolver, type DreamerSolverOpts } from "./dreamer.js";
export {
  evalWorldModel,
  tasksFromSolver,
  formatMetrics,
  type EvalTask,
  type EvalOpts,
  type WorldModelMetrics,
  type WorldModelStepResult,
} from "./eval/worldmodel.js";

// Observer mode — the primary integration for production agent loops.
// Your loop drives tools; scenegrad observes the world.
export {
  observe,
  Watcher,
  type ObserveSpec,
  type ObserverStatus,
  type ObserverEvent,
  type TrajectoryStep as ObserverTrajectoryStep,
} from "./observe.js";

// trace — the lowest-friction tier-0 entry point.
//   const t = trace.start(); // 2-line drop-in for any agent loop.
export { trace, type TraceHandle } from "./trace.js";
