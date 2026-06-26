import { describe, it, expect } from "vitest";
import worker from "../src/index.js";
import { KVStore } from "../src/store.js";
import { sampleBusiness } from "./helpers.js";
import type { BusinessRecord } from "../src/types.js";

/** A minimal in-memory KVNamespace stand-in (strings in, "json" parses out). */
function makeKV() {
  const data = new Map<string, string>();
  return {
    data,
    async get(key: string, type?: string) {
      const v = data.get(key);
      if (v === undefined) return null;
      return type === "json" ? JSON.parse(v) : v;
    },
    async put(key: string, val: string) {
      data.set(key, val);
    },
  } as any;
}

async function envWith(rec: BusinessRecord) {
  const kv = makeKV();
  await new KVStore(kv).put(rec);
  return {
    BUSINESS_KV: kv,
    PREVIEW_HOST: "oktryme.com",
    IMAGES: { get: async () => null },
  } as any;
}

describe("Phase 4: {handle}.<preview-host> fallback subdomain", () => {
  it("serves the live site (no preview banner) for an active record", async () => {
    const rec = sampleBusiness();
    rec.status = "active";
    const env = await envWith(rec);
    const res = await worker.fetch(new Request("https://joes-auto.oktryme.com/"), env);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).not.toContain("PREVIEW");
  });

  it("shows the paused page for a canceled record", async () => {
    const rec = sampleBusiness();
    rec.status = "canceled";
    const env = await envWith(rec);
    const res = await worker.fetch(new Request("https://joes-auto.oktryme.com/"), env);
    expect(res.status).toBe(402);
  });

  it("404s an unknown handle on the fallback subdomain", async () => {
    const rec = sampleBusiness();
    rec.status = "active";
    const env = await envWith(rec);
    const res = await worker.fetch(new Request("https://nobody.oktryme.com/"), env);
    expect(res.status).toBe(404);
  });
});

describe("Phase 4: customer portal route", () => {
  it("404s when the business has no Stripe customer", async () => {
    const rec = sampleBusiness(); // no stripe link
    const env = await envWith(rec);
    const res = await worker.fetch(new Request("https://oktryme.com/portal/joes-auto"), env);
    expect(res.status).toBe(404);
  });

  it("503s when Stripe isn't configured but a customer exists", async () => {
    const rec = sampleBusiness();
    rec.stripe = { customerId: "cus_123" };
    const env = await envWith(rec); // no STRIPE_SECRET_KEY
    const res = await worker.fetch(new Request("https://oktryme.com/portal/joes-auto"), env);
    expect(res.status).toBe(503);
  });
});

describe("Phase 4: done-for-you intake route", () => {
  it("accepts a change request for an active customer", async () => {
    const rec = sampleBusiness();
    rec.status = "active";
    const env = await envWith(rec);
    const form = new URLSearchParams({ message: "Please change my hours to 8-6." });
    const res = await worker.fetch(
      new Request("https://oktryme.com/dfy/joes-auto", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: form.toString(),
      }),
      env,
    );
    expect(res.status).toBe(200);
  });

  it("rejects a request when there's no active subscription", async () => {
    const rec = sampleBusiness(); // status: preview
    const env = await envWith(rec);
    const form = new URLSearchParams({ message: "do a thing" });
    const res = await worker.fetch(
      new Request("https://oktryme.com/dfy/joes-auto", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: form.toString(),
      }),
      env,
    );
    expect(res.status).toBe(400);
  });
});
