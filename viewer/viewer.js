// widgets/ticket.ts
var STATUS_STYLE = {
  new: { bg: "bg-slate-100", text: "text-slate-700", dot: "bg-slate-400", label: "new" },
  investigating: { bg: "bg-blue-100", text: "text-blue-700", dot: "bg-blue-500", label: "investigating" },
  "auto-resolved": { bg: "bg-emerald-100", text: "text-emerald-700", dot: "bg-emerald-500", label: "auto-resolved" },
  "escalated-t2": { bg: "bg-amber-100", text: "text-amber-800", dot: "bg-amber-500", label: "escalated · T2" },
  "escalated-vip": { bg: "bg-red-100", text: "text-red-700", dot: "bg-red-500", label: "escalated · VIP" }
};
function isTicket(s) {
  if (!s || typeof s !== "object")
    return false;
  const t = s;
  return typeof t.id === "string" && typeof t.subject === "string" && typeof t.customer === "string" && typeof t.status === "string";
}
function renderTicket(t) {
  const style = STATUS_STYLE[t.status] ?? STATUS_STYLE["new"];
  const kbChip = t.kb_match ? `<span class="ml-2 inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-medium bg-violet-100 text-violet-700">
         <span class="mr-1">⚠</span>${escapeHtml(t.kb_match)}
       </span>` : "";
  const replyBlock = t.reply ? `<div class="mt-3 pt-3 border-t border-slate-100">
         <div class="text-[10px] uppercase tracking-wide text-slate-400 mb-1.5">reply</div>
         <div class="bg-slate-50 rounded-md p-3 text-sm leading-relaxed">
           ${formatReply(t.reply)}
         </div>
       </div>` : "";
  return `
    <article class="bg-white rounded-lg border border-slate-200 overflow-hidden">
      <header class="px-4 py-3 flex items-start justify-between gap-3 border-b border-slate-100">
        <div class="min-w-0">
          <div class="text-[11px] font-mono text-slate-400 uppercase tracking-wide">${escapeHtml(t.id)}</div>
          <div class="text-base font-semibold text-slate-900 truncate">${escapeHtml(t.subject)}</div>
        </div>
        <span class="shrink-0 inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold ${style.bg} ${style.text}">
          <span class="w-1.5 h-1.5 rounded-full ${style.dot} mr-1.5"></span>
          ${style.label}
        </span>
      </header>

      <div class="px-4 py-3 space-y-2">
        <div class="text-[11px] uppercase tracking-wide text-slate-400">customer</div>
        <div class="text-sm text-slate-700 font-medium">${escapeHtml(t.customer)}${kbChip}</div>

        <div class="text-[11px] uppercase tracking-wide text-slate-400 mt-3">issue</div>
        <div class="text-sm text-slate-600 italic leading-relaxed">"${escapeHtml(t.body)}"</div>

        ${replyBlock}
      </div>
    </article>
  `;
}
function formatReply(reply) {
  const m = reply.match(/^\s*\[(CRITICAL|HIGH|URGENT|WARNING)\]\s*(.*)$/s);
  if (m) {
    const [, tag, rest] = m;
    const tagColor = tag === "CRITICAL" ? "bg-red-600" : tag === "HIGH" || tag === "URGENT" ? "bg-amber-600" : "bg-slate-600";
    return `<span class="inline-block ${tagColor} text-white px-1.5 py-0.5 rounded text-[10px] font-bold tracking-wider mr-1.5">${tag}</span><span class="text-slate-800">${escapeHtml(rest)}</span>`;
  }
  return `<span class="text-slate-800">${escapeHtml(reply)}</span>`;
}
function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

