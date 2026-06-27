import { describe, it, expect } from "vitest";
import worker from "../src/index.js";
import { sampleBusiness } from "./helpers.js";

// Map-backed fake KV with get(json)/put/list — enough for the outreach routes.
function fakeKV(seed: Record<string, unknown> = {}) {
  const map = new Map<string, string>();
  for (const [k, v] of Object.entries(seed)) map.set(k, JSON.stringify(v));
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
    async list({ prefix }: { prefix?: string } = {}) {
      const keys = [...map.keys()]
        .filter((k) => !prefix || k.startsWith(prefix))
        .map((name) => ({ name }));
      return { keys, list_complete: true, cursor: "" };
    },
  } as unknown as KVNamespace & { map: Map<string, string> };
}

function makeEnv(kv = fakeKV(), extra: Record<string, unknown> = {}): any {
  return { BUSINESS_KV: kv, PREVIEW_HOST: "oktryme.com", IMAGES: {}, ...extra };
}

// ctx mock that lets the test await waitUntil work (scan logging).
function makeCtx() {
  const ps: Promise<unknown>[] = [];
  return {
    waitUntil: (p: Promise<unknown>) => ps.push(p),
    settle: () => Promise.all(ps),
  };
}

describe("GET /qr/{handle} (QR image)", () => {
  it("returns a scannable SVG with image content-type", async () => {
    const res = await worker.fetch(new Request("https://oktryme.com/qr/joes-auto.svg"), makeEnv());
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("image/svg+xml");
    expect(await res.text()).toContain("<svg");
  });

  it("also serves the extension-less /qr/{handle}", async () => {
    const res = await worker.fetch(new Request("https://oktryme.com/qr/joes-auto"), makeEnv());
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("image/svg+xml");
  });
});

describe("GET /r/{handle} (scan log → preview)", () => {
  it("302s to the preview and logs the scan", async () => {
    const kv = fakeKV();
    const ctx = makeCtx();
    const res = await worker.fetch(
      new Request("https://oktryme.com/r/joes-auto", { headers: { "user-agent": "iPhone" } }),
      makeEnv(kv),
      ctx as any,
    );
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://oktryme.com/p/joes-auto");

    await ctx.settle();
    const scanKeys = [...kv.map.keys()].filter((k) => k.startsWith("scan:joes-auto:"));
    expect(scanKeys).toHaveLength(1);
    expect(JSON.parse(kv.map.get(scanKeys[0])!).ua).toBe("iPhone");
  });
});

describe("POST /postgrid/webhook", () => {
  it("updates the record's mail status on a valid event", async () => {
    const rec = sampleBusiness();
    const kv = fakeKV({ [`biz:${rec.handle}`]: rec });
    const res = await worker.fetch(
      new Request("https://oktryme.com/postgrid/webhook", {
        method: "POST",
        body: JSON.stringify({
          type: "postcard.updated",
          data: { id: "pc_1", status: "completed", metadata: { handle: rec.handle } },
        }),
      }),
      makeEnv(kv),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, status: "delivered" });
    expect(JSON.parse(kv.map.get(`biz:${rec.handle}`)!).mail.status).toBe("delivered");
  });

  it("rejects a wrong webhook secret with 401", async () => {
    const res = await worker.fetch(
      new Request("https://oktryme.com/postgrid/webhook", {
        method: "POST",
        headers: { "x-webhook-secret": "nope" },
        body: JSON.stringify({ data: {} }),
      }),
      makeEnv(fakeKV(), { POSTGRID_WEBHOOK_SECRET: "right" }),
    );
    expect(res.status).toBe(401);
  });

  it("accepts the secret via the ?secret= query param (PostGrid's mechanism)", async () => {
    const rec = sampleBusiness();
    const kv = fakeKV({ [`biz:${rec.handle}`]: rec });
    const res = await worker.fetch(
      new Request("https://oktryme.com/postgrid/webhook?secret=right", {
        method: "POST",
        body: JSON.stringify({
          type: "postcard.updated",
          data: { id: "pc_1", status: "completed", metadata: { handle: rec.handle } },
        }),
      }),
      makeEnv(kv, { POSTGRID_WEBHOOK_SECRET: "right" }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, status: "delivered" });
  });
});
