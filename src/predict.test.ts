/**
 * Tests for the predictor surface that don't require an API key.
 * Exercises diffScene, evalWorldModel, and the DreamerSolver dispatch
 * via a mock Predictor.
 */

import { describe, test, expect } from "bun:test";
import { diffScene } from "./predict.js";
import type { Predictor } from "./predict.js";
import { defineEnv } from "./define.js";
import { DreamerSolver } from "./dreamer.js";
import { evalWorldModel } from "./eval/worldmodel.js";
import type { ToolCall } from "./env.js";

// ---------------------------------------------------------------------------
// diffScene
// ---------------------------------------------------------------------------

describe("diffScene", () => {
  test("detects changed top-level keys", () => {
    const a = { count: 0, name: "a" };
    const b = { count: 1, name: "a" };
    expect(diffScene(a, b)).toEqual({
      changed_keys: ["count"], added_keys: [], removed_keys: [],
    });
  });

  test("detects added and removed keys", () => {
    const a: Record<string, unknown> = { x: 1 };
    const b: Record<string, unknown> = { y: 2 };
    const d = diffScene(a, b);
    expect(d.added_keys).toEqual(["y"]);
    expect(d.removed_keys).toEqual(["x"]);
    expect(d.changed_keys).toEqual([]);
  });

  test("ignores unchanged keys", () => {
    const a = { a: 1, b: 2 };
    const b = { a: 1, b: 2 };
    expect(diffScene(a, b)).toEqual({ changed_keys: [], added_keys: [], removed_keys: [] });
  });

  test("uses deep equality on values", () => {
    const a = { items: [{ id: 1, status: "x" }] };
    const b = { items: [{ id: 1, status: "y" }] };
    expect(diffScene(a, b).changed_keys).toEqual(["items"]);
  });
});

// ---------------------------------------------------------------------------
// Mock predictor that runs the env's `step` directly — perfect oracle.
// Use it to verify DreamerSolver and evalWorldModel work end-to-end.
// ---------------------------------------------------------------------------

interface CounterScene { count: number }
type CounterTool = { name: "inc" | "dec"; args: Record<string, never> };

function makeCounterEnv() {
  return defineEnv<CounterScene, CounterTool>({
    init:  () => ({ count: 0 }),
    goal:  () => [{
      name:  "count = 3",
      check: (s) => ({ satisfied: s.count === 3, gap: Math.abs(3 - s.count) }),
    }],
    tools: () => [{ name: "inc", args: {} }, { name: "dec", args: {} }],
    step:  (s, t) => ({ count: t.name === "inc" ? s.count + 1 : s.count - 1 }),
  });
}

class OraclePredictor implements Predictor<CounterScene, CounterTool> {
  readonly name = "oracle";
  async predict(scene: CounterScene, tool: CounterTool) {
    const after = tool.name === "inc" ? { count: scene.count + 1 } : { count: scene.count - 1 };
    return {
      scene_after:  after,
      outcome:      { ok: true, p: 1 },
      delta:        diffScene(scene, after),
      blast_radius: [],
      confidence:   1,
      analogues:    [],
    };
  }
}

class WrongPredictor implements Predictor<CounterScene, CounterTool> {
  readonly name = "wrong";
  async predict(scene: CounterScene, _tool: CounterTool) {
    // Always predicts no-op.
    return {
      scene_after:  scene,
      outcome:      { ok: true, p: 1 },
      delta:        { changed_keys: [], added_keys: [], removed_keys: [] },
      blast_radius: [],
      confidence:   1,
      analogues:    [],
    };
  }
}

// ---------------------------------------------------------------------------
// DreamerSolver — with a perfect predictor it solves the toy task.
// ---------------------------------------------------------------------------

describe("DreamerSolver", () => {
  test("oracle predictor → reaches goal", async () => {
    const env       = makeCounterEnv();
    const predictor = new OraclePredictor();
    const r = await new DreamerSolver({ predictor, lookahead: 1 })
      .solve(env, "default", { maxSteps: 10 });
    expect(r.success).toBe(true);
    expect(r.steps).toBe(3);
    expect(r.d_final).toBe(0);
  });

  test("wrong predictor → gives up gracefully", async () => {
    const env       = makeCounterEnv();
    const predictor = new WrongPredictor();
    const r = await new DreamerSolver({ predictor, lookahead: 1 })
      .solve(env, "default", { maxSteps: 10 });
    expect(r.success).toBe(false);
    // No predicted action reduces distance — solver halts on first step.
    expect(r.steps).toBe(1);
    expect(r.trajectory[0]?.tool).toBe(null);
  });
});

// ---------------------------------------------------------------------------
// evalWorldModel — replay actions and score predicted vs actual.
// ---------------------------------------------------------------------------

describe("evalWorldModel", () => {
  test("oracle predictor scores 100% on known actions", async () => {
    const env       = makeCounterEnv();
    const predictor = new OraclePredictor();
    const m = await evalWorldModel({
      env, predictor,
      tasks: [{ taskId: "default", actions: [
        { name: "inc", args: {} }, { name: "inc", args: {} }, { name: "inc", args: {} },
      ]}],
    });
    expect(m.steps).toBe(3);
    expect(m.outcome_acc).toBe(1);
    expect(m.scene_match).toBe(1);
    expect(m.delta_match).toBe(1);
    expect(m.avg_confidence).toBe(1);
  });

  test("wrong predictor scores 0% on scene_match", async () => {
    const env       = makeCounterEnv();
    const predictor = new WrongPredictor();
    const m = await evalWorldModel({
      env, predictor,
      tasks: [{ taskId: "default", actions: [
        { name: "inc", args: {} }, { name: "inc", args: {} },
      ]}],
    });
    expect(m.steps).toBe(2);
    expect(m.scene_match).toBe(0);
    expect(m.delta_match).toBe(0);
    // outcome_acc is still 1 — both predicted ok and actual ok are true.
    expect(m.outcome_acc).toBe(1);
  });
});
