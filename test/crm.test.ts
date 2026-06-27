import { describe, it, expect } from "vitest";
import worker from "../src/index.js";
import { KVStore } from "../src/store.js";
import { handleStripeEvent, type PriceMap } from "../src/billing/stripe.js";
import { MemoryStore } from "../src/store.js";
import { StubProvisioner } from "../src/provisioning/provision.js";
import { buildQueue, statusCounts } from "../src/crm/view.js";
import { advancePipeline, pipelineStatusOf } from "../src/crm/pipeline.js";
import { sampleBusiness } from "./helpers.js";
import type { BusinessRecord } from "../src/types.js";

const PRICES: PriceMap = { selfServe: "price_49", doneForYou: "price_99" };

/** In-memory KVNamespace stand-in supporting get/put/list (the CRM needs list). */
function fakeKV() {
  const map = new Map<string, string>();
  return {
    map,
    async get(key: string, type?: "json") {
      const raw = map.get(key) ?? null;
      if (raw === null) return null;
      return type === "json" ? JSON.parse(raw) : raw;
    },
    async put(key: string, value: string) {
      map.set(key, value);
    },
    async list({ prefix, cursor }: { prefix?: string; cursor?: string } = {}) {
      void cursor;
      const keys = [...map.keys()]
        .filter((k) => !prefix || k.startsWith(prefix))
        .map((name) => ({ name }));
      return { keys, list_complete: true, cursor: "" };
    },
  } as unknown as KVNamespace & { map: Map<string, string> };
}

function makeEnv(overrides: Record<string, unknown> = {}) {
  return {
    BUSINESS_KV: fakeKV(),
    PREVIEW_HOST: "oktryme.com",
    ADMIN_TOKEN: "s3cret",
    IMAGES: { get: async () => null },
    ...overrides,
  } as any;
}

// ctx mock that lets a test await waitUntil work (scan logging + funnel advance).
function makeCtx() {
  const ps: Promise<unknown>[] = [];
  return {
    waitUntil: (p: Promise<unknown>) => ps.push(p),
    settle: () => Promise.all(ps),
  };
}

async function seed(env: any, ...recs: BusinessRecord[]) {
  const store = new KVStore(env.BUSINESS_KV);
  for (const r of recs) await store.put(r);
  return store;
}

describe("CRM admin auth (Phase 6 Track A)", () => {
  it("503s when ADMIN_TOKEN is not configured", async () => {
    const res = await worker.fetch(
      new Request("https://x.workers.dev/admin/crm"),
      makeEnv({ ADMIN_TOKEN: undefined }),
    );
    expect(res.status).toBe(503);
  });

  it("401s without the right token", async () => {
    const res = await worker.fetch(
      new Request("https://x.workers.dev/admin/crm"),
      makeEnv(),
    );
    expect(res.status).toBe(401);
  });

  it("accepts a bearer token and a ?token= query param", async () => {
    const env = makeEnv();
    await seed(env, sampleBusiness());
    const viaHeader = await worker.fetch(
      new Request("https://x.workers.dev/admin/crm", {
        headers: { authorization: "Bearer s3cret" },
      }),
      env,
    );
    expect(viaHeader.status).toBe(200);
    const viaQuery = await worker.fetch(
      new Request("https://x.workers.dev/admin/crm?token=s3cret"),
      env,
    );
    expect(viaQuery.status).toBe(200);
  });
});

describe("CRM read view", () => {
  it("renders the call queue and filters by status (.json)", async () => {
    const env = makeEnv();
    const a = sampleBusiness();
    const b = sampleBusiness();
    b.handle = "scanned-co";
    b.business.name = "Scanned Co";
    advancePipeline(b, "qr-code-visit", { note: "qr-scan" });
    await seed(env, a, b);

    const all = await worker.fetch(
      new Request("https://x.workers.dev/admin/crm.json?token=s3cret"),
      env,
    );
    const allBody = (await all.json()) as any;
    expect(allBody.counts.new).toBe(1);
    expect(allBody.counts["qr-code-visit"]).toBe(1);
    // Hot scanner sorts to the top of the queue.
    expect(allBody.rows[0].handle).toBe("scanned-co");

    const filtered = await worker.fetch(
      new Request("https://x.workers.dev/admin/crm.json?status=qr-code-visit&token=s3cret"),
      env,
    );
    const body = (await filtered.json()) as any;
    expect(body.rows).toHaveLength(1);
    expect(body.rows[0].pipelineStatus).toBe("qr-code-visit");
  });

  it("HTML view contains the lead and a tel link", async () => {
    const env = makeEnv();
    await seed(env, sampleBusiness());
    const res = await worker.fetch(
      new Request("https://x.workers.dev/admin/crm?token=s3cret"),
      env,
    );
    const html = await res.text();
    expect(html).toContain("Joe&#39;s Auto Repair"); // HTML-escaped
    expect(html).toContain('href="tel:');
    expect(html).toContain("noindex,nofollow");
  });
});

