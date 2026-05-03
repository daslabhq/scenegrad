/**
 * Customer card — derived from a Ticket's customer + enriched fields.
 *
 * Lives locally in scenegrad/viewer/. Promote to scenecast as a canonical
 * `Account` type once we see the right shape across 2-3 demos.
 */

import type { Ticket } from "./ticket.js";

const TIER_STYLE: Record<string, { bg: string; text: string; label: string }> = {
  free:       { bg: "bg-slate-100",  text: "text-slate-600",  label: "FREE" },
  pro:        { bg: "bg-sky-100",    text: "text-sky-700",    label: "PRO" },
  enterprise: { bg: "bg-amber-100",  text: "text-amber-800",  label: "ENTERPRISE" },
};

export function renderCustomer(t: Ticket): string {
  if (!t.enriched) {
    return `
      <article class="bg-white rounded-lg border border-slate-200 border-dashed">
        <div class="px-4 py-6 text-center">
          <div class="text-[11px] uppercase tracking-wide text-slate-400 mb-2">customer</div>
          <div class="text-sm text-slate-400 italic">lookup pending</div>
          <div class="text-xs text-slate-300 mt-2">${escapeHtml(t.customer)}</div>
        </div>
      </article>
    `;
  }

  const tier = TIER_STYLE[t.enriched.tier] ?? TIER_STYLE.free!;
  const ltv = formatMoney(t.enriched.ltv_usd);
  const incidents = t.enriched.prior_incidents;
  const incidentColor = incidents >= 5 ? "text-red-600" : incidents >= 2 ? "text-amber-600" : "text-slate-500";

  return `
    <article class="bg-white rounded-lg border border-slate-200 overflow-hidden">
      <header class="px-4 py-3 border-b border-slate-100">
        <div class="text-[11px] uppercase tracking-wide text-slate-400">customer</div>
        <div class="flex items-center gap-2 mt-1">
          <div class="text-base font-semibold text-slate-900 truncate">${escapeHtml(t.customer)}</div>
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

function formatMoney(usd: number): string {
  if (usd >= 1_000_000) return `$${(usd / 1_000_000).toFixed(usd >= 10_000_000 ? 0 : 1)}M`;
  if (usd >= 1_000)     return `$${(usd / 1_000).toFixed(usd >= 100_000 ? 0 : 0)}k`;
  return `$${usd}`;
}

function escapeHtml(s: unknown): string {
  return String(s ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]!));
}
