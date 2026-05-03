/**
 * Bulk viewer — see N trajectories at a glance, click to drill into one.
 *
 * Loads `example-traces/suite/manifest.json`, fetches each JSONL,
 * extracts the final scene state, renders as an icon-size Ticket grid.
 * Filter chips by status; aggregate distribution panel at the top.
 */

import { renderTicketIcon } from "./widgets/ticket-icon.js";
import type { Ticket } from "./widgets/ticket.js";

interface ManifestEntry {
  file:           string;
  id:             string;
  subject:        string;
  customer:       string;
  final_status:   string;
  success:        boolean;
  steps:          number;
  duration_ms:    number;
  model:          string;
}

interface LoadedTrace {
  manifest:    ManifestEntry;
  finalScene?: Ticket;
}

const STATUS_ORDER = ["escalated-vip", "escalated-t2", "auto-resolved", "investigating", "new"];

const STATUS_BAR_COLOR: Record<string, string> = {
  "escalated-vip":  "bg-red-500",
  "escalated-t2":   "bg-amber-500",
  "auto-resolved":  "bg-emerald-500",
  "investigating":  "bg-blue-500",
  "new":            "bg-slate-400",
};

let loaded: LoadedTrace[] = [];
let activeFilters = new Set<string>();

const $ = (id: string) => document.getElementById(id)!;

async function loadSuite() {
  const manifestRes = await fetch("./example-traces/suite/manifest.json");
  if (!manifestRes.ok) {
    $("grid").innerHTML = `<div class="col-span-full text-rose-500">failed to load manifest</div>`;
    return;
  }
  const manifest: ManifestEntry[] = await manifestRes.json();

  // Fetch each JSONL, extract the final scene.
  loaded = await Promise.all(manifest.map(async (m) => {
    try {
      const res = await fetch(`./example-traces/suite/${m.file}`);
      const text = await res.text();
      const span = JSON.parse(text.split(/\r?\n/).find(l => l.trim())!);
      // Final scene = last scene event in the span's events.
      const sceneEvents = (span.events ?? []).filter((e: any) =>
        e.name === "scene.set"
        && e.attributes?.["scene.key"] === "scene"
        && e.attributes?.["scene.kind"] === "actual");
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
  const byStatus: Record<string, number> = {};
  for (const t of loaded) {
    const s = t.manifest.final_status;
    byStatus[s] = (byStatus[s] ?? 0) + 1;
  }
  const totalCost = loaded.reduce((acc, t) => acc + (t.manifest.duration_ms ?? 0), 0);
  const avgSteps = total > 0 ? loaded.reduce((acc, t) => acc + t.manifest.steps, 0) / total : 0;
  const avgDuration = total > 0 ? totalCost / total : 0;

  const bars = STATUS_ORDER.filter(s => byStatus[s]).map(s => {
    const count = byStatus[s];
    const pct = total > 0 ? (count / total) * 100 : 0;
    return `
      <div class="flex items-center gap-3 text-sm py-1">
        <div class="flex items-center gap-2 w-44">
          <span class="w-2 h-2 rounded-full ${STATUS_BAR_COLOR[s] ?? "bg-slate-400"}"></span>
          <span class="text-slate-700">${escapeHtml(s)}</span>
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
      <div class="text-sm text-slate-500">avg ${avgSteps.toFixed(1)} steps · ${(avgDuration/1000).toFixed(1)}s each</div>
    </div>
    ${bars}
  `;
}

function renderFilters() {
  const seen = new Set<string>();
  for (const t of loaded) seen.add(t.manifest.final_status);
  const ordered = STATUS_ORDER.filter(s => seen.has(s));

  const chips = [
    `<button data-filter="" class="filter-chip px-3 py-1 rounded-full text-xs font-medium ${activeFilters.size === 0 ? "bg-slate-900 text-white" : "bg-white border border-slate-200 text-slate-700 hover:bg-slate-50"}">All</button>`,
    ...ordered.map(s => {
      const active = activeFilters.has(s);
      const count = loaded.filter(t => t.manifest.final_status === s).length;
      return `<button data-filter="${s}" class="filter-chip px-3 py-1 rounded-full text-xs font-medium ${active ? "bg-slate-900 text-white" : "bg-white border border-slate-200 text-slate-700 hover:bg-slate-50"}">
        <span class="inline-block w-1.5 h-1.5 rounded-full ${STATUS_BAR_COLOR[s] ?? "bg-slate-400"} mr-1.5 align-middle"></span>${escapeHtml(s)} <span class="text-slate-400">${count}</span>
      </button>`;
    }),
  ].join("");

  $("filter-chips").innerHTML = chips;

  for (const btn of document.querySelectorAll("[data-filter]")) {
    btn.addEventListener("click", () => {
      const f = btn.getAttribute("data-filter") ?? "";
      if (f === "") activeFilters.clear();
      else if (activeFilters.has(f)) activeFilters.delete(f);
      else activeFilters.add(f);
      renderFilters();
      renderGrid();
    });
  }
}

function renderGrid() {
  const visible = loaded.filter(t =>
    activeFilters.size === 0 || activeFilters.has(t.manifest.final_status));

  if (visible.length === 0) {
    $("grid").innerHTML = `<div class="col-span-full text-slate-400 italic text-center py-12">no trajectories match the current filters</div>`;
    return;
  }

  $("grid").innerHTML = visible.map(t => {
    const scene = t.finalScene ?? buildFallbackTicket(t.manifest);
    const traceUrl = `./index.html?trace=${encodeURIComponent(`./example-traces/suite/${t.manifest.file}`)}`;
    return renderTicketIcon(scene, { traceUrl });
  }).join("");
}

function buildFallbackTicket(m: ManifestEntry): Ticket {
  return {
    id: m.id,
    subject: m.subject,
    body: "",
    customer: m.customer,
    status: m.final_status as any,
  };
}

function escapeHtml(s: unknown): string {
  return String(s ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]!));
}

document.addEventListener("DOMContentLoaded", () => {
  loadSuite().catch(e => {
    console.error(e);
    $("grid").innerHTML = `<div class="col-span-full text-rose-500">error loading suite</div>`;
  });
});