describe("CRM manual override + mail status routes", () => {
  it("manually sets pipeline_status (offline close)", async () => {
    const env = makeEnv();
    const store = await seed(env, sampleBusiness());
    const res = await worker.fetch(
      new Request("https://x.workers.dev/admin/pipeline/joes-auto?token=s3cret", {
        method: "POST",
        body: new URLSearchParams({ status: "paid", note: "closed by phone" }),
      }),
      env,
    );
    expect(res.status).toBe(200);
    const rec = await store.get("joes-auto");
    expect(pipelineStatusOf(rec!)).toBe("paid");
    expect(rec!.pipeline?.history.at(-1)?.via).toBe("manual");
  });

  it("rejects an invalid manual status", async () => {
    const env = makeEnv();
    await seed(env, sampleBusiness());
    const res = await worker.fetch(
      new Request("https://x.workers.dev/admin/pipeline/joes-auto?token=s3cret", {
        method: "POST",
        body: new URLSearchParams({ status: "bogus" }),
      }),
      env,
    );
    expect(res.status).toBe(400);
  });

  it("records mail status and advances to postcard-sent", async () => {
    const env = makeEnv();
    const store = await seed(env, sampleBusiness());
    const res = await worker.fetch(
      new Request("https://x.workers.dev/admin/mail/joes-auto?token=s3cret", {
        method: "POST",
        body: new URLSearchParams({ status: "delivered" }),
      }),
      env,
    );
    expect(res.status).toBe(200);
    const rec = await store.get("joes-auto");
    expect(rec!.mail?.status).toBe("delivered");
    expect(pipelineStatusOf(rec!)).toBe("postcard-sent");
  });
});

describe("QR scan advances the funnel (§1C/§6)", () => {
  it("/r/{handle} flips the lead to qr-code-visit and 302s to the preview", async () => {
    const env = makeEnv();
    const store = await seed(env, sampleBusiness());
    const ctx = makeCtx();
    const res = await worker.fetch(
      new Request("https://oktryme.com/r/joes-auto"),
      env,
      ctx as any,
    );
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://oktryme.com/p/joes-auto");
    await ctx.settle(); // scan logging + funnel advance run in waitUntil
    expect(pipelineStatusOf((await store.get("joes-auto"))!)).toBe("qr-code-visit");
  });

  it("still redirects for an unknown handle (no record to update)", async () => {
    const res = await worker.fetch(
      new Request("https://oktryme.com/r/ghost"),
      makeEnv(),
    );
    expect(res.status).toBe(302);
  });
});

describe("Stripe signals drive the funnel", () => {
  function checkoutEvent() {
    return {
      id: "evt_1",
      type: "checkout.session.completed",
      data: {
        object: {
          customer: "cus_1",
          subscription: "sub_1",
          client_reference_id: "joes-auto",
          metadata: { handle: "joes-auto", domain: "joesauto.com" },
        },
      },
    };
  }

  it("checkout → paid; cancel → canceled; reactivation → paid", async () => {
    const store = new MemoryStore();
    await store.put(sampleBusiness());
    const deps = {
      store,
      provisioner: new StubProvisioner(),
      prices: PRICES,
      previewHost: "oktryme.com",
    };

    await handleStripeEvent(checkoutEvent(), deps);
    expect(pipelineStatusOf((await store.get("joes-auto"))!)).toBe("paid");

    await handleStripeEvent(
      { id: "e2", type: "customer.subscription.deleted", data: { object: { customer: "cus_1" } } },
      deps,
    );
    expect(pipelineStatusOf((await store.get("joes-auto"))!)).toBe("canceled");

    // A past_due then a successful retry reactivates the lead.
    await handleStripeEvent(
      { id: "e3", type: "invoice.payment_succeeded", data: { object: { customer: "cus_1" } } },
      deps,
    );
    // payment_succeeded only reactivates from past_due; force that path:
    const rec = await store.get("joes-auto");
    rec!.status = "past_due";
    await store.put(rec!);
    await handleStripeEvent(
      { id: "e4", type: "invoice.payment_succeeded", data: { object: { customer: "cus_1" } } },
      deps,
    );
    expect(pipelineStatusOf((await store.get("joes-auto"))!)).toBe("paid");
  });
});

describe("buildQueue / statusCounts", () => {
  it("counts and orders independent of store", () => {
    const a = sampleBusiness();
    const b = sampleBusiness();
    b.handle = "b";
    advancePipeline(b, "qr-code-visit");
    const counts = statusCounts([a, b]);
    expect(counts.new).toBe(1);
    expect(counts["qr-code-visit"]).toBe(1);
    expect(buildQueue([a, b])[0].handle).toBe("b"); // hot scanner first
  });
});
