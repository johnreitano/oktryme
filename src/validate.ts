// Runtime validation for the canonical `business.json` record (§3a of PLAN.md).
//
// The TypeScript types in `types.ts` vanish at runtime, so anything that
// crosses a trust boundary — KV reads, Phase-3 Outscraper ingest, the Phase-6
// AI edit agent — must be validated against the real shape before we render or
// persist it. Hand-rolled (no dependency) to match the project's zero-dep style.

import {
  PLANS,
  SITE_STATUSES,
  type BusinessRecord,
  type Plan,
  type SiteStatus,
} from "./types.js";

export class ValidationError extends Error {
  constructor(public readonly issues: string[]) {
    super(`invalid BusinessRecord: ${issues.join("; ")}`);
    this.name = "ValidationError";
  }
}

export type ValidationResult =
  | { ok: true; value: BusinessRecord }
  | { ok: false; issues: string[] };

/** Validate untrusted input; never throws. Use at trust boundaries. */
export function validateBusinessRecord(input: unknown): ValidationResult {
  const issues: string[] = [];
  check(input, issues);
  return issues.length === 0
    ? { ok: true, value: input as BusinessRecord }
    : { ok: false, issues };
}

/** Throwing variant for write paths that must reject bad records loudly. */
export function assertBusinessRecord(input: unknown): asserts input is BusinessRecord {
  const result = validateBusinessRecord(input);
  if (!result.ok) throw new ValidationError(result.issues);
}

// --- field checks -----------------------------------------------------------

function check(input: unknown, issues: string[]): void {
  if (!isObject(input)) {
    issues.push("record must be an object");
    return;
  }
  const rec = input as Record<string, unknown>;

  reqString(rec, "handle", issues);
  reqEnum(rec, "status", SITE_STATUSES as readonly SiteStatus[], issues);
  reqEnum(rec, "plan", PLANS as readonly Plan[], issues);
  optString(rec, "domain", issues);
  optString(rec, "mailStatus", issues);
  optString(rec, "createdAt", issues);
  optString(rec, "updatedAt", issues);

  checkProfile(rec.business, issues);
  checkArray(rec.services, "services", issues, checkService);
  checkArray(rec.reviews, "reviews", issues, checkReview);
  checkImages(rec.images, issues);
  checkStripe(rec.stripe, issues);
}

function checkProfile(input: unknown, issues: string[]): void {
  if (!isObject(input)) {
    issues.push("business must be an object");
    return;
  }
  const b = input as Record<string, unknown>;
  reqString(b, "name", issues, "business.name");
  optString(b, "ownerName", issues, "business.ownerName");
  reqString(b, "category", issues, "business.category");
  reqString(b, "phone", issues, "business.phone");
  optString(b, "email", issues, "business.email");
  reqString(b, "description", issues, "business.description");
  optString(b, "about", issues, "business.about");
  checkAddress(b.address, issues);
  checkHours(b.hours, issues);
}

function checkAddress(input: unknown, issues: string[]): void {
  if (!isObject(input)) {
    issues.push("business.address must be an object");
    return;
  }
  const a = input as Record<string, unknown>;
  reqString(a, "line1", issues, "business.address.line1");
  optString(a, "line2", issues, "business.address.line2");
  reqString(a, "city", issues, "business.address.city");
  reqString(a, "state", issues, "business.address.state");
  reqString(a, "zip", issues, "business.address.zip");
}

function checkHours(input: unknown, issues: string[]): void {
  if (input === undefined) {
    issues.push("business.hours is required");
    return;
  }
  if (!isObject(input)) {
    issues.push("business.hours must be an object");
    return;
  }
  for (const [day, value] of Object.entries(input)) {
    if (typeof value !== "string") {
      issues.push(`business.hours.${day} must be a string`);
    }
  }
}

function checkService(input: unknown, issues: string[], path: string): void {
  if (!isObject(input)) {
    issues.push(`${path} must be an object`);
    return;
  }
  const s = input as Record<string, unknown>;
  reqString(s, "name", issues, `${path}.name`);
  optString(s, "description", issues, `${path}.description`);
}

function checkReview(input: unknown, issues: string[], path: string): void {
  if (!isObject(input)) {
    issues.push(`${path} must be an object`);
    return;
  }
  const r = input as Record<string, unknown>;
  reqString(r, "author", issues, `${path}.author`);
  reqString(r, "text", issues, `${path}.text`);
  if (typeof r.rating !== "number" || r.rating < 1 || r.rating > 5) {
    issues.push(`${path}.rating must be a number 1–5`);
  }
}

function checkImages(input: unknown, issues: string[]): void {
  if (input === undefined) {
    issues.push("images is required (may be empty object)");
    return;
  }
  if (!isObject(input)) {
    issues.push("images must be an object");
    return;
  }
  for (const [slot, value] of Object.entries(input)) {
    if (value !== undefined && typeof value !== "string") {
      issues.push(`images.${slot} must be a string`);
    }
  }
}

function checkStripe(input: unknown, issues: string[]): void {
  if (input === undefined) return; // optional
  if (!isObject(input)) {
    issues.push("stripe must be an object");
    return;
  }
  const s = input as Record<string, unknown>;
  optString(s, "customerId", issues, "stripe.customerId");
  optString(s, "subscriptionId", issues, "stripe.subscriptionId");
  optString(s, "subscriptionStatus", issues, "stripe.subscriptionStatus");
}

// --- primitives --------------------------------------------------------------

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function reqString(
  obj: Record<string, unknown>,
  key: string,
  issues: string[],
  path = key,
): void {
  const v = obj[key];
  if (typeof v !== "string" || v.length === 0) {
    issues.push(`${path} is required and must be a non-empty string`);
  }
}

function optString(
  obj: Record<string, unknown>,
  key: string,
  issues: string[],
  path = key,
): void {
  const v = obj[key];
  if (v !== undefined && typeof v !== "string") {
    issues.push(`${path} must be a string`);
  }
}

function reqEnum<T extends string>(
  obj: Record<string, unknown>,
  key: string,
  allowed: readonly T[],
  issues: string[],
): void {
  const v = obj[key];
  if (typeof v !== "string" || !allowed.includes(v as T)) {
    issues.push(`${key} must be one of: ${allowed.join(", ")}`);
  }
}

function checkArray(
  input: unknown,
  name: string,
  issues: string[],
  item: (v: unknown, issues: string[], path: string) => void,
): void {
  if (input === undefined) {
    issues.push(`${name} is required (may be empty array)`);
    return;
  }
  if (!Array.isArray(input)) {
    issues.push(`${name} must be an array`);
    return;
  }
  input.forEach((v, i) => item(v, issues, `${name}[${i}]`));
}
