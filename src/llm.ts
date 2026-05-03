/**
 * LLMSolver — prompt an LLM with scene + goal + tools, parse the choice.
 *
 * Each turn:
 *   1. Build a prompt with current scene, goal assertions, available tools, distance
 *   2. Ask LLM to pick a tool + predict gradient closure
 *   3. Apply the chosen tool, measure actual closure
 *   4. Record predicted vs actual (the belief-vs-truth signal)
 *
 * Uses Anthropic SDK directly. Cheap-by-default: claude-haiku-4-5.
 */

import Anthropic from "@anthropic-ai/sdk";
import type { SceneGradEnv, ToolCall, Goal } from "./env.js";
import { distance, checkAll } from "./env.js";
import type { Solver, SolveResult, SolverOpts, TrajectoryStep } from "./solver.js";

interface LLMSolverOpts extends SolverOpts {
  model?:        string;
  apiKey?:       string;
  maxTokens?:    number;
  /** How to render scenes for the prompt — domain-specific. */
  formatScene?: (scene: unknown) => string;
  /**
   * Optional: render full task context (scene + goal + any extras like
   * a target view). When provided, replaces the default scene+goal block.
   * Use when the goal needs visual rendering (e.g. ARC: show target grid).
   */
  describeTask?: (scene: unknown, goal: Goal<unknown>) => string;
}

export class LLMSolver<S, T extends ToolCall = ToolCall> implements Solver<S, T> {
  name: string;
  private client: Anthropic;
  private model: string;
  private maxTokens: number;
  private formatScene: (scene: unknown) => string;
  private describeTask?: (scene: unknown, goal: Goal<unknown>) => string;

  constructor(opts: LLMSolverOpts = {}) {
    this.model = opts.model ?? "claude-haiku-4-5";
    this.name = `llm:${this.model}`;
    this.maxTokens = opts.maxTokens ?? 1024;
    this.client = new Anthropic({ apiKey: opts.apiKey ?? process.env.ANTHROPIC_API_KEY });
    this.formatScene = opts.formatScene ?? defaultFormatScene;
    this.describeTask = opts.describeTask;
  }

  async solve(env: SceneGradEnv<S, T>, taskId: string, opts?: SolverOpts): Promise<SolveResult<T>> {
    const t_start = Date.now();
    const maxSteps = opts?.maxSteps ?? 15;

    env.reset(taskId);
    const trajectory: TrajectoryStep<T>[] = [];
    const d_initial = distance(env.scene(), env.goal());

    for (let step = 0; step < maxSteps; step++) {
      if (env.done()) break;

      const goal = env.goal();
      const d_before = distance(env.scene(), goal);
      const tools = env.tools();

      const choice = await this.askLLM(env.scene(), goal, tools, d_before);

      if (!choice) {
        trajectory.push({
          step,
          tool: null,
          d_before, d_after: d_before, delta: 0,
          ok: false,
          error: "LLM did not return a valid tool choice",
          assertions_after: checkAll(env.scene(), goal),
          ts_ms: Date.now() - t_start,
        });
        break;
      }

      const result = env.step(choice.tool);
      const d_after = result.distance_after ?? distance(env.scene(), goal);

      trajectory.push({
        step,
        tool: choice.tool,
        d_before,
        d_after,
        delta: d_before - d_after,
        reasoning: choice.reasoning,
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
      model:       this.model,
      success:     env.done(),
      steps:       trajectory.length,
      d_initial,
      d_final,
      duration_ms: Date.now() - t_start,
      trajectory,
    };
  }

  private async askLLM<T2 extends ToolCall>(
    scene: unknown,
    goal: Goal<unknown>,
    tools: T2[],
    d_before: number,
  ): Promise<{ tool: T2; reasoning: string } | null> {
    const assertions = checkAll(scene, goal);
    const unmet = assertions.filter(a => !a.satisfied);

    const taskBlock = this.describeTask
      ? this.describeTask(scene, goal)
      : `CURRENT SCENE:\n${this.formatScene(scene)}\n\nGOAL ASSERTIONS:\n${
          unmet.length === 0
            ? "All assertions satisfied — done."
            : unmet.map(a => `  - [unmet, gap ${a.gap}] ${a.name}`).join("\n")
        }`;

    const toolsText = tools.map((t, i) =>
      `  ${i}. ${t.name}(${JSON.stringify(t.args)})`).join("\n");

    const prompt = `You are solving a scenegrad task — closing the gap between the current scene and a goal.

${taskBlock}

CURRENT DISTANCE: ${d_before}

AVAILABLE TOOLS:
${toolsText}

Pick exactly one tool that should reduce distance. Respond with strict JSON only:
{
  "tool_index": <integer 0..${tools.length - 1}>,
  "reasoning": "<one sentence>"
}

JSON only, no other text.`;

    try {
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: this.maxTokens,
        messages: [{ role: "user", content: prompt }],
      });

      const text = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map(b => b.text)
        .join("");

      const match = text.match(/\{[\s\S]*\}/);
      if (!match) return null;
      const parsed = JSON.parse(match[0]);

      const idx = Number(parsed.tool_index);
      if (!Number.isInteger(idx) || idx < 0 || idx >= tools.length) return null;

      return {
        tool: tools[idx]!,
        reasoning: String(parsed.reasoning ?? ""),
      };
    } catch (e) {
      return null;
    }
  }
}

function defaultFormatScene(scene: unknown): string {
  return JSON.stringify(scene, null, 2);
}
