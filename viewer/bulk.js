// widgets/ticket-icon.ts
var STATUS_BG = {
  new: "border-slate-200 bg-slate-50",
  investigating: "border-blue-200 bg-blue-50",
  "auto-resolved": "border-emerald-200 bg-emerald-50",
  "escalated-t2": "border-amber-200 bg-amber-50",
  "escalated-vip": "border-red-200 bg-red-50"
};
var STATUS_DOT = {
  new: "bg-slate-400",
  investigating: "bg-blue-500",
  "auto-resolved": "bg-emerald-500",
  "escalated-t2": "bg-amber-500",
  "escalated-vip": "bg-red-500"
};
var STATUS_LABEL = {
  new: "new",
  investigating: "investigating",
  "auto-resolved": "resolved",
  "escalated-t2": "T2",
  "escalated-vip": "VIP"
};
var TIER_DOT = {
  free: "bg-slate-300",
  pro: "bg-sky-400",
  enterprise: "bg-amber-400"
};
function renderTicketIcon(t, opts = {}) {
  const bg = STATUS_BG[t.status] ?? STATUS_BG["new"];
  const dot = STATUS_DOT[t.status] ?? STATUS_DOT["new"];
  const label = STATUS_LABEL[t.status] ?? t.status;
  const tier = t.enriched?.tier ? TIER_DOT[t.enriched.tier] : "bg-slate-200";
  const href = opts.traceUrl ? `<a href="${escapeHtml(opts.traceUrl)}" class="block hover:shadow-md transition-shadow no-underline">` : "<div>";
  const close = opts.traceUrl ? "</a>" : "</div>";
  return `
    ${href}
      <article class="ticket-icon rounded-lg border ${bg} px-3 py-2.5 cursor-pointer">
        <header class="flex items-center justify-between mb-1.5">
          <span class="text-[10px] font-mono text-slate-500 uppercase tracking-wide truncate">${escapeHtml(t.id)}</span>
          <span class="w-2 h-2 rounded-full ${tier}" title="tier: ${escapeHtml(t.enriched?.tier ?? "unknown")}"></span>
        </header>
        <div class="text-[12px] leading-tight font-medium text-slate-800 line-clamp-2 min-h-[2.2em] mb-2">
          ${escapeHtml(t.subject)}
        </div>
        <footer class="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide">
          <span class="w-1.5 h-1.5 rounded-full ${dot}"></span>
          <span class="text-slate-700">${escapeHtml(label)}</span>
        </footer>
      </article>
    ${close}
  `;
}
function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

