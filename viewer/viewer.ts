/**
 * scenegrad trajectory viewer.
 *
 * Loads a JSONL trajectory (one OTel-style span per line, scenegrad emits these).
 * Renders:
 *   - gap-closure curve over steps
 *   - scrubber to step-by-step replay
 *   - agent intent pane (chosen tool + reasoning + predicted_delta)
 *   - assertion ticker (which assertions hold at the current step)
 *   - SCENE pane via typed widgets (Ticket + Customer for support-shaped scenes)
 *     with JSON-tree fallback for arbitrary shapes
 */

import { isTicket, renderTicket, type Ticket } from "./widgets/ticket.js";
import { renderCustomer } from "./widgets/customer.js";

interface SceneSetEvent {
  name:     "scene.set";
  time_ns:  number;
  attributes: {
    "scene.key":          string;
    "scene.kind":         "intent" | "actual";
    "scene.value":        string;
    "scene.value.type"?:  string;
    "scene.value.size"?:  number;
    "scene.commit_hash"?: string;
    "scene.description"?: string;
  };
}

interface Span {
  trace_id:       string;
  span_id:        string;
  parent_span_id: string | null;
  name:           string;
  start_time_ns:  number;
  end_time_ns:    number;
  status?:        { code?: number };
  attributes?:    Record<string, any>;
  events?:        SceneSetEvent[];
}

interface ScenegradStep {
  step_no:           number;
  tool?:             { name: string; args: Record<string, any> };
  predicted_delta?:  number;
  reasoning?:        string;
  d_before:          number;
  d_after:           number;
  delta:             number;
  scene_after?:      any;
  description?:      string;
  raw:               { intent?: SceneSetEvent; actual?: SceneSetEvent };
}

interface Trajectory {
  span:        Span;
  steps:       ScenegradStep[];
  meta: {
    task_id?:    string;
    solver?:     string;
    model?:      string;
    success?:    boolean;
    steps:       number;
    d_initial:   number;
    d_final:     number;
    duration_ms?: number;
  };
}

// ---------------------------------------------------------------------------
// Parse JSONL → Trajectory
// ---------------------------------------------------------------------------

function parseJsonl(text: string): Trajectory | null {
  // First non-blank line is the span.
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const span = JSON.parse(trimmed) as Span;
      return spanToTrajectory(span);
    } catch (e) {
      console.error("parse error:", e);
      return null;
    }
  }
  return null;
}

