// Sales-funnel pipeline transitions (Phase 6 Track A / §6 CRM).
//
// A per-business `pipeline.status` tracks the lead through the sales funnel —
// distinct from the site-lifecycle `status` and from the postcard `mail` state.
// Transitions are driven by the existing mail/scan/Stripe signals and must be:
//   • idempotent  — re-delivering the same signal is a no-op;
//   • monotonic   — re-delivery of an *earlier* signal never regresses a lead
//                   that has already advanced (a stray `delivered` webhook after
//                   a scan must not knock the lead out of the call queue);
// with a manual override for offline events (a phone close, a correction).

import type {
  BusinessRecord,
  MailStatus,
  PipelineEvent,
  PipelineStatus,
} from "../types.js";

/**
 * Forward-funnel order. A signal only ever moves a lead to a *higher*-ranked
 * stage (monotonic). `canceled` ranks highest so a churn signal is terminal and
 * re-delivered earlier signals can't revive a dead lead — the one intentional
 * backward move (reactivation: `canceled → paid`) is special-cased below.
 */
const PIPELINE_RANK: Record<PipelineStatus, number> = {
  new: 0,
  "postcard-sent": 1,
  "qr-code-visit": 2,
  paid: 3,
  canceled: 4,
};

/** Typed MailStatus values that mean "the postcard is on its way or arrived" →
 * advance the funnel to `postcard-sent`. `queued` (not yet sent) and the
 * terminal failure states (`returned`/`failed`) are excluded — they neither
 * advance nor regress. The provider→MailStatus mapping (Phase 5
 * `mapPostgridStatus`) collapses the raw Lob/PostGrid vocabulary into these. */
const POSTCARD_SENT_MAIL = new Set<MailStatus>(["mailed", "in_transit", "delivered"]);

/** Current funnel stage, treating an untouched record as `new`. */
export function pipelineStatusOf(rec: BusinessRecord): PipelineStatus {
  return rec.pipeline?.status ?? "new";
}

export interface TransitionOptions {
  /** Source/reason recorded on the history event (e.g. "qr-scan"). */
  note?: string;
  /** ISO timestamp override (defaults to now) — for deterministic tests. */
  at?: string;
}

function record(
  rec: BusinessRecord,
  to: PipelineStatus,
  via: PipelineEvent["via"],
  opts: TransitionOptions,
): void {
  const event: PipelineEvent = {
    status: to,
    at: opts.at ?? new Date().toISOString(),
    via,
    ...(opts.note ? { note: opts.note } : {}),
  };
  const history = rec.pipeline?.history ?? [];
  rec.pipeline = { status: to, history: [...history, event] };
}

/**
 * Auto-advance the lead to `to` if (and only if) it's a forward move — the
 * monotonic, idempotent transition driven by the mail/scan/Stripe signals.
 * Returns `true` if the stage changed (so callers know whether to persist).
 * Mutates `rec` in place; the caller is responsible for `store.put`.
 *
 * The sole sanctioned backward move is reactivation (`canceled → paid`, fired by
 * a successful invoice retry after a lapse), which is allowed explicitly.
 */
export function advancePipeline(
  rec: BusinessRecord,
  to: PipelineStatus,
  opts: TransitionOptions = {},
): boolean {
  const from = pipelineStatusOf(rec);
  if (from === to) return false; // idempotent
  const isReactivation = to === "paid" && from === "canceled";
  if (!isReactivation && PIPELINE_RANK[to] <= PIPELINE_RANK[from]) {
    return false; // monotonic — never regress
  }
  record(rec, to, "auto", opts);
  return true;
}

/**
 * Manual override for offline events (ops marks a phone close `paid`, fixes a
 * mis-set stage). Bypasses the monotonic guard and always records the move;
 * a no-op only when the stage is already `to`. Mutates `rec` in place.
 */
export function setPipelineManual(
  rec: BusinessRecord,
  to: PipelineStatus,
  opts: TransitionOptions = {},
): boolean {
  if (pipelineStatusOf(rec) === to) return false;
  record(rec, to, "manual", opts);
  return true;
}

/**
 * Apply a (typed) mail status to the record: fold it onto the `mail` object and,
 * when it indicates the postcard was sent/in-transit/delivered, advance the funnel
 * to `postcard-sent` (§6 "postcard send / mail delivered → postcard-sent"). The
 * single entry point for mail updates — used by both the PostGrid webhook and the
 * /admin/mail ops route, so mail state and funnel stage never drift. Returns
 * `true` if the funnel stage changed. Mutates `rec` in place.
 */
export function applyMailStatus(
  rec: BusinessRecord,
  status: MailStatus,
  opts: TransitionOptions & { provider?: string; providerId?: string } = {},
): boolean {
  const now = opts.at ?? new Date().toISOString();
  rec.mail = {
    ...rec.mail,
    status,
    provider: opts.provider ?? rec.mail?.provider,
    providerId: opts.providerId ?? rec.mail?.providerId,
    // Stamp mailedAt on the first sent-class status; preserve it thereafter.
    mailedAt:
      rec.mail?.mailedAt ?? (POSTCARD_SENT_MAIL.has(status) ? now : undefined),
    updatedAt: now,
  };
  if (!POSTCARD_SENT_MAIL.has(status)) return false;
  return advancePipeline(rec, "postcard-sent", {
    note: opts.note ?? `mail:${status}`,
    at: opts.at,
  });
}
