/**
 * Ticket widget — renders a support-ticket-shaped scene.
 *
 * Shape:
 *   { id, subject, body, customer, status, enriched?, kb_match?, reply? }
 *
 * Designed to live in scenecast as the seventh canonical type; lives in
 * scenegrad's viewer for now to avoid touching scenecast during its
 * rename. Promote when stable.
 */

export type TicketStatus =
  | "new"
  | "investigating"
  | "auto-resolved"
  | "escalated-t2"
  | "escalated-vip";

export interface Ticket {
  id:        string;
  subject:   string;
  body:      string;
  customer:  string;
  status:    TicketStatus;
  enriched?: { tier: "free" | "pro" | "enterprise"; ltv_usd: number; prior_incidents: number };
  kb_match?: string;
  reply?:    string;
}

const STATUS_STYLE: Record<TicketStatus, { bg: string; text: string; dot: string; label: string }> = {
  "new":              { bg: "bg-slate-100",   text: "text-slate-700",   dot: "bg-slate-400",   label: "new" },
  "investigating":    { bg: "bg-blue-100",    text: "text-blue-700",    dot: "bg-blue-500",    label: "investigating" },
  "auto-resolved":    { bg: "bg-emerald-100", text: "text-emerald-700", dot: "bg-emerald-500", label: "auto-resolved" },
  "escalated-t2":     { bg: "bg-amber-100",   text: "text-amber-800",   dot: "bg-amber-500",   label: "escalated · T2" },
  "escalated-vip":    { bg: "bg-red-100",     text: "text-red-700",     dot: "bg-red-500",     label: "escalated · VIP" },
};

export function isTicket(s: unknown): s is Ticket {
  if (!s || typeof s !== "object") return false;
  const t = s as Record<string, unknown>;
  return typeof t.id === "string"
      && typeof t.subject === "string"
      && typeof t.customer === "string"
      && typeof t.status === "string";
}

export function renderTicket(t: Ticket): string {
  const style = STATUS_STYLE[t.status] ?? STATUS_STYLE["new"];

  const kbChip = t.kb_match
    ? `<span class="ml-2 inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-medium bg-violet-100 text-violet-700">
         <span class="mr-1">⚠</span>${escapeHtml(t.kb_match)}
       </span>`
    : "";

  const replyBlock = t.reply
    ? `<div class="mt-3 pt-3 border-t border-slate-100">
         <div class="text-[10px] uppercase tracking-wide text-slate-400 mb-1.5">reply</div>
         <div class="bg-slate-50 rounded-md p-3 text-sm leading-relaxed">
           ${formatReply(t.reply)}
         </div>
       </div>`
    : "";

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

function formatReply(reply: string): string {
  // Highlight [CRITICAL] / [HIGH] / [URGENT] prefix tags
  const m = reply.match(/^\s*\[(CRITICAL|HIGH|URGENT|WARNING)\]\s*(.*)$/s);
  if (m) {
    const [, tag, rest] = m;
    const tagColor = tag === "CRITICAL" ? "bg-red-600" : tag === "HIGH" || tag === "URGENT" ? "bg-amber-600" : "bg-slate-600";
    return `<span class="inline-block ${tagColor} text-white px-1.5 py-0.5 rounded text-[10px] font-bold tracking-wider mr-1.5">${tag}</span><span class="text-slate-800">${escapeHtml(rest!)}</span>`;
  }
  return `<span class="text-slate-800">${escapeHtml(reply)}</span>`;
}

function escapeHtml(s: unknown): string {
  return String(s ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]!));
}
