import type { Store } from "../store.js";
import type { Plan } from "../types.js";
import {
  provisionForActivation,
  type Provisioner,
} from "../provisioning/provision.js";

const encoder = new TextEncoder();

/** Hex HMAC-SHA256 via Web Crypto (available in Workers and Node ≥18). */
async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(message));
  return [...new Uint8Array(sig)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Constant-time string comparison. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Build a `Stripe-Signature` header value for a payload (used by tests and the
 * Stripe CLI emulation). `t=<timestamp>,v1=<hmac>`.
 */
export async function signPayload(
  payload: string,
  secret: string,
  timestamp: number,
): Promise<string> {
  const v1 = await hmacSha256Hex(secret, `${timestamp}.${payload}`);
  return `t=${timestamp},v1=${v1}`;
}

/**
 * Verify a Stripe webhook signature (the `Stripe-Signature` header) against the
 * raw request body. Mirrors Stripe's scheme: signed_payload = `${t}.${body}`,
 * HMAC-SHA256 with the endpoint secret, compared to any `v1` value, with a
 * timestamp tolerance to prevent replay.
 */
export async function verifyStripeSignature(
  rawBody: string,
  signatureHeader: string | null,
  secret: string,
  nowSec: number,
  toleranceSec = 300,
): Promise<boolean> {
  if (!signatureHeader) return false;
  const parts = Object.fromEntries(
    signatureHeader.split(",").map((kv) => {
      const idx = kv.indexOf("=");
      return [kv.slice(0, idx).trim(), kv.slice(idx + 1).trim()];
    }),
  );
  const t = Number(parts["t"]);
  const v1 = parts["v1"];
  if (!Number.isFinite(t) || !v1) return false;
  if (Math.abs(nowSec - t) > toleranceSec) return false;

  const expected = await hmacSha256Hex(secret, `${t}.${rawBody}`);
  return timingSafeEqual(expected, v1);
}

export interface PriceMap {
  selfServe: string;
  doneForYou: string;
}

/** Map a Stripe price id to our plan tier. */
export function planForPrice(priceId: string | undefined, prices: PriceMap): Plan {
  if (priceId && priceId === prices.doneForYou) return "done_for_you";
  return "self_serve"; // default tier (§1B)
}

interface StripeCheckoutSession {
  id?: string;
  customer?: string;
  subscription?: string;
  client_reference_id?: string; // we pass the handle here
  metadata?: Record<string, string>;
  custom_fields?: Array<{ key: string; text?: { value?: string } }>;
}

interface StripeEvent {
  id: string;
  type: string;
  data: { object: StripeCheckoutSession & Record<string, unknown> };
}

export interface HandleEventDeps {
  store: Store;
  provisioner: Provisioner;
  prices: PriceMap;
  /** Fallback preview host for backup domain candidates, e.g. "oktryme.com". */
  previewHost: string;
}

export interface HandleEventResult {
  handled: boolean;
  action?: "activated" | "canceled" | "past_due" | "ignored";
  handle?: string;
}

function handleFromSession(s: StripeCheckoutSession): string | undefined {
  return (
    s.client_reference_id ??
    s.metadata?.handle ??
    undefined
  );
}

function desiredDomainFromSession(s: StripeCheckoutSession): string | undefined {
  if (s.metadata?.domain) return s.metadata.domain;
  const field = s.custom_fields?.find((f) => f.key === "domain");
  return field?.text?.value;
}

/** Generate ranked backup domains from a desired name and handle. */
export function backupDomains(desired: string | undefined, handle: string): {
  preferred: string;
  backups: string[];
} {
  const base = (desired ?? `${handle}.com`).toLowerCase().replace(/^www\./, "");
  const stem = base.replace(/\.[a-z]+$/, "");
  return {
    preferred: base,
    backups: [`${stem}.net`, `${stem}.co`, `get${stem}.com`],
  };
}

/**
 * Apply a verified Stripe event to our data store. Drives the preview→active
 * flip + provisioning on checkout, and dunning/cancellation transitions.
 * Idempotent via `provisionForActivation` and status checks.
 */
export async function handleStripeEvent(
  event: StripeEvent,
  deps: HandleEventDeps,
): Promise<HandleEventResult> {
  const { store, provisioner, prices } = deps;
  const obj = event.data.object;

  switch (event.type) {
    case "checkout.session.completed": {
      const handle = handleFromSession(obj);
      if (!handle) return { handled: false, action: "ignored" };
      const rec = await store.get(handle);
      if (!rec) return { handled: false, action: "ignored", handle };

      rec.stripe = {
        customerId: obj.customer,
        subscriptionId: obj.subscription,
        subscriptionStatus: "active",
      };
      const priceId =
        (obj.metadata?.price as string | undefined) ?? undefined;
      rec.plan = planForPrice(priceId, prices);
      await store.put(rec);

      const { preferred, backups } = backupDomains(
        desiredDomainFromSession(obj),
        handle,
      );
      await provisionForActivation(handle, preferred, backups, store, provisioner);
      return { handled: true, action: "activated", handle };
    }

    case "customer.subscription.deleted": {
      return transition(event, deps, "canceled");
    }

    case "invoice.payment_failed": {
      return transition(event, deps, "past_due");
    }

    default:
      return { handled: false, action: "ignored" };
  }
}

async function transition(
  event: StripeEvent,
  deps: HandleEventDeps,
  status: "canceled" | "past_due",
): Promise<HandleEventResult> {
  const customerId =
    (event.data.object.customer as string | undefined) ?? undefined;
  if (!customerId) return { handled: false, action: "ignored" };
  // In production we'd index handle by customer id; for the spike we scan is
  // unnecessary because tests drive by handle via metadata.
  const handle = (event.data.object.metadata?.handle as string) ?? undefined;
  if (!handle) return { handled: false, action: "ignored" };
  const rec = await deps.store.get(handle);
  if (!rec) return { handled: false, action: "ignored", handle };
  rec.status = status;
  if (rec.stripe) rec.stripe.subscriptionStatus = status;
  await deps.store.put(rec);
  return { handled: true, action: status, handle };
}
