// viewer.ts
function parseJsonl(text) {
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed)
      continue;
    try {
      const span = JSON.parse(trimmed);
      return spanToTrajectory(span);
    } catch (e) {
      console.error("parse error:", e);
      return null;
    }
  }
  return null;
}
function spanToTrajectory(span) {
  const events = (span.events ?? []).filter((e) => e.name === "scene.set");
  const steps = [];
  let currentIntent;
  let stepNo = 0;
  for (const e of events) {
    const kind = e.attributes["scene.kind"];
    if (kind === "intent") {
      currentIntent = e;
    } else if (kind === "actual" && e.attributes["scene.key"] === "distance") {
      let payload = {};
      try {
        payload = JSON.parse(e.attributes["scene.value"]);
      } catch {}
      const intent = currentIntent;
      let intentPayload = {};
      try {
        if (intent)
          intentPayload = JSON.parse(intent.attributes["scene.value"]);
      } catch {}
      steps.push({
        step_no: stepNo++,
        tool: intentPayload?.tool,
        predicted_delta: intentPayload?.predicted_delta,
        reasoning: intentPayload?.reasoning,
        d_before: Number(payload.d_before ?? 0),
        d_after: Number(payload.d_after ?? 0),
        delta: Number(payload.delta ?? 0),
        description: e.attributes["scene.description"],
        raw: { intent, actual: e }
      });
      currentIntent = undefined;
    }
  }
  const a = span.attributes ?? {};
  const trajectory = {
    span,
    steps,
    meta: {
      task_id: a["bench.task_id"],
      solver: a["bench.solver"],
      model: a["bench.model"],
      success: a["bench.success"],
      steps: a["bench.steps"] ?? steps.length,
      d_initial: a["bench.d_initial"] ?? steps[0]?.d_before ?? 0,
      d_final: a["bench.d_final"] ?? steps[steps.length - 1]?.d_after ?? 0,
      duration_ms: a["bench.duration_ms"]
    }
  };
  return trajectory;
}
var current = null;
var currentStep = 0;
function $(id) {
  return document.getElementById(id);
}
function renderTrajectory(t) {
  current = t;
  currentStep = 0;
  $("loader").classList.add("hidden");
  $("viewer").classList.remove("hidden");
  $("trace-name").textContent = t.span.name ?? t.meta.task_id ?? "(untitled)";
  $("meta-model").textContent = t.meta.model ?? t.meta.solver ?? "—";
  $("meta-steps").textContent = String(t.meta.steps);
  $("meta-duration").textContent = t.meta.duration_ms != null ? `${t.meta.duration_ms}ms` : "—";
  const successEl = $("meta-success");
  successEl.textContent = t.meta.success === true ? "✓ solved" : t.meta.success === false ? "✗ unsolved" : "—";
  successEl.className = "font-semibold " + (t.meta.success ? "text-green-600" : t.meta.success === false ? "text-rose-600" : "text-slate-500");
  const scrubber = $("scrubber");
  scrubber.min = "0";
  scrubber.max = String(Math.max(0, t.steps.length - 1));
  scrubber.value = "0";
  $("step-total").textContent = String(t.steps.length);
  const markers = $("step-markers");
  markers.innerHTML = "";
  for (let i = 0;i < t.steps.length; i++) {
    const m = document.createElement("div");
    m.className = "step-marker flex-1 h-1 rounded-sm";
    const step = t.steps[i];
    const drift = step.predicted_delta !== undefined && Math.abs(step.predicted_delta - step.delta) > 0.5;
    m.style.background = drift ? "#fb923c" : step.delta > 0 ? "#22c55e" : step.delta < 0 ? "#ef4444" : "#cbd5e1";
    m.title = `step ${i}${drift ? " (drift)" : ""}`;
    markers.appendChild(m);
  }
  renderGapCurve(t);
  renderStep(0);
}
function renderGapCurve(t) {
  const svg = $("gap-curve");
  while (svg.firstChild)
    svg.removeChild(svg.firstChild);
  const w = svg.clientWidth || 800;
  const h = 80;
  const pad = 6;
  const dValues = [t.meta.d_initial, ...t.steps.map((s) => s.d_after)];
  const max = Math.max(1, ...dValues);
  const stepX = (i) => pad + i / Math.max(1, dValues.length - 1) * (w - 2 * pad);
  const stepY = (d) => pad + (1 - d / max) * (h - 2 * pad);
  const grid = document.createElementNS("http://www.w3.org/2000/svg", "line");
  grid.setAttribute("x1", String(pad));
  grid.setAttribute("y1", String(h - pad));
  grid.setAttribute("x2", String(w - pad));
  grid.setAttribute("y2", String(h - pad));
  grid.setAttribute("stroke", "#e2e8f0");
  grid.setAttribute("stroke-width", "1");
  svg.appendChild(grid);
  const path = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
  const points = dValues.map((d, i) => `${stepX(i)},${stepY(d)}`).join(" ");
  path.setAttribute("points", points);
  path.setAttribute("fill", "none");
  path.setAttribute("stroke", "#6366f1");
  path.setAttribute("stroke-width", "2");
  path.setAttribute("stroke-linecap", "round");
  path.setAttribute("stroke-linejoin", "round");
  svg.appendChild(path);
  for (let i = 0;i < dValues.length; i++) {
    const c = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    c.setAttribute("cx", String(stepX(i)));
    c.setAttribute("cy", String(stepY(dValues[i])));
    c.setAttribute("r", "3");
    c.setAttribute("fill", "#6366f1");
    svg.appendChild(c);
  }
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
function renderStep(i) {
  if (!current)
    return;
  currentStep = i;
  const step = current.steps[i];
  if (!step)
    return;
  $("step-current").textContent = String(i);
  $("step-tool").textContent = step.tool ? `${step.tool.name}${step.tool.args && Object.keys(step.tool.args).length ? "(...)" : "()"}` : "(none)";
  $("step-d-before").textContent = String(step.d_before);
  $("step-d-after").textContent = String(step.d_after);
  $("step-delta").textContent = (step.delta >= 0 ? "+" : "") + step.delta;
  const deltaEl = $("step-delta");
  deltaEl.className = "mono font-semibold " + (step.delta > 0 ? "text-green-600" : step.delta < 0 ? "text-rose-600" : "text-slate-500");
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
  renderAssertionsPane(step);
  $("raw-step").textContent = JSON.stringify(step, null, 2);
  $("scrubber").value = String(i);
}
function renderAssertionsPane(_step) {
  const pane = $("assertions-pane");
  if (!current) {
    pane.innerHTML = "—";
    return;
  }
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
function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}
function formatArgs(args) {
  if (!args || Object.keys(args).length === 0)
    return "";
  const items = Object.entries(args).slice(0, 4).map(([k, v]) => `<span class="text-slate-400">${escapeHtml(k)}</span>:${escapeHtml(typeof v === "string" ? v : JSON.stringify(v)).slice(0, 60)}`);
  return items.join(", ");
}
async function loadFromUrl(url) {
  const res = await fetch(url);
  const text = await res.text();
  const t = parseJsonl(text);
  if (t)
    renderTrajectory(t);
  else
    alert("Failed to parse JSONL.");
}
function loadFromFile(file) {
  const reader = new FileReader;
  reader.onload = () => {
    const t = parseJsonl(String(reader.result));
    if (t)
      renderTrajectory(t);
    else
      alert("Failed to parse JSONL.");
  };
  reader.readAsText(file);
}
document.addEventListener("DOMContentLoaded", () => {
  const picker = $("example-picker");
  picker.addEventListener("change", () => {
    if (picker.value)
      loadFromUrl(picker.value);
  });
  const fileInput = $("file-input");
  fileInput.addEventListener("change", () => {
    const f = fileInput.files?.[0];
    if (f)
      loadFromFile(f);
  });
  const scrubber = $("scrubber");
  scrubber.addEventListener("input", () => renderStep(parseInt(scrubber.value, 10) || 0));
  $("reset-btn").addEventListener("click", () => {
    current = null;
    $("viewer").classList.add("hidden");
    $("loader").classList.remove("hidden");
    picker.value = "";
  });
  document.addEventListener("dragover", (e) => {
    e.preventDefault();
  });
  document.addEventListener("drop", (e) => {
    e.preventDefault();
    const f = e.dataTransfer?.files?.[0];
    if (f)
      loadFromFile(f);
  });
  const params = new URLSearchParams(location.search);
  const t = params.get("trace");
  if (t)
    loadFromUrl(t);
});
