// The canonical per-business record — `business.json` (§3a of PLAN.md).
// One source of truth for both the preview and the live site.

export type SiteStatus = "preview" | "active" | "past_due" | "canceled";
export type Plan = "self_serve" | "done_for_you";

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

export interface BusinessProfile {
  name: string;
  ownerName?: string;
  category: string;
  address: Address;
  phone: string;
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
  mailStatus?: string;
  /** ISO timestamp of the last edit (set by callers). */
  updatedAt?: string;
}
