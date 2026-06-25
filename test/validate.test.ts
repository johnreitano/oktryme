import { describe, it, expect } from "vitest";
import {
  validateBusinessRecord,
  assertBusinessRecord,
  ValidationError,
} from "../src/validate.js";
import { sampleBusiness } from "./helpers.js";

// Phase 1 — runtime validation guards every trust boundary (KV reads, ingest,
// AI edits) against the canonical business.json shape.
describe("validateBusinessRecord", () => {
  it("accepts the canonical sample record", () => {
    const result = validateBusinessRecord(sampleBusiness());
    expect(result.ok).toBe(true);
  });

  it("rejects a non-object", () => {
    expect(validateBusinessRecord(null).ok).toBe(false);
    expect(validateBusinessRecord("nope").ok).toBe(false);
    expect(validateBusinessRecord([]).ok).toBe(false);
  });

  it("requires handle, status, and plan", () => {
    const rec = sampleBusiness() as unknown as Record<string, unknown>;
    delete rec.handle;
    rec.status = "live"; // not a valid SiteStatus
    rec.plan = "premium"; // not a valid Plan
    const result = validateBusinessRecord(rec);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.some((i) => i.includes("handle"))).toBe(true);
      expect(result.issues.some((i) => i.includes("status"))).toBe(true);
      expect(result.issues.some((i) => i.includes("plan"))).toBe(true);
    }
  });

  it("validates nested address and profile fields", () => {
    const rec = sampleBusiness();
    (rec.business.address as { city?: string }).city = undefined;
    const result = validateBusinessRecord(rec);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.some((i) => i.includes("business.address.city"))).toBe(true);
    }
  });

  it("rejects out-of-range review ratings", () => {
    const rec = sampleBusiness();
    rec.reviews[0].rating = 7;
    const result = validateBusinessRecord(rec);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.some((i) => i.includes("rating"))).toBe(true);
    }
  });

  it("requires hours to be a string map", () => {
    const rec = sampleBusiness();
    (rec.business.hours as Record<string, unknown>).monday = 900;
    const result = validateBusinessRecord(rec);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.some((i) => i.includes("hours.monday"))).toBe(true);
    }
  });

  it("treats stripe as optional but validates it when present", () => {
    const rec = sampleBusiness();
    expect(validateBusinessRecord(rec).ok).toBe(true); // absent → ok
    (rec as { stripe?: unknown }).stripe = { customerId: 42 };
    const result = validateBusinessRecord(rec);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.some((i) => i.includes("stripe.customerId"))).toBe(true);
    }
  });

  it("assertBusinessRecord throws ValidationError on bad input", () => {
    expect(() => assertBusinessRecord({})).toThrow(ValidationError);
    try {
      assertBusinessRecord({});
    } catch (e) {
      expect(e).toBeInstanceOf(ValidationError);
      expect((e as ValidationError).issues.length).toBeGreaterThan(0);
    }
  });

  it("assertBusinessRecord passes a valid record through", () => {
    expect(() => assertBusinessRecord(sampleBusiness())).not.toThrow();
  });
});
