import type { Store } from "../store.js";
import type { Plan } from "../types.js";
import { advancePipeline } from "../crm/pipeline.js";
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

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export interface CheckoutParams {
  handle: string;
  priceId: string;
  /** Tier this price represents — stamped into metadata so the webhook can map it. */
  plan: Plan;
  successUrl: string;
  cancelUrl: string;
  customerEmail?: string;
}

/**
 * Create a Stripe Checkout subscription session for the convert flow. Carries
 * the `handle` as `client_reference_id` + metadata (on the session *and* the
 * subscription, so dunning/cancel events resolve it) so the webhook can resolve
 * it (handleStripeEvent). Enables Stripe Tax (§5a A) — automatic_tax computes
 * per-state/customer liability and collects only where we hold a registration,
 * so it's safe to leave on from day one. Returns the hosted Checkout URL.
 */
export async function createCheckoutSession(
  params: CheckoutParams,
  secretKey: string,
  fetchImpl?: FetchLike,
): Promise<{ url: string }> {
  const doFetch = fetchImpl ?? ((u: string, i?: RequestInit) => fetch(u, i));
  const form = new URLSearchParams();
  form.set("mode", "subscription");
  form.set("line_items[0][price]", params.priceId);
  form.set("line_items[0][quantity]", "1");
  form.set("client_reference_id", params.handle);
  form.set("metadata[handle]", params.handle);
  form.set("metadata[plan]", params.plan);
  form.set("subscription_data[metadata][handle]", params.handle);
  form.set("subscription_data[metadata][plan]", params.plan);
  // Stripe Tax (§5a A) — required address collection so tax can be computed.
  form.set("automatic_tax[enabled]", "true");
  form.set("billing_address_collection", "required");
  form.set("success_url", params.successUrl);
  form.set("cancel_url", params.cancelUrl);
  if (params.customerEmail) form.set("customer_email", params.customerEmail);

  const res = await doFetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secretKey}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: form.toString(),
  });
  const json = (await res.json().catch(() => ({}))) as { url?: string; error?: unknown };
  if (!res.ok || !json.url) {
    throw new Error(`Stripe Checkout session creation failed (${res.status})`);
  }
  return { url: json.url };
}

/**
 * Create a Stripe Billing Portal session — the self-serve surface for managing
 * the subscription: $49→$99 upgrade, update card, and self-cancel (§5a, §2). The
 * portal's product/feature config is set once in the Stripe dashboard/API.
 * Returns the hosted portal URL to redirect to.
 */
export async function createPortalSession(
  customerId: string,
  returnUrl: string,
  secretKey: string,
  fetchImpl?: FetchLike,
): Promise<{ url: string }> {
  const doFetch = fetchImpl ?? ((u: string, i?: RequestInit) => fetch(u, i));
  const form = new URLSearchParams();
  form.set("customer", customerId);
  form.set("return_url", returnUrl);

  const res = await doFetch("https://api.stripe.com/v1/billing_portal/sessions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secretKey}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: form.toString(),
  });
  const json = (await res.json().catch(() => ({}))) as { url?: string };
  if (!res.ok || !json.url) {
    throw new Error(`Stripe Billing Portal session creation failed (${res.status})`);
  }
  return { url: json.url };
}

/** Map a Stripe price id to our plan tier. */
export function planForPrice(priceId: string | undefined, prices: PriceMap): Plan {
  if (priceId && priceId === prices.doneForYou) return "done_for_you";
  return "self_serve"; // default tier (§1B)
}

/**
 * The shared shape of the event objects we read — a Checkout Session, a
 * Subscription, or an Invoice. Fields are optional because which are present
 * depends on the event type.
 */
interface StripeObject {
  id?: string;
  customer?: string;
  subscription?: string;
  status?: string; // subscription status on *.subscription.* events
  client_reference_id?: string; // handle (checkout sessions)
  metadata?: Record<string, string>;
  custom_fields?: Array<{ key: string; text?: { value?: string } }>;
  items?: { data?: Array<{ price?: { id?: string } }> }; // subscription line items
}

interface StripeEvent {
  id: string;
  type: string;
  data: { object: StripeObject & Record<string, unknown> };
}

export interface HandleEventDeps {
  store: Store;
  provisioner: Provisioner;
  prices: PriceMap;
  /** Fallback preview host for backup domain candidates, e.g. "oktryme.com". */
  previewHost: string;
  /** Optional ops alert hook for provisioning fallback (§5a E). */
  onProvisionFallback?: (info: {
    handle: string;
    error: string;
    fallbackUrl?: string;
  }) => Promise<void>;
}

export interface HandleEventResult {
  handled: boolean;
  action?: "activated" | "updated" | "reactivated" | "canceled" | "past_due" | "ignored";
  handle?: string;
}

/**
 * Resolve the business handle for any event object. Prefers the explicit handle
 * we stamp into metadata / client_reference_id; falls back to the Stripe
 * customer→handle index so dunning/cancel/invoice events (which carry no handle)
 * still resolve (§5a webhook hardening).
 */
