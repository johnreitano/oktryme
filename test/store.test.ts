import { describe, it, expect, vi } from "vitest";
import { KVStore } from "../src/store.js";
import { ValidationError } from "../src/validate.js";
import { sampleBusiness } from "./helpers.js";

// Minimal in-memory KVNamespace stand-in — only the methods KVStore uses.
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
  } as unknown as KVNamespace & { map: Map<string, string> };
}

describe("KVStore (Phase 1 validation + createdAt)", () => {
  it("stamps createdAt on first write and preserves it after", async () => {
    const kv = fakeKV();
    const store = new KVStore(kv);
    const rec = sampleBusiness();
    expect(rec.createdAt).toBeUndefined();

    await store.put(rec);
    const stored = await store.get(rec.handle);
    expect(stored?.createdAt).toBeTruthy();

    const created = stored!.createdAt;
    await store.put(stored!); // re-write
    const again = await store.get(rec.handle);
    expect(again?.createdAt).toBe(created); // unchanged
  });

  it("maps domain → handle on put when a domain is present", async () => {
    const kv = fakeKV();
    const store = new KVStore(kv);
    const rec = sampleBusiness();
    rec.domain = "Joes-Auto.com";
    await store.put(rec);
    expect(await store.resolveDomain("joes-auto.com")).toBe(rec.handle);
  });

  it("rejects an invalid record on put", async () => {
    const store = new KVStore(fakeKV());
    const bad = sampleBusiness() as unknown as Record<string, unknown>;
    delete bad.handle;
    await expect(store.put(bad as never)).rejects.toBeInstanceOf(ValidationError);
  });

  it("returns null and logs when a stored record is corrupt", async () => {
    const kv = fakeKV();
    const store = new KVStore(kv);
    kv.map.set("biz:broken", JSON.stringify({ handle: "broken" })); // missing fields
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await store.get("broken");
    expect(result).toBeNull();
    expect(spy).toHaveBeenCalledOnce();
    spy.mockRestore();
  });
});
