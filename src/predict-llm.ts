/**
 * LLMPredictor — v0 world model: ask the LLM what happens next.
 *
 *   const p = new LLMPredictor({ model: "claude-haiku-4-5" });
 *   const c = await p.predict(scene, tool);
 *
 * Not the moat — anyone can do this. It exists to (1) ship the Predictor
 * surface end-to-end on day one, (2) give DreamerSolver something to plan
 * against, (3) provide a baseline for the worldmodel-accuracy benchmark.
 * Future Predictors (kNN, distilled, learned) drop in via the same API.
 */

import Anthropic from "@anthropic-ai/sdk";
import type { ToolCall } from "./env.js";
import type { Predictor, Consequence } from "./predict.js";
import { diffScene } from "./predict.js";

export interface LLMPredictorOpts {
  model?:     string;
  apiKey?:    string;
  maxTokens?: number;
  /** How to render scenes for the prompt — domain-specific. */
  formatScene?: (scene: unknown) => string;
}

export class LLMPredictor<S, T extends ToolCall = ToolCall> implements Predictor<S, T> {
  readonly name: string;
  private client:    Anthropic;
  private model:     string;
  private maxTokens: number;
  private formatScene: (scene: unknown) => string;

  constructor(opts: LLMPredictorOpts = {}) {
    this.model       = opts.model     ?? "claude-haiku-4-5";
    this.maxTokens   = opts.maxTokens ?? 2048;
    this.name        = `llm:${this.model}`;
    this.client      = new Anthropic({ apiKey: opts.apiKey ?? process.env.ANTHROPIC_API_KEY });
    this.formatScene = opts.formatScene ?? defaultFormatScene;
  }

  async predict(scene: S, tool: T): Promise<Consequence<S>> {
    const prompt = this.buildPrompt(scene, tool);

    let parsed: PredictionPayload<S> | null = null;
    let raw = "";

    try {
      const response = await this.client.messages.create({
        model:      this.model,
        max_tokens: this.maxTokens,
        messages:   [{ role: "user", content: prompt }],
      });
      raw = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map(b => b.text)
        .join("");
      const match = raw.match(/\{[\s\S]*\}/);
      if (match) parsed = JSON.parse(match[0]) as PredictionPayload<S>;
    } catch {
      parsed = null;
    }

    if (!parsed || parsed.scene_after === undefined) {
      // Predictor failed — return a "no-op, low-confidence" consequence so
      // callers don't crash. DreamerSolver treats low confidence as a signal.
      return {
        scene_after:  scene,
        outcome:      { ok: false, error_class: "predictor_failed", p: 1 },
        delta:        { added_keys: [], removed_keys: [], changed_keys: [] },
        blast_radius: [],
        confidence:   0,
        analogues:    [],
        reasoning:    raw || "predictor returned no parseable JSON",
      };
    }

    const scene_after = parsed.scene_after;
    const ok          = parsed.ok ?? true;
    const confidence  = clamp01(parsed.confidence ?? 0.5);

    return {
      scene_after,
      outcome: {
        ok,
        error_class: ok ? undefined : (parsed.error_class ?? "unknown"),
        p:           clamp01(parsed.outcome_p ?? confidence),
      },
      delta:        diffScene(scene, scene_after),
      blast_radius: [],   // v0: not populated. Later predictors learn this.
      confidence,
      analogues:    [],   // v0: not populated. kNN predictor will fill this in.
      reasoning:    parsed.reasoning,
    };
  }

  private buildPrompt(scene: S, tool: T): string {
    const sceneText = this.formatScene(scene);
    return `You are a world model. Given a CURRENT SCENE (JSON) and a TOOL CALL, predict
what the scene will look like AFTER the tool runs.

Reason about the tool's intended effect on the scene fields. Predict only the
direct effect — do NOT invent unrelated changes. Output the FULL predicted
scene_after as JSON, with the same top-level shape as the input scene.

CURRENT SCENE:
${sceneText}

TOOL CALL:
${tool.name}(${JSON.stringify(tool.args)})

Respond with strict JSON only, exactly this shape:
{
  "scene_after": <full predicted next scene, same shape as CURRENT SCENE>,
  "ok":          <true if the tool would succeed, false otherwise>,
  "outcome_p":   <probability the tool succeeds, 0..1>,
  "error_class": <short string if ok=false, omit otherwise>,
  "confidence":  <how confident you are in scene_after, 0..1>,
  "reasoning":   <one sentence explaining what changed and why>
}

JSON only. No markdown fences. No prose outside the object.`;
  }
}

interface PredictionPayload<S> {
  scene_after: S;
  ok?:          boolean;
  outcome_p?:   number;
  error_class?: string;
  confidence?:  number;
  reasoning?:   string;
}

function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0;
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

function defaultFormatScene(scene: unknown): string {
  return JSON.stringify(scene, null, 2);
}
