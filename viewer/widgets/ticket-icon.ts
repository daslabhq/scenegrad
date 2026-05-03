/**
 * Icon-size Ticket widget — for the bulk viewer's grid.
 *
 * Designed to be ~140px wide × 100px tall — small enough to grid 6-10 across,
 * big enough to read the ID + subject + status pill.
 */

import type { Ticket } from "./ticket.js";

const STATUS_BG: Record<string, string> = {
  "new":              "border-slate-200 bg-slate-50",
  "investigating":    "border-blue-200 bg-blue-50",
  "auto-resolved":    "border-emerald-200 bg-emerald-50",
  "escalated-t2":     "border-amber-200 bg-amber-50",
  "escalated-vip":    "border-red-200 bg-red-50",
};

const STATUS_DOT: Record<string, string> = {
  "new":              "bg-slate-400",
  "investigating":    "bg-blue-500",
  "auto-resolved":    "bg-emerald-500",
  "escalated-t2":     "bg-amber-500",
  "escalated-vip":    "bg-red-500",
};

const STATUS_LABEL: Record<string, string> = {
  "new":              "new",
  "investigating":    "investigating",
  "auto-resolved":    "resolved",
  "escalated-t2":     "T2",
  "escalated-vip":    "VIP",
};

const TIER_DOT: Record<string, string> = {
  free:       "bg-slate-300",
  pro:        "bg-sky-400",
  enterprise: "bg-amber-400",
};

export function renderTicketIcon(t: Ticket, opts: { traceUrl?: string } = {}): string {
  const bg = STATUS_BG[t.status] ?? STATUS_BG["new"];
  const dot = STATUS_DOT[t.status] ?? STATUS_DOT["new"];
  const label = STATUS_LABEL[t.status] ?? t.status;
  const tier = t.enriched?.tier ? TIER_DOT[t.enriched.tier] : "bg-slate-200";

  const href = opts.traceUrl
    ? `<a href="${escapeHtml(opts.traceUrl)}" class="block hover:shadow-md transition-shadow no-underline">`
    : "<div>";
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

function escapeHtml(s: unknown): string {
  return String(s ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]!));
}