// widgets/customer.ts
var TIER_STYLE = {
  free: { bg: "bg-slate-100", text: "text-slate-600", label: "FREE" },
  pro: { bg: "bg-sky-100", text: "text-sky-700", label: "PRO" },
  enterprise: { bg: "bg-amber-100", text: "text-amber-800", label: "ENTERPRISE" }
};
function renderCustomer(t) {
  if (!t.enriched) {
    return `
      <article class="bg-white rounded-lg border border-slate-200 border-dashed">
        <div class="px-4 py-6 text-center">
          <div class="text-[11px] uppercase tracking-wide text-slate-400 mb-2">customer</div>
          <div class="text-sm text-slate-400 italic">lookup pending</div>
          <div class="text-xs text-slate-300 mt-2">${escapeHtml2(t.customer)}</div>
        </div>
      </article>
    `;
  }
  const tier = TIER_STYLE[t.enriched.tier] ?? TIER_STYLE.free;
  const ltv = formatMoney(t.enriched.ltv_usd);
  const incidents = t.enriched.prior_incidents;
  const incidentColor = incidents >= 5 ? "text-red-600" : incidents >= 2 ? "text-amber-600" : "text-slate-500";
  return `
    <article class="bg-white rounded-lg border border-slate-200 overflow-hidden">
      <header class="px-4 py-3 border-b border-slate-100">
        <div class="text-[11px] uppercase tracking-wide text-slate-400">customer</div>
        <div class="flex items-center gap-2 mt-1">
          <div class="text-base font-semibold text-slate-900 truncate">${escapeHtml2(t.customer)}</div>
          <span class="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold tracking-wide ${tier.bg} ${tier.text}">
            ${tier.label}
          </span>
        </div>
      </header>

      <div class="px-4 py-3 space-y-2.5">
        <div class="flex items-baseline justify-between">
          <span class="text-[11px] text-slate-500">LTV</span>
          <span class="text-sm font-semibold text-slate-800 mono">${ltv}</span>
        </div>
        <div class="flex items-baseline justify-between">
          <span class="text-[11px] text-slate-500">prior incidents</span>
          <span class="text-sm font-semibold mono ${incidentColor}">${incidents}</span>
        </div>
      </div>
    </article>
  `;
}
function formatMoney(usd) {
  if (usd >= 1e6)
    return `$${(usd / 1e6).toFixed(usd >= 1e7 ? 0 : 1)}M`;
  if (usd >= 1000)
    return `$${(usd / 1000).toFixed(usd >= 1e5 ? 0 : 0)}k`;
  return `$${usd}`;
}
function escapeHtml2(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

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
  let pendingStep;
  for (const e of events) {
    const kind = e.attributes["scene.kind"];
    const key = e.attributes["scene.key"];
    if (kind === "intent") {
      currentIntent = e;
      continue;
    }
    if (kind === "actual" && key === "scene") {
      let scene;
      try {
        scene = JSON.parse(e.attributes["scene.value"]);
      } catch {}
      if (pendingStep)
        pendingStep.scene_after = scene;
      continue;
    }
    if (kind === "actual" && key === "distance") {
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
      pendingStep = {
        step_no: stepNo++,
        tool: intentPayload?.tool,
        predicted_delta: intentPayload?.predicted_delta,
        reasoning: intentPayload?.reasoning,
        d_before: Number(payload.d_before ?? 0),
        d_after: Number(payload.d_after ?? 0),
        delta: Number(payload.delta ?? 0),
        description: e.attributes["scene.description"],
        raw: { intent, actual: e }
      };
      steps.push(pendingStep);
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
      <div class="mono text-base font-semibold">${escapeHtml3(step.tool.name)}<span class="text-slate-400">(</span>${formatArgs(step.tool.args)}<span class="text-slate-400">)</span></div>
    `;
    intent.appendChild(row);
    if (step.reasoning) {
      const r = document.createElement("div");
      r.innerHTML = `
        <div class="text-sm text-slate-600 italic mt-3">"${escapeHtml3(step.reasoning)}"</div>
      `;
      intent.appendChild(r);
    }
  } else {
    intent.innerHTML = `<div class="text-slate-400 italic">no tool call at this step</div>`;
  }
  renderAssertionsPane(step);
  renderScenePane(i);
  $("raw-step").textContent = JSON.stringify(step, null, 2);
  $("scrubber").value = String(i);
}
function renderScenePane(stepIdx) {
  const pane = $("scene-pane");
  if (!current) {
    pane.innerHTML = "—";
    return;
  }
  const step = current.steps[stepIdx];
  const scene = step?.scene_after;
  if (!scene || typeof scene !== "object") {
    pane.innerHTML = `<div class="text-slate-400 italic">no scene snapshot at this step</div>`;
    return;
  }
  if (isTicket(scene)) {
    pane.innerHTML = `
      <div class="grid grid-cols-1 md:grid-cols-12 gap-3">
        <div class="md:col-span-8">${renderTicket(scene)}</div>
        <div class="md:col-span-4">${renderCustomer(scene)}</div>
      </div>
    `;
    return;
  }
  let prev;
  for (let i = stepIdx - 1;i >= 0; i--) {
    if (current.steps[i]?.scene_after) {
      prev = current.steps[i].scene_after;
      break;
    }
  }
  pane.innerHTML = `<div class="space-y-1 font-mono">${renderObjectDiff(scene, prev, 0)}</div>`;
}
var MAX_DEPTH = 4;
function renderObjectDiff(curr, prev, depth) {
  if (depth > MAX_DEPTH)
    return `<span class="text-slate-400">…</span>`;
  if (!curr || typeof curr !== "object")
    return formatLeaf(curr);
  if (Array.isArray(curr)) {
    if (curr.length === 0)
      return `<span class="text-slate-400">[]</span>`;
    const items = curr.slice(0, 6).map((v, i) => {
      const pv = Array.isArray(prev) ? prev[i] : undefined;
      const changed = JSON.stringify(v) !== JSON.stringify(pv);
      return `<div class="ml-4 ${changed ? "bg-emerald-100/70 rounded px-1" : ""}">${renderObjectDiff(v, pv, depth + 1)}</div>`;
    }).join("");
    const more = curr.length > 6 ? `<div class="ml-4 text-slate-400 text-xs">… ${curr.length - 6} more</div>` : "";
    return `<span class="text-slate-400">[</span>${items}${more}<span class="text-slate-400">]</span>`;
  }
  const keys = Object.keys(curr);
  if (keys.length === 0)
    return `<span class="text-slate-400">{}</span>`;
  const rows = keys.map((k) => {
    const v = curr[k];
    const pv = prev?.[k];
    const changed = JSON.stringify(v) !== JSON.stringify(pv);
    const label = `<span class="text-slate-500">${escapeHtml3(k)}:</span>`;
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
function formatLeaf(v) {
  if (v === undefined || v === null)
    return `<span class="text-slate-400">${v === null ? "null" : "undefined"}</span>`;
  if (typeof v === "boolean")
    return `<span class="text-violet-600">${v}</span>`;
  if (typeof v === "number")
    return `<span class="text-blue-700">${v}</span>`;
  if (typeof v === "string") {
    const truncated = v.length > 120 ? v.slice(0, 120) + "…" : v;
    return `<span class="text-emerald-700">"${escapeHtml3(truncated)}"</span>`;
  }
  return `<span>${escapeHtml3(String(v))}</span>`;
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
function escapeHtml3(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}
function formatArgs(args) {
  if (!args || Object.keys(args).length === 0)
    return "";
  const items = Object.entries(args).slice(0, 4).map(([k, v]) => `<span class="text-slate-400">${escapeHtml3(k)}</span>:${escapeHtml3(typeof v === "string" ? v : JSON.stringify(v)).slice(0, 60)}`);
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
