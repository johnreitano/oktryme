import { describe, expect, it } from "vitest";
import { ALLOWLIST } from "../src/ingest/allowlist.js";
import {
  makeHandle,
  normalizeOutscraperRecord,
  slugify,
  type OutscraperRecord,
} from "../src/ingest/outscraper.js";
import { validateBusinessRecord } from "../src/validate.js";

const AUTO = ALLOWLIST.find((t) => t.trade === "auto-repair")!;

describe("slugify / makeHandle", () => {
  it("slugifies to url-safe tokens", () => {
    expect(slugify("Joe's Auto & Body Shop!")).toBe("joes-auto-body-shop");
  });
  it("combines name + city, avoiding doubled city", () => {
    expect(makeHandle("Joe's Auto", "Knoxville")).toBe("joes-auto-knoxville");
    expect(makeHandle("Knoxville Auto", "Knoxville")).toBe("knoxville-auto");
  });
});

describe("normalizeOutscraperRecord", () => {
  const raw: OutscraperRecord = {
    name: "Joe's Auto",
    owner_name: "Joe Smith",
    type: "Auto Repair Shop",
    phone: "+1 865-555-1212",
    street: "123 Main St",
    city: "Knoxville",
    state: "TN",
    postal_code: "37902",
    description: "Independent garage doing brakes and oil changes.",
    working_hours: { Monday: "8AM-5PM", Tuesday: "8AM-5PM", Sunday: "Closed" },
    site: "",
  };

  it("produces a valid preview record from text fields only", () => {
    const out = normalizeOutscraperRecord(raw, { trade: AUTO });
    expect(out.status).toBe("preview");
    expect(out.plan).toBe("self_serve");
    expect(out.handle).toBe("joes-auto-knoxville");
    expect(out.business.ownerName).toBe("Joe Smith");
    expect(out.business.hours).toMatchObject({ monday: "8AM-5PM", sunday: "Closed" });
    // No photos, no republished reviews.
    expect(out.images).toEqual({});
    expect(out.reviews).toEqual([]);
    expect(out.services).toEqual([]);
    expect(out.business.about).toBeUndefined();
    expect(validateBusinessRecord(out).ok).toBe(true);
  });

  it("handles the real v3 shapes: array hours, state_code, owner_title", () => {
    const out = normalizeOutscraperRecord(
      {
        name: "Bao Auto Repair",
        type: "Auto repair shop",
        phone: "+1 865-688-8695",
        street: "1100 Bradshaw Garden Dr",
        city: "Knoxville",
        state: "Tennessee", // full name…
        state_code: "TN", // …but state_code is preferred
        postal_code: "37912",
        owner_title: "Bao Auto Repair", // business name, NOT a person → ignored
        working_hours: { Monday: ["8AM-12PM", "1PM-6PM"], Sunday: ["Closed"] },
        website: "",
      },
      { trade: AUTO },
    );
    expect(out.business.address.state).toBe("TN");
    expect(out.business.hours.monday).toBe("8AM-12PM, 1PM-6PM"); // array joined
    expect(out.business.ownerName).toBeUndefined(); // owner_title not used
    expect(validateBusinessRecord(out).ok).toBe(true);
  });

  it("falls back to a factual trade+location description when none scraped", () => {
    const out = normalizeOutscraperRecord({ ...raw, description: undefined }, { trade: AUTO });
    expect(out.business.description).toBe("Auto Repair in Knoxville, TN.");
  });

  it("parses a one-line full_address when discrete fields are missing", () => {
    const out = normalizeOutscraperRecord(
      {
        name: "Curb Appeal Lawns",
        type: "Lawn Care",
        phone: "865-555-0000",
        full_address: "9 Oak Ave, Knoxville, TN 37919",
      },
      { trade: AUTO },
    );
    expect(out.business.address).toMatchObject({
      line1: "9 Oak Ave",
      city: "Knoxville",
      state: "TN",
      zip: "37919",
    });
  });

  it("de-dupes handles against a taken set", () => {
    const taken = new Set<string>();
    const a = normalizeOutscraperRecord(raw, { trade: AUTO, takenHandles: taken });
    const b = normalizeOutscraperRecord(raw, { trade: AUTO, takenHandles: taken });
    expect(a.handle).toBe("joes-auto-knoxville");
    expect(b.handle).toBe("joes-auto-knoxville-2");
  });

  it("yields an invalid record when phone is missing (data-completeness gate)", () => {
    const out = normalizeOutscraperRecord({ ...raw, phone: undefined }, { trade: AUTO });
    const result = validateBusinessRecord(out);
    expect(result.ok).toBe(false);
  });
});
