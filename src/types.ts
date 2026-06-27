// The canonical per-business record — `business.json` (§3a of PLAN.md).
// One source of truth for both the preview and the live site.

export type SiteStatus = "preview" | "active" | "past_due" | "canceled";
export type Plan = "self_serve" | "done_for_you";

/**
 * Sales-funnel stage for a lead (Phase 6 Track A / §6 CRM). Distinct from the
 * site-lifecycle `status` (preview/active/…) and from `mailStatus` — those record
 * *infrastructure* state; this records where the *lead* sits in the sales funnel:
 *
 *   new → postcard-sent → qr-code-visit → paid → canceled
 *
 * `qr-code-visit` = the lead scanned the postcard QR and opened the preview — the
 * hot signal that drives the §1A-step-4 / §7-#9 scan→call routing. Advanced
 * automatically by the mail/scan/Stripe signals (monotonic — re-delivery never
 * regresses a later stage), with manual override for offline events.
 */
export type PipelineStatus =
  | "new"
  | "postcard-sent"
  | "qr-code-visit"
  | "paid"
  | "canceled";

/** One recorded funnel transition, for the per-handle timestamps/history view. */
export interface PipelineEvent {
  status: PipelineStatus;
  /** ISO timestamp the lead entered this stage. */
  at: string;
  /** `auto` = driven by a mail/scan/Stripe signal; `manual` = ops override. */
  via: "auto" | "manual";
  /** Free-text source/reason, e.g. "qr-scan", "stripe:checkout.session.completed". */
  note?: string;
}

/** Current funnel stage plus its append-only transition history. */
export interface PipelineState {
  status: PipelineStatus;
  history: PipelineEvent[];
}

export interface Address {
  line1: string;
  line2?: string;
  city: string;
  state: string;
  zip: string;
}

/** Day-of-week → human string, e.g. "9:00 AM – 5:00 PM" or "Closed". */
export type Hours = Partial<Record<DayOfWeek, string>>;

export type DayOfWeek =
  | "monday"
  | "tuesday"
  | "wednesday"
  | "thursday"
  | "friday"
  | "saturday"
  | "sunday";

export const DAYS_OF_WEEK: DayOfWeek[] = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
];

export interface Service {
  name: string;
  description?: string;
}

export interface Review {
  author: string;
  rating: number; // 1–5
  text: string;
}

/**
 * Image slots. Values are licensed category-stock keys/URLs or customer
 * uploads — NEVER photos scraped from Google Maps (§11 of PLAN.md).
 */
export interface ImageSet {
  hero?: string;
  [slot: string]: string | undefined;
}

export interface StripeLink {
  customerId?: string;
  subscriptionId?: string;
  subscriptionStatus?: string;
}

/**
 * Domain-provisioning outcome for a paid site (§5a C/E). `provisioned` = live on
 * the custom domain; `fallback` = registration/attach stalled, so we serve on the
 * `{handle}.<preview-host>` subdomain instead (never auto-refund — the customer is
 * always served something). `pending` = not yet attempted.
 */
export type ProvisioningState = "provisioned" | "fallback" | "pending";

export interface ProvisioningStatus {
  state: ProvisioningState;
  /** Last error message when a register/attach attempt failed (fallback state). */
  lastError?: string;
  /** How many provisioning attempts have been made (for backoff / dead-lettering). */
  attempts?: number;
  /** ISO timestamp of the last provisioning attempt. */
  updatedAt?: string;
}

export interface BusinessProfile {
  name: string;
  ownerName?: string;
  category: string;
  address: Address;
  phone: string;
  /** Business contact email for lead notifications (captured at conversion). */
  email?: string;
  hours: Hours;
  /** Short factual description (from scraped public data). */
  description: string;
  /** Longer "About" marketing copy (AI-generated, generic, no fabricated claims). */
  about?: string;
}

export interface BusinessRecord {
  /** Internal slug + primary key everywhere. */
  handle: string;
  status: SiteStatus;
  plan: Plan;
  /** Live custom domain once provisioned. */
  domain?: string;
  business: BusinessProfile;
  services: Service[];
  reviews: Review[];
  images: ImageSet;
  stripe?: StripeLink;
  /** Domain-provisioning outcome once paid (§5a). Absent before conversion. */
  provisioning?: ProvisioningStatus;
  mailStatus?: string;
  /**
   * Sales-funnel stage + history (Phase 6 Track A / §6 CRM). Absent = `new`
   * (a freshly-ingested lead not yet touched by any funnel signal).
   */
  pipeline?: PipelineState;
  /** ISO timestamp of record creation (stamped by the store on first write). */
  createdAt?: string;
  /** ISO timestamp of the last edit (set by callers). */
  updatedAt?: string;
}

export const SITE_STATUSES: SiteStatus[] = [
  "preview",
  "active",
  "past_due",
  "canceled",
];

export const PLANS: Plan[] = ["self_serve", "done_for_you"];

export const PIPELINE_STATUSES: PipelineStatus[] = [
  "new",
  "postcard-sent",
  "qr-code-visit",
  "paid",
  "canceled",
];

export const PROVISIONING_STATES: ProvisioningState[] = [
  "provisioned",
  "fallback",
  "pending",
];
