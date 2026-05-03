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
