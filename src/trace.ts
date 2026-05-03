/**
 * trace — the lowest-friction entry point to scenegrad.
 *
 *   import { trace } from "scenegrad";
 *
 *   const t = trace.start({ name: "my-agent" });
 *
 *   const result = await generateText({
 *     model: anthropic("claude-haiku-4-5"),
 *     tools: { ... },
 *     onStepFinish: t.captureStep,   // ← only addition
 *     prompt: "...",
 *   });
 *
 *   await t.dump("./traces/run.jsonl");
 *
 * That's it. Two lines added. You get a scrubbable replay of every tool
 * call in your agent run, viewable in the scenegrad viewer.
 *
 * Level up by passing `snapshot` / `goal` later — see observe() docs.
 */

import { writeFileSync } from "node:fs";
import { observe, Watcher, type ObserveSpec, type TrajectoryStep } from "./observe.js";
import type { ToolCall } from "./env.js";

export interface TraceHandle<S = unknown> {
  /** Underlying watcher. */
  readonly watcher: Watcher<S>;

  /** Drop this into Vercel AI SDK's onStepFinish (or any equivalent
   *  hook). Captures tool calls + (if snapshot is configured) world
   *  state changes. */
  captureStep: (step: { toolCalls?: any[] } | unknown) => Promise<void>;

  /** Manually record a step — for custom loops. */
  record(args?: Parameters<Watcher<S>["recordStep"]>[0]): Promise<TrajectoryStep>;

  /** Full trajectory so far. */
  trajectory(): TrajectoryStep[];

  /** Status — tier 2+ only; vacuous when no goal is set. */
  status(): ReturnType<Watcher<S>["status"]>;

  /** Write the trajectory to a JSONL file. */
  dump(path: string): void;

  /** Get the trajectory as a JSON-serializable object. */
  toJSON(): object;
}

/**
 * Start a trace.
 *
 * Tier 0 — no args:
 *   const t = trace.start();
 *
 * Tier 1 — with snapshot:
 *   const t = trace.start({ snapshot: () => fetchWorld() });
 *
 * Tier 2 — full observer with goal:
 *   const t = trace.start({ snapshot: ..., goal: (s) => [...assertions] });
 */
function start<S = unknown>(spec: ObserveSpec<S> = {}): TraceHandle<S> {
  const watcher = observe(spec);

  // Bind so users can pass `t.captureStep` directly without arrow wrappers.
  const captureStep = async (step: any) => {
    const calls = step?.toolCalls ?? step?.tool_calls ?? [];
    if (Array.isArray(calls) && calls.length > 0) {
      for (const call of calls) {
        const tool: ToolCall = {
          name: call.toolName ?? call.name ?? "unknown",
          args: call.input ?? call.args ?? {},
        };
        await watcher.recordStep({ tool });
      }
    } else {
      await watcher.recordStep({});
    }
  };

  return {
    watcher,
    captureStep,
    record:     (args) => watcher.recordStep(args ?? {}),
    trajectory: () => watcher.trajectory(),
    status:     () => watcher.status(),
    dump:       (path: string) => writeFileSync(path, JSON.stringify(toSpan(watcher)) + "\n"),
    toJSON:     () => toSpan(watcher),
  };
}

export const trace = { start };

// ---------------------------------------------------------------------------
// Serialize a watcher's trajectory as a scene-otel-compatible span.
// ---------------------------------------------------------------------------

function toSpan(watcher: Watcher<any>): object {
  const trajectory = watcher.trajectory();
  const start_ns = (Date.now() - (trajectory[trajectory.length - 1]?.ts_ms ?? 0)) * 1e6;
  const end_ns = Date.now() * 1e6;
  const trace_id = randomHex(32), span_id = randomHex(16);

  const events = trajectory.flatMap((t) => {
    const ts_ns = start_ns + t.ts_ms * 1e6;
    const out: any[] = [];
    if (t.tool) {
      out.push({
        name: "scene.set",
        time_ns: ts_ns,
        attributes: {
          "scene.key":         "tool",
          "scene.kind":        "intent",
          "scene.value":       JSON.stringify({ tool: t.tool, predicted_delta: t.predicted_delta, reasoning: t.reasoning }),
          "scene.value.type":  "json",
          "scene.value.size":  0,
          "scene.commit_hash": "",
          "scene.description": t.tool.name,
        },
      });
    }
    out.push({
      name: "scene.set",
      time_ns: ts_ns + 1,
      attributes: {
        "scene.key":         "distance",
        "scene.kind":        "actual",
        "scene.value":       JSON.stringify({ d_before: t.d_before, d_after: t.d_after, delta: t.delta }),
        "scene.value.type":  "json",
        "scene.value.size":  0,
        "scene.commit_hash": "",
        "scene.description": `step ${t.step}`,
      },
    });
    return out;
  });

  return {
    trace_id,
    span_id,
    parent_span_id: null,
    name:           watcher.name,
    start_time_ns:  start_ns,
    end_time_ns:    end_ns,
    kind:           0,
    status:         { code: 0 },
    attributes: {
      "bench.steps":     trajectory.length,
      "bench.d_initial": trajectory[0]?.d_before ?? 0,
      "bench.d_final":   trajectory[trajectory.length - 1]?.d_after ?? 0,
    },
    events,
  };
}

function randomHex(n: number): string {
  let s = "";
  for (let i = 0; i < n; i++) s += "0123456789abcdef"[Math.floor(Math.random() * 16)];
  return s;
}
