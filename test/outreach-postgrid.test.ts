import { describe, it, expect, vi } from "vitest";
import {
  mapPostgridStatus,
  sendPostcard,
  handlePostgridWebhook,
} from "../src/outreach/postgrid.js";
import { buildPostcardPayload, type PostcardAddress } from "../src/outreach/postcard.js";
import { MemoryStore } from "../src/store.js";
import { sampleBusiness } from "./helpers.js";

const FROM: PostcardAddress = {
  companyName: "Multiply Technologies LLC",
  addressLine1: "1 Registered Agent Way",
  city: "Sheridan",
  provinceOrState: "WY",
  postalOrZip: "82801",
  country: "US",
};

describe("mapPostgridStatus", () => {
  it("maps the PostGrid lifecycle to our MailStatus", () => {
    expect(mapPostgridStatus("ready")).toBe("mailed");
    expect(mapPostgridStatus("printing")).toBe("mailed");
    expect(mapPostgridStatus("processed_for_delivery")).toBe("in_transit");
    expect(mapPostgridStatus("completed")).toBe("delivered");
    expect(mapPostgridStatus("returned_to_sender")).toBe("returned");
    expect(mapPostgridStatus("cancelled")).toBe("failed");
    expect(mapPostgridStatus(undefined)).toBe("mailed");
    expect(mapPostgridStatus("brand_new_status")).toBe("mailed");
  });
});

describe("sendPostcard", () => {
  it("POSTs the payload with auth + idempotency headers and returns id+status", async () => {
    const rec = sampleBusiness();
    const payload = buildPostcardPayload(rec, { host: "oktryme.com", from: FROM });
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ id: "postcard_123", status: "ready" }), { status: 200 }),
    ) as unknown as typeof fetch;

    const res = await sendPostcard(payload, { apiKey: "test_sk_abc", fetchImpl });
    expect(res).toEqual({ id: "postcard_123", status: "mailed" });

    const [url, init] = (fetchImpl as any).mock.calls[0];
    expect(url).toContain("/postcards");
    expect(init.headers["x-api-key"]).toBe("test_sk_abc");
    expect(init.headers["Idempotency-Key"]).toBe(rec.handle);
    expect(JSON.parse(init.body).metadata.handle).toBe(rec.handle);
  });

  it("throws on a non-2xx response", async () => {
    const rec = sampleBusiness();
    const payload = buildPostcardPayload(rec, { host: "oktryme.com", from: FROM });
    const fetchImpl = vi.fn(async () => new Response("bad", { status: 422 })) as unknown as typeof fetch;
    await expect(sendPostcard(payload, { apiKey: "k", fetchImpl })).rejects.toThrow(/422/);
  });

  it("throws when the response has no postcard id", async () => {
    const rec = sampleBusiness();
    const payload = buildPostcardPayload(rec, { host: "oktryme.com", from: FROM });
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ status: "ready" }), { status: 200 })) as unknown as typeof fetch;
    await expect(sendPostcard(payload, { apiKey: "k", fetchImpl })).rejects.toThrow(/missing postcard id/);
  });
});

describe("handlePostgridWebhook", () => {
  it("folds a delivery event onto the matching record's mail status", async () => {
    const store = new MemoryStore();
    const rec = sampleBusiness();
    await store.put(rec);

    const result = await handlePostgridWebhook(
      {
        type: "postcard.updated",
        data: { id: "postcard_123", status: "completed", metadata: { handle: rec.handle } },
      },
      store,
    );
    expect(result).toMatchObject({ ok: true, handle: rec.handle, status: "delivered" });

    const updated = await store.get(rec.handle);
    expect(updated!.mail!.status).toBe("delivered");
    expect(updated!.mail!.provider).toBe("postgrid");
    expect(updated!.mail!.providerId).toBe("postcard_123");
    expect(updated!.mail!.mailedAt).toBeTruthy();
  });

  it("handles a flat event payload (postcard fields at the top level)", async () => {
    const store = new MemoryStore();
    const rec = sampleBusiness();
    await store.put(rec);

    const result = await handlePostgridWebhook(
      { id: "pc_9", status: "processed_for_delivery", metadata: { handle: rec.handle } },
      store,
    );
    expect(result).toMatchObject({ ok: true, handle: rec.handle, status: "in_transit" });
    expect((await store.get(rec.handle))!.mail!.status).toBe("in_transit");
  });

  it("rejects an event with no handle in metadata", async () => {
    const store = new MemoryStore();
    const res = await handlePostgridWebhook({ data: { id: "x", status: "ready" } }, store);
    expect(res.ok).toBe(false);
  });

  it("reports an unknown handle without throwing", async () => {
    const store = new MemoryStore();
    const res = await handlePostgridWebhook(
      { data: { id: "x", status: "ready", metadata: { handle: "ghost" } } },
      store,
    );
    expect(res).toMatchObject({ ok: false, handle: "ghost" });
  });
});
