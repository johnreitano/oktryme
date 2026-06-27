// CRM read view (Phase 6 Track A / §6) — the sales call queue.
//
// Lists businesses by `pipeline.status` with per-handle timestamps/history.
// This is the queue §1A-step-4 calling works from and the foundation for the
// §7-#9 real-time scan→call routing: `qr-code-visit` leads (just scanned, warm)
// sort to the top with their phone number front-and-centre.

import {
  PIPELINE_STATUSES,
  type BusinessRecord,
  type PipelineEvent,
  type PipelineStatus,
} from "../types.js";
import { pipelineStatusOf } from "./pipeline.js";

/** A flattened, queue-ready row — also the JSON view's shape. */
export interface CrmRow {
  handle: string;
  name: string;
  category: string;
  phone: string;
  city: string;
  state: string;
  pipelineStatus: PipelineStatus;
  /** ISO time the lead entered its current stage (last history event). */
  since?: string;
  siteStatus: BusinessRecord["status"];
  mailStatus?: string;
  history: PipelineEvent[];
}

/** Call-queue priority: the hot `qr-code-visit` leads first, dead leads last. */
const QUEUE_PRIORITY: Record<PipelineStatus, number> = {
  "qr-code-visit": 0,
  "postcard-sent": 1,
  new: 2,
  paid: 3,
  canceled: 4,
};

export function toRow(rec: BusinessRecord): CrmRow {
  const status = pipelineStatusOf(rec);
  const history = rec.pipeline?.history ?? [];
  return {
    handle: rec.handle,
    name: rec.business.name,
    category: rec.business.category,
    phone: rec.business.phone,
    city: rec.business.address.city,
    state: rec.business.address.state,
    pipelineStatus: status,
    since: history.length ? history[history.length - 1].at : rec.createdAt,
    siteStatus: rec.status,
    mailStatus: rec.mail?.status,
    history,
  };
}

/**
 * Build the queue: optionally filter to one `pipeline.status`, then sort by call
 * priority (hot scanners first) and, within a stage, by most-recent transition.
 */
export function buildQueue(
  records: BusinessRecord[],
  filter?: PipelineStatus,
): CrmRow[] {
  return records
    .map(toRow)
    .filter((r) => !filter || r.pipelineStatus === filter)
    .sort((a, b) => {
      const byPriority =
        QUEUE_PRIORITY[a.pipelineStatus] - QUEUE_PRIORITY[b.pipelineStatus];
      if (byPriority !== 0) return byPriority;
      return (b.since ?? "").localeCompare(a.since ?? ""); // newest first
    });
}

/** Count of records in each pipeline stage (drives the filter chips). */
export function statusCounts(
  records: BusinessRecord[],
): Record<PipelineStatus, number> {
  const counts = Object.fromEntries(
    PIPELINE_STATUSES.map((s) => [s, 0]),
  ) as Record<PipelineStatus, number>;
  for (const rec of records) counts[pipelineStatusOf(rec)]++;
  return counts;
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
}

function fmtTime(iso?: string): string {
  return iso ? esc(iso.replace("T", " ").replace(/\.\d+Z$/, "Z")) : "—";
}

/** Render the call-queue HTML page. `basePath` is the route prefix for links. */
export function renderCrm(
  records: BusinessRecord[],
  opts: { filter?: PipelineStatus; previewHost: string; basePath?: string } = {
    previewHost: "oktryme.com",
  },
): string {
  const base = opts.basePath ?? "/admin/crm";
  const counts = statusCounts(records);
  const rows = buildQueue(records, opts.filter);

  const chip = (label: string, status?: PipelineStatus, n?: number) => {
    const href = status ? `${base}?status=${status}` : base;
    const active = (opts.filter ?? null) === (status ?? null);
    return `<a class="chip${active ? " active" : ""}" href="${href}">${esc(label)}${
      n === undefined ? "" : ` <b>${n}</b>`
    }</a>`;
  };

  const chips = [
    chip(`All (${records.length})`),
    ...PIPELINE_STATUSES.map((s) => chip(s, s, counts[s])),
  ].join(" ");

  const body =
    rows.length === 0
      ? `<tr><td colspan="7" class="empty">No leads in this view.</td></tr>`
      : rows
          .map((r) => {
            const tel = r.phone.replace(/[^0-9+]/g, "");
            const hist = r.history
              .map((e) => `${esc(e.status)} @ ${fmtTime(e.at)} (${e.via})`)
              .join(" → ");
            return `<tr class="s-${r.pipelineStatus}">
  <td><span class="badge b-${r.pipelineStatus}">${esc(r.pipelineStatus)}</span></td>
  <td><div class="name">${esc(r.name)}</div><div class="muted">${esc(r.category)}</div></td>
  <td><a href="tel:${esc(tel)}">${esc(r.phone)}</a></td>
  <td>${esc(r.city)}, ${esc(r.state)}</td>
  <td>${esc(r.siteStatus)}${r.mailStatus ? `<div class="muted">mail: ${esc(r.mailStatus)}</div>` : ""}</td>
  <td>${fmtTime(r.since)}</td>
  <td><a href="https://${esc(opts.previewHost)}/p/${esc(r.handle)}" target="_blank" rel="noopener">preview ↗</a><div class="muted hist" title="${esc(hist)}">${esc(hist)}</div></td>
</tr>`;
          })
          .join("\n");

  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="robots" content="noindex,nofollow">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Sales CRM — call queue</title>
<style>
  :root{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
  body{margin:0;background:#f7f7f8;color:#1a1a1a}
  header{padding:16px 20px;background:#111;color:#fff}
  header h1{margin:0;font-size:18px}
  .chips{padding:12px 20px;display:flex;flex-wrap:wrap;gap:8px}
  .chip{padding:5px 12px;border-radius:999px;background:#e9e9ec;color:#222;text-decoration:none;font-size:13px}
  .chip.active{background:#111;color:#fff}
  .chip b{font-weight:700}
  table{width:100%;border-collapse:collapse;background:#fff}
  th,td{padding:10px 12px;text-align:left;border-bottom:1px solid #ececef;font-size:14px;vertical-align:top}
  th{background:#fafafb;font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:#666}
  .name{font-weight:600}
  .muted{color:#888;font-size:12px}
  .hist{max-width:360px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .badge{display:inline-block;padding:2px 8px;border-radius:6px;font-size:12px;font-weight:600;white-space:nowrap}
  .b-new{background:#eef}.b-postcard-sent{background:#fef3c7}
  .b-qr-code-visit{background:#bbf7d0;color:#064e2b}
  .b-paid{background:#bfdbfe;color:#0c2c63}.b-canceled{background:#f3d4d4;color:#7a1f1f}
  .empty{text-align:center;color:#999;padding:32px}
  tr.s-qr-code-visit{background:#f0fff6}
</style></head>
<body>
<header><h1>Sales CRM — call queue <span class="muted" style="color:#aaa">${rows.length} shown · ${records.length} total</span></h1></header>
<div class="chips">${chips}</div>
<table>
<thead><tr><th>Stage</th><th>Business</th><th>Phone</th><th>Location</th><th>Site</th><th>Since</th><th>Preview / history</th></tr></thead>
<tbody>
${body}
</tbody>
</table>
</body></html>`;
}
