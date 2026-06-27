// PostGrid print-and-mail client + delivery-webhook handler (§1C of PLAN.md).
//
// PostGrid is the validation-phase provider (no monthly platform fee, §1C). The
// `sendPostcard` client is a thin POST gated behind an API key (used only by the
// batch-send script); `handlePostgridWebhook` runs in the Worker and folds
// delivery events back onto the record's `mail` status for attribution.

import { MAIL_STATUSES, type MailStatus } from "../types.js";
import type { Store } from "../store.js";
import { applyMailStatus } from "../crm/pipeline.js";
import type { PostcardRequest } from "./postcard.js";

const POSTGRID_BASE = "https://api.postgrid.com/print-mail/v1";

/**
 * PostGrid postcard status → our MailStatus (§1C lifecycle). Idempotent: an
 * input that is already a valid MailStatus passes straight through, so the same
 * function safely normalizes both raw provider vocab and our own enum (e.g. the
 * /admin/mail ops route, where a human might type either).
 */
export function mapPostgridStatus(status: string | undefined): MailStatus {
  if (status && (MAIL_STATUSES as readonly string[]).includes(status)) {
    return status as MailStatus;
  }
  switch (status) {
    case "ready":
    case "printing":
      return "mailed";
    case "processed_for_delivery":
      return "in_transit";
    case "completed":
      return "delivered";
    case "returned_to_sender":
      return "returned";
    case "cancelled":
      return "failed";
    default:
      // Any not-yet-seen status still means the provider accepted the piece.
      return "mailed";
  }
}

export interface SendOptions {
  apiKey: string;
  /** Injectable for tests; defaults to global fetch. */
  fetchImpl?: typeof fetch;
  /** Override base URL (tests / PostGrid test vs. live is keyed by the API key). */
  baseUrl?: string;
}

export interface SendResult {
  /** PostGrid postcard id (stored as `mail.providerId`). */
  id: string;
  status: MailStatus;
}

/**
 * Submit one postcard to PostGrid. The `Idempotency-Key` (the handle) makes a
 * retried send return the same postcard instead of mailing twice — belt-and-
 * suspenders with the script's own already-mailed skip.
 */
export async function sendPostcard(
  req: PostcardRequest,
  opts: SendOptions,
): Promise<SendResult> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const res = await fetchImpl(`${opts.baseUrl ?? POSTGRID_BASE}/postcards`, {
    method: "POST",
    headers: {
      "x-api-key": opts.apiKey,
      "content-type": "application/json",
      "Idempotency-Key": req.metadata.handle,
    },
    body: JSON.stringify(req),
  });
  if (!res.ok) {
    throw new Error(`PostGrid send failed (${res.status}): ${await res.text()}`);
  }
  const body = (await res.json()) as { id?: string; status?: string };
  if (!body.id) throw new Error("PostGrid response missing postcard id");
  return { id: body.id, status: mapPostgridStatus(body.status) };
}

/** Shape of a PostGrid webhook event (the bits we read). */
interface PostgridWebhookEvent {
  type?: string;
  data?: {
    id?: string;
    status?: string;
    metadata?: { handle?: string };
  };
}

export interface WebhookResult {
  ok: boolean;
  handle?: string;
  status?: MailStatus;
  error?: string;
}

/**
 * Apply a PostGrid delivery webhook to the matching record. Correlation is via
 * `metadata.handle` (set on every send). Routes through `applyMailStatus` so the
 * typed `mail` state and the CRM funnel stage update together (a sent/in-transit/
 * delivered event advances the lead to `postcard-sent`).
 */
export async function handlePostgridWebhook(
  event: unknown,
  store: Store,
): Promise<WebhookResult> {
  const data = (event as PostgridWebhookEvent)?.data;
  const handle = data?.metadata?.handle;
  if (!handle) return { ok: false, error: "no handle in metadata" };

  const rec = await store.get(handle);
  if (!rec) return { ok: false, handle, error: "unknown handle" };

  const status = mapPostgridStatus(data?.status);
  applyMailStatus(rec, status, {
    provider: "postgrid",
    providerId: data?.id,
    note: `postgrid:${data?.status ?? "unknown"}`,
  });
  await store.put(rec);
  return { ok: true, handle, status };
}