// bulk.ts
var STATUS_ORDER = ["escalated-vip", "escalated-t2", "auto-resolved", "investigating", "new"];
var STATUS_BAR_COLOR = {
  "escalated-vip": "bg-red-500",
  "escalated-t2": "bg-amber-500",
  "auto-resolved": "bg-emerald-500",
  investigating: "bg-blue-500",
  new: "bg-slate-400"
};
var loaded = [];
var activeFilters = new Set;
var $ = (id) => document.getElementById(id);
async function loadSuite() {
  const params = new URLSearchParams(location.search);
  const manifestUrl = params.get("manifest") ?? "./example-traces/suite/manifest.json";
  const manifestRes = await fetch(manifestUrl);
  if (!manifestRes.ok) {
    $("grid").innerHTML = `<div class="col-span-full text-rose-500">failed to load manifest from ${escapeHtml2(manifestUrl)}</div>`;
    return;
  }
  const manifest = await manifestRes.json();
  const manifestBase = manifestUrl.replace(/[^/]*$/, "");
  loaded = await Promise.all(manifest.map(async (m) => {
    try {
      const traceUrl = m.file.startsWith("http") || m.file.startsWith("/") ? m.file : manifestBase + m.file;
      const res = await fetch(traceUrl);
      const text = await res.text();
      const span = JSON.parse(text.split(/\r?\n/).find((l) => l.trim()));
      const sceneEvents = (span.events ?? []).filter((e) => e.name === "scene.set" && e.attributes?.["scene.key"] === "scene" && e.attributes?.["scene.kind"] === "actual");
      const last = sceneEvents[sceneEvents.length - 1];
      const finalScene = last ? JSON.parse(last.attributes["scene.value"]) : undefined;
      return { manifest: m, finalScene };
    } catch (e) {
      return { manifest: m };
    }
  }));
  renderStats();
  renderFilters();
  renderGrid();
}
function renderStats() {
  const total = loaded.length;
  const byStatus = {};
  for (const t of loaded) {
    const s = t.manifest.final_status;
    byStatus[s] = (byStatus[s] ?? 0) + 1;
  }
  const totalCost = loaded.reduce((acc, t) => acc + (t.manifest.duration_ms ?? 0), 0);
  const avgSteps = total > 0 ? loaded.reduce((acc, t) => acc + t.manifest.steps, 0) / total : 0;
  const avgDuration = total > 0 ? totalCost / total : 0;
  const bars = STATUS_ORDER.filter((s) => byStatus[s]).map((s) => {
    const count = byStatus[s];
    const pct = total > 0 ? count / total * 100 : 0;
    return `
      <div class="flex items-center gap-3 text-sm py-1">
        <div class="flex items-center gap-2 w-44">
          <span class="w-2 h-2 rounded-full ${STATUS_BAR_COLOR[s] ?? "bg-slate-400"}"></span>
          <span class="text-slate-700">${escapeHtml2(s)}</span>
        </div>
        <div class="flex-1 bg-slate-100 rounded-full h-2 max-w-md">
          <div class="h-2 rounded-full ${STATUS_BAR_COLOR[s] ?? "bg-slate-400"}" style="width: ${pct}%"></div>
        </div>
        <span class="mono text-slate-700 w-8 text-right">${count}</span>
      </div>
    `;
  }).join("");
  $("stats-content").innerHTML = `
    <div class="flex items-baseline gap-6 mb-3">
      <div><span class="text-2xl font-semibold">${total}</span><span class="text-slate-500 text-sm ml-1">trajectories</span></div>
      <div class="text-sm text-slate-500">avg ${avgSteps.toFixed(1)} steps · ${(avgDuration / 1000).toFixed(1)}s each</div>
    </div>
    ${bars}
  `;
}
function renderFilters() {
  const seen = new Set;
  for (const t of loaded)
    seen.add(t.manifest.final_status);
  const ordered = STATUS_ORDER.filter((s) => seen.has(s));
  const chips = [
    `<button data-filter="" class="filter-chip px-3 py-1 rounded-full text-xs font-medium ${activeFilters.size === 0 ? "bg-slate-900 text-white" : "bg-white border border-slate-200 text-slate-700 hover:bg-slate-50"}">All</button>`,
    ...ordered.map((s) => {
      const active = activeFilters.has(s);
      const count = loaded.filter((t) => t.manifest.final_status === s).length;
      return `<button data-filter="${s}" class="filter-chip px-3 py-1 rounded-full text-xs font-medium ${active ? "bg-slate-900 text-white" : "bg-white border border-slate-200 text-slate-700 hover:bg-slate-50"}">
        <span class="inline-block w-1.5 h-1.5 rounded-full ${STATUS_BAR_COLOR[s] ?? "bg-slate-400"} mr-1.5 align-middle"></span>${escapeHtml2(s)} <span class="text-slate-400">${count}</span>
      </button>`;
    })
  ].join("");
  $("filter-chips").innerHTML = chips;
  for (const btn of document.querySelectorAll("[data-filter]")) {
    btn.addEventListener("click", () => {
      const f = btn.getAttribute("data-filter") ?? "";
      if (f === "")
        activeFilters.clear();
      else if (activeFilters.has(f))
        activeFilters.delete(f);
      else
        activeFilters.add(f);
      renderFilters();
      renderGrid();
    });
  }
}
function renderGrid() {
  const visible = loaded.filter((t) => activeFilters.size === 0 || activeFilters.has(t.manifest.final_status));
  if (visible.length === 0) {
    $("grid").innerHTML = `<div class="col-span-full text-slate-400 italic text-center py-12">no trajectories match the current filters</div>`;
    return;
  }
  const params = new URLSearchParams(location.search);
  const manifestUrl = params.get("manifest") ?? "./example-traces/suite/manifest.json";
  const manifestBase = manifestUrl.replace(/[^/]*$/, "");
  $("grid").innerHTML = visible.map((t) => {
    const scene = t.finalScene ?? buildFallbackTicket(t.manifest);
    const file = t.manifest.file.startsWith("http") || t.manifest.file.startsWith("/") ? t.manifest.file : manifestBase + t.manifest.file;
    const traceUrl = `./index.html?trace=${encodeURIComponent(file)}`;
    return renderTicketIcon(scene, { traceUrl });
  }).join("");
}
function buildFallbackTicket(m) {
  return {
    id: m.id,
    subject: m.subject,
    body: "",
    customer: m.customer,
    status: m.final_status
  };
}
function escapeHtml2(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}
document.addEventListener("DOMContentLoaded", () => {
  loadSuite().catch((e) => {
    console.error(e);
    $("grid").innerHTML = `<div class="col-span-full text-rose-500">error loading suite</div>`;
  });
});