async function resolveHandle(
  obj: StripeObject,
  store: Store,
): Promise<string | undefined> {
  const direct = obj.client_reference_id ?? obj.metadata?.handle;
  if (direct) return direct;
  if (typeof obj.customer === "string") {
    return (await store.resolveCustomer(obj.customer)) ?? undefined;
  }
  return undefined;
}

/** First price id on a subscription's line items, if present. */
function priceFromSubscription(obj: StripeObject): string | undefined {
  return obj.items?.data?.[0]?.price?.id;
}

/** Map a Stripe subscription status to our site status. */
function siteStatusForSubscription(
  stripeStatus: string | undefined,
): "active" | "past_due" | "canceled" {
  switch (stripeStatus) {
    case "active":
    case "trialing":
      return "active";
    case "canceled":
    case "incomplete_expired":
      return "canceled";
    default:
      // past_due, unpaid, incomplete, paused → treat as past_due (recoverable).
      return "past_due";
  }
}

function desiredDomainFromSession(s: StripeObject): string | undefined {
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
  const { store, provisioner, prices, previewHost, onProvisionFallback } = deps;
  const obj = event.data.object;

  switch (event.type) {
    case "checkout.session.completed": {
      const handle = await resolveHandle(obj, store);
      if (!handle) return { handled: false, action: "ignored" };
      const rec = await store.get(handle);
      if (!rec) return { handled: false, action: "ignored", handle };

      rec.stripe = {
        customerId: typeof obj.customer === "string" ? obj.customer : undefined,
        subscriptionId: typeof obj.subscription === "string" ? obj.subscription : undefined,
        subscriptionStatus: "active",
      };
      // Plan is stamped into session metadata at checkout; fall back to the
      // price map if an older/external session lacks it.
      rec.plan =
        (obj.metadata?.plan as Plan | undefined) ??
        planForPrice(obj.metadata?.price as string | undefined, prices);
      // CRM funnel (§6): the lead converted → `paid`.
      advancePipeline(rec, "paid", { note: `stripe:${event.type}` });
      await store.put(rec); // also indexes customer→handle

      const { preferred, backups } = backupDomains(
        desiredDomainFromSession(obj),
        handle,
      );
      await provisionForActivation(handle, preferred, backups, store, provisioner, {
        previewHost,
        onFallback: onProvisionFallback,
      });
      return { handled: true, action: "activated", handle };
    }

    case "customer.subscription.updated": {
      // Plan/status sync — drives the $49→$99 upgrade and active/past_due moves.
      const handle = await resolveHandle(obj, store);
      if (!handle) return { handled: false, action: "ignored" };
      const rec = await store.get(handle);
      if (!rec) return { handled: false, action: "ignored", handle };

      const priceId = priceFromSubscription(obj);
      if (priceId) rec.plan = planForPrice(priceId, prices);
      rec.status = siteStatusForSubscription(obj.status);
      // CRM funnel (§6): active → `paid` (covers reactivation), lapse/cancel → `canceled`.
      advancePipeline(rec, rec.status === "active" ? "paid" : "canceled", {
        note: `stripe:${event.type}:${obj.status ?? "?"}`,
      });
      rec.stripe = {
        ...rec.stripe,
        customerId:
          (typeof obj.customer === "string" ? obj.customer : undefined) ??
          rec.stripe?.customerId,
        subscriptionId:
          (typeof obj.id === "string" ? obj.id : undefined) ??
          rec.stripe?.subscriptionId,
        subscriptionStatus: obj.status ?? rec.stripe?.subscriptionStatus,
      };
      rec.updatedAt = new Date().toISOString();
      await store.put(rec);
      return { handled: true, action: "updated", handle };
    }

    case "customer.subscription.deleted":
      return transition(event, deps, "canceled");

    case "invoice.payment_failed":
      return transition(event, deps, "past_due");

    case "invoice.payment_succeeded": {
      // Recover a lapsed subscriber: a successful retry flips past_due → active.
      const handle = await resolveHandle(obj, store);
      if (!handle) return { handled: false, action: "ignored" };
      const rec = await store.get(handle);
      if (!rec) return { handled: false, action: "ignored", handle };
      if (rec.status !== "past_due") {
        return { handled: false, action: "ignored", handle };
      }
      rec.status = "active";
      if (rec.stripe) rec.stripe.subscriptionStatus = "active";
      // CRM funnel (§6): reactivation revives a `canceled` lead back to `paid`.
      advancePipeline(rec, "paid", { note: `stripe:${event.type}` });
      rec.updatedAt = new Date().toISOString();
      await store.put(rec);
      return { handled: true, action: "reactivated", handle };
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
  const handle = await resolveHandle(event.data.object, deps.store);
  if (!handle) return { handled: false, action: "ignored" };
  const rec = await deps.store.get(handle);
  if (!rec) return { handled: false, action: "ignored", handle };
  rec.status = status;
  if (rec.stripe) rec.stripe.subscriptionStatus = status;
  // CRM funnel (§6): both a hard cancel and a final dunning lapse → `canceled`.
  advancePipeline(rec, "canceled", { note: `stripe:${event.type}` });
  rec.updatedAt = new Date().toISOString();
  await deps.store.put(rec);
  return { handled: true, action: status, handle };
}