function spanToTrajectory(span: Span): Trajectory {
  // Pair up scene.set events: each step has an optional intent + a distance + optional scene.
  const events = (span.events ?? []).filter(e => e.name === "scene.set");
  const steps: ScenegradStep[] = [];

  let currentIntent: SceneSetEvent | undefined;
  let stepNo = 0;
  let pendingStep: ScenegradStep | undefined;

  for (const e of events) {
    const kind = e.attributes["scene.kind"];
    const key  = e.attributes["scene.key"];

    if (kind === "intent") {
      currentIntent = e;
      continue;
    }

    if (kind === "actual" && key === "scene") {
      // Scene snapshot — attach to the most recent step.
      let scene: any;
      try { scene = JSON.parse(e.attributes["scene.value"]); } catch {}
      if (pendingStep) pendingStep.scene_after = scene;
      continue;
    }

    if (kind === "actual" && key === "distance") {
      // Distance event closes a step.
      let payload: any = {};
      try { payload = JSON.parse(e.attributes["scene.value"]); } catch {}
      const intent = currentIntent;
      let intentPayload: any = {};
      try { if (intent) intentPayload = JSON.parse(intent.attributes["scene.value"]); } catch {}

      pendingStep = {
        step_no:         stepNo++,
        tool:            intentPayload?.tool,
        predicted_delta: intentPayload?.predicted_delta,
        reasoning:       intentPayload?.reasoning,
        d_before:        Number(payload.d_before ?? 0),
        d_after:         Number(payload.d_after ?? 0),
        delta:           Number(payload.delta ?? 0),
        description:     e.attributes["scene.description"],
        raw:             { intent, actual: e },
      };
      steps.push(pendingStep);
      currentIntent = undefined;
    }
  }

  const a = span.attributes ?? {};
  const trajectory: Trajectory = {
    span, steps,
    meta: {
      task_id:     a["bench.task_id"],
      solver:      a["bench.solver"],
      model:       a["bench.model"],
      success:     a["bench.success"],
      steps:       a["bench.steps"] ?? steps.length,
      d_initial:   a["bench.d_initial"] ?? steps[0]?.d_before ?? 0,
      d_final:     a["bench.d_final"]   ?? steps[steps.length - 1]?.d_after ?? 0,
      duration_ms: a["bench.duration_ms"],
    },
  };
  return trajectory;
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

let current: Trajectory | null = null;
let currentStep = 0;

function $<T extends HTMLElement = HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

function renderTrajectory(t: Trajectory) {
  current = t;
  currentStep = 0;

  $("loader").classList.add("hidden");
  $("viewer").classList.remove("hidden");

  // Meta
  $("trace-name").textContent     = t.span.name ?? t.meta.task_id ?? "(untitled)";
  $("meta-model").textContent     = t.meta.model ?? t.meta.solver ?? "—";
  $("meta-steps").textContent     = String(t.meta.steps);
  $("meta-duration").textContent  = t.meta.duration_ms != null ? `${t.meta.duration_ms}ms` : "—";
  const successEl = $("meta-success");
  successEl.textContent = t.meta.success === true ? "✓ solved" : t.meta.success === false ? "✗ unsolved" : "—";
  successEl.className = "font-semibold " + (t.meta.success ? "text-green-600" : t.meta.success === false ? "text-rose-600" : "text-slate-500");

  // Scrubber
  const scrubber = $("scrubber") as HTMLInputElement;
  scrubber.min = "0";
  scrubber.max = String(Math.max(0, t.steps.length - 1));
  scrubber.value = "0";
  $("step-total").textContent = String(t.steps.length);

  // Step markers under scrubber
  const markers = $("step-markers");
  markers.innerHTML = "";
  for (let i = 0; i < t.steps.length; i++) {
    const m = document.createElement("div");
    m.className = "step-marker flex-1 h-1 rounded-sm";
    const step = t.steps[i]!;
    const drift = step.predicted_delta !== undefined && Math.abs(step.predicted_delta - step.delta) > 0.5;
    m.style.background = drift ? "#fb923c" : step.delta > 0 ? "#22c55e" : step.delta < 0 ? "#ef4444" : "#cbd5e1";
    m.title = `step ${i}${drift ? " (drift)" : ""}`;
    markers.appendChild(m);
  }

  // Gap curve
  renderGapCurve(t);

  // Initial step
  renderStep(0);
}

function renderGapCurve(t: Trajectory) {
  const svg = $("gap-curve");
  while (svg.firstChild) svg.removeChild(svg.firstChild);

  const w = svg.clientWidth || 800;
  const h = 80;
  const pad = 6;

  const dValues = [t.meta.d_initial, ...t.steps.map(s => s.d_after)];
  const max = Math.max(1, ...dValues);
  const stepX = (i: number) => pad + (i / Math.max(1, dValues.length - 1)) * (w - 2 * pad);
  const stepY = (d: number) => pad + (1 - d / max) * (h - 2 * pad);

  // Bg grid
  const grid = document.createElementNS("http://www.w3.org/2000/svg", "line");
  grid.setAttribute("x1", String(pad));
  grid.setAttribute("y1", String(h - pad));
  grid.setAttribute("x2", String(w - pad));
  grid.setAttribute("y2", String(h - pad));
  grid.setAttribute("stroke", "#e2e8f0");
  grid.setAttribute("stroke-width", "1");
  svg.appendChild(grid);

  // Actual gap curve
  const path = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
  const points = dValues.map((d, i) => `${stepX(i)},${stepY(d)}`).join(" ");
  path.setAttribute("points", points);
  path.setAttribute("fill", "none");
  path.setAttribute("stroke", "#6366f1");
  path.setAttribute("stroke-width", "2");
  path.setAttribute("stroke-linecap", "round");
  path.setAttribute("stroke-linejoin", "round");
  svg.appendChild(path);

  // (predicted-delta drift line removed — observer mode doesn't force agents
  //  to predict closure. Drift signals come from gap-not-closed and
  //  goal-claimed-but-unmet, which the assertion ticker surfaces.)

  // Endpoint dots
  for (let i = 0; i < dValues.length; i++) {
    const c = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    c.setAttribute("cx", String(stepX(i)));
    c.setAttribute("cy", String(stepY(dValues[i]!)));
    c.setAttribute("r", "3");
    c.setAttribute("fill", "#6366f1");
    svg.appendChild(c);
  }

  // Labels
  const lblStart = document.createElementNS("http://www.w3.org/2000/svg", "text");
  lblStart.setAttribute("x", String(pad));
  lblStart.setAttribute("y", String(stepY(t.meta.d_initial) - 8));
  lblStart.setAttribute("font-size", "10");
  lblStart.setAttribute("fill", "#64748b");
  lblStart.textContent = `${t.meta.d_initial}`;
  svg.appendChild(lblStart);

  const lblEnd = document.createElementNS("http://www.w3.org/2000/svg", "text");
  lblEnd.setAttribute("x", String(stepX(dValues.length - 1) - 14));
  lblEnd.setAttribute("y", String(stepY(t.meta.d_final) - 8));
  lblEnd.setAttribute("font-size", "10");
  lblEnd.setAttribute("fill", "#64748b");
  lblEnd.textContent = `${t.meta.d_final}`;
  svg.appendChild(lblEnd);
}

function renderStep(i: number) {
  if (!current) return;
  currentStep = i;
  const step = current.steps[i];
  if (!step) return;

  $("step-current").textContent  = String(i);
  $("step-tool").textContent     = step.tool ? `${step.tool.name}${step.tool.args && Object.keys(step.tool.args).length ? "(...)" : "()"}` : "(none)";
  $("step-d-before").textContent = String(step.d_before);
  $("step-d-after").textContent  = String(step.d_after);
  $("step-delta").textContent    = (step.delta >= 0 ? "+" : "") + step.delta;

  const deltaEl = $("step-delta");
  deltaEl.className = "mono font-semibold " + (step.delta > 0 ? "text-green-600" : step.delta < 0 ? "text-rose-600" : "text-slate-500");

  // Action pane
  const intent = $("intent-pane");
  intent.innerHTML = "";
  if (step.tool) {
    const row = document.createElement("div");
    row.innerHTML = `
      <div class="mono text-base font-semibold">${escapeHtml(step.tool.name)}<span class="text-slate-400">(</span>${formatArgs(step.tool.args)}<span class="text-slate-400">)</span></div>
    `;
    intent.appendChild(row);

    if (step.reasoning) {
      const r = document.createElement("div");
      r.innerHTML = `
        <div class="text-sm text-slate-600 italic mt-3">"${escapeHtml(step.reasoning)}"</div>
      `;
      intent.appendChild(r);
    }
  } else {
    intent.innerHTML = `<div class="text-slate-400 italic">no tool call at this step</div>`;
  }

  // Assertions pane (we approximate from gap deltas — full assertion list
  // requires explicit assertion-state events, which scenegrad emits but
  // current fixtures don't always include).
  renderAssertionsPane(step);

  // Scene pane — the world after this step, with diff vs previous step
  renderScenePane(i);

  // Raw JSON
  $("raw-step").textContent = JSON.stringify(step, null, 2);

  // Scrubber sync
  ($("scrubber") as HTMLInputElement).value = String(i);
}

function renderScenePane(stepIdx: number) {
  const pane = $("scene-pane");
  if (!current) { pane.innerHTML = "—"; return; }
  const step = current.steps[stepIdx];
  const scene = step?.scene_after;
  if (!scene || typeof scene !== "object") {
    pane.innerHTML = `<div class="text-slate-400 italic">no scene snapshot at this step</div>`;
    return;
  }

  // Typed-widget dispatch — pretty rendering for known shapes.
  if (isTicket(scene)) {
    pane.innerHTML = `
      <div class="grid grid-cols-1 md:grid-cols-12 gap-3">
        <div class="md:col-span-8">${renderTicket(scene as Ticket)}</div>
        <div class="md:col-span-4">${renderCustomer(scene as Ticket)}</div>
      </div>
    `;
    return;
  }

  // Fallback: generic JSON tree with field-change highlighting.
  let prev: any;
  for (let i = stepIdx - 1; i >= 0; i--) {
    if (current.steps[i]?.scene_after) { prev = current.steps[i]!.scene_after; break; }
  }
  pane.innerHTML = `<div class="space-y-1 font-mono">${renderObjectDiff(scene, prev, 0)}</div>`;
}

const MAX_DEPTH = 4;

function renderObjectDiff(curr: any, prev: any, depth: number): string {
  if (depth > MAX_DEPTH) return `<span class="text-slate-400">…</span>`;
  if (!curr || typeof curr !== "object") return formatLeaf(curr);
  if (Array.isArray(curr)) {
    if (curr.length === 0) return `<span class="text-slate-400">[]</span>`;
    const items = curr.slice(0, 6).map((v, i) => {
      const pv = Array.isArray(prev) ? prev[i] : undefined;
      const changed = JSON.stringify(v) !== JSON.stringify(pv);
      return `<div class="ml-4 ${changed ? "bg-emerald-100/70 rounded px-1" : ""}">${renderObjectDiff(v, pv, depth + 1)}</div>`;
    }).join("");
    const more = curr.length > 6 ? `<div class="ml-4 text-slate-400 text-xs">… ${curr.length - 6} more</div>` : "";
    return `<span class="text-slate-400">[</span>${items}${more}<span class="text-slate-400">]</span>`;
  }
  // Object
  const keys = Object.keys(curr);
  if (keys.length === 0) return `<span class="text-slate-400">{}</span>`;
  const rows = keys.map(k => {
    const v = curr[k];
    const pv = prev?.[k];
    const changed = JSON.stringify(v) !== JSON.stringify(pv);
    const label = `<span class="text-slate-500">${escapeHtml(k)}:</span>`;
    if (v && typeof v === "object" && !Array.isArray(v) && Object.keys(v).length === 0) {
      return `<div class="${changed ? "bg-emerald-100/70 rounded px-1" : ""}">${label} <span class="text-slate-400">{}</span></div>`;
    }
    if (Array.isArray(v) && v.length === 0) {
      return `<div class="${changed ? "bg-emerald-100/70 rounded px-1" : ""}">${label} <span class="text-slate-400">[]</span></div>`;
    }
    if (v && typeof v === "object") {
      return `<div class="${changed ? "bg-emerald-100/70 rounded px-1" : ""}">${label}<div class="ml-3">${renderObjectDiff(v, pv, depth + 1)}</div></div>`;
    }
    return `<div class="${changed ? "bg-emerald-100/70 rounded px-1" : ""}">${label} ${formatLeaf(v)}</div>`;
  }).join("");
  return rows;
}

function formatLeaf(v: any): string {
  if (v === undefined || v === null) return `<span class="text-slate-400">${v === null ? "null" : "undefined"}</span>`;
  if (typeof v === "boolean") return `<span class="text-violet-600">${v}</span>`;
  if (typeof v === "number")  return `<span class="text-blue-700">${v}</span>`;
  if (typeof v === "string") {
    const truncated = v.length > 120 ? v.slice(0, 120) + "…" : v;
    return `<span class="text-emerald-700">"${escapeHtml(truncated)}"</span>`;
  }
  return `<span>${escapeHtml(String(v))}</span>`;
}

function renderAssertionsPane(_step: ScenegradStep) {
  const pane = $("assertions-pane");
  if (!current) { pane.innerHTML = "—"; return; }

  // Aggregate per-assertion state from trajectory if assertions_after available.
  // Fallback: show overall gap closing.
  const final_step = current.steps[current.steps.length - 1];
  const final_d = current.meta.d_final;
  const cur_step = current.steps[currentStep];

  pane.innerHTML = `
    <div class="flex items-center justify-between border-b pb-2 mb-1">
      <span class="text-slate-500">total gap</span>
      <span class="mono font-semibold">${cur_step?.d_after ?? final_d}</span>
    </div>
    <div class="flex items-center justify-between">
      <span class="text-slate-500">initial</span>
      <span class="mono">${current.meta.d_initial}</span>
    </div>
    <div class="flex items-center justify-between">
      <span class="text-slate-500">final</span>
      <span class="mono">${current.meta.d_final}</span>
    </div>
    <div class="flex items-center justify-between">
      <span class="text-slate-500">closure</span>
      <span class="mono ${current.meta.d_final === 0 ? "text-green-600 font-semibold" : "text-slate-700"}">
        ${current.meta.d_initial > 0 ? Math.round((1 - current.meta.d_final / current.meta.d_initial) * 100) : 100}%
      </span>
    </div>
    <div class="mt-3 pt-2 border-t text-[11px] text-slate-400">
      assertion-level state will appear here when fixtures emit per-assertion events.
    </div>
  `;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function escapeHtml(s: any): string {
  return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

function formatArgs(args: any): string {
  if (!args || Object.keys(args).length === 0) return "";
  const items = Object.entries(args).slice(0, 4)
    .map(([k, v]) => `<span class="text-slate-400">${escapeHtml(k)}</span>:${escapeHtml(typeof v === "string" ? v : JSON.stringify(v)).slice(0, 60)}`);
  return items.join(", ");
}

// ---------------------------------------------------------------------------
// Loaders
// ---------------------------------------------------------------------------

async function loadFromUrl(url: string) {
  const res = await fetch(url);
  const text = await res.text();
  const t = parseJsonl(text);
  if (t) renderTrajectory(t);
  else alert("Failed to parse JSONL.");
}

function loadFromFile(file: File) {
  const reader = new FileReader();
  reader.onload = () => {
    const t = parseJsonl(String(reader.result));
    if (t) renderTrajectory(t);
    else alert("Failed to parse JSONL.");
  };
  reader.readAsText(file);
}

// ---------------------------------------------------------------------------
// Wire UI
// ---------------------------------------------------------------------------

document.addEventListener("DOMContentLoaded", () => {
  const picker = $("example-picker") as HTMLSelectElement;
  picker.addEventListener("change", () => {
    if (picker.value) loadFromUrl(picker.value);
  });

  const fileInput = $("file-input") as HTMLInputElement;
  fileInput.addEventListener("change", () => {
    const f = fileInput.files?.[0];
    if (f) loadFromFile(f);
  });

  const scrubber = $("scrubber") as HTMLInputElement;
  scrubber.addEventListener("input", () => renderStep(parseInt(scrubber.value, 10) || 0));

  $("reset-btn").addEventListener("click", () => {
    current = null;
    $("viewer").classList.add("hidden");
    $("loader").classList.remove("hidden");
    picker.value = "";
  });

  // Drag-drop anywhere
  document.addEventListener("dragover", (e) => { e.preventDefault(); });
  document.addEventListener("drop", (e) => {
    e.preventDefault();
    const f = e.dataTransfer?.files?.[0];
    if (f) loadFromFile(f);
  });

  // Allow ?trace=URL deep links
  const params = new URLSearchParams(location.search);
  const t = params.get("trace");
  if (t) loadFromUrl(t);
});
