import { describe, it, expect } from "vitest";
import { KVStore, MemoryStore } from "../src/store.js";

// Fake KVNamespace with the list/get/put surface getScans needs.
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
    async list({ prefix }: { prefix?: string } = {}) {
      const keys = [...map.keys()]
        .filter((k) => !prefix || k.startsWith(prefix))
        .map((name) => ({ name }));
      return { keys, list_complete: true, cursor: "" };
    },
  } as unknown as KVNamespace & { map: Map<string, string> };
}

describe("scan logging", () => {
  it("MemoryStore appends scans and returns them time-sorted", async () => {
    const store = new MemoryStore();
    await store.logScan("joes-auto", { at: "2026-06-27T10:00:00Z", ua: "iPhone" });
    await store.logScan("joes-auto", { at: "2026-06-27T09:00:00Z", ua: "Android" });
    await store.logScan("other", { at: "2026-06-27T11:00:00Z" });

    const scans = await store.getScans("joes-auto");
    expect(scans).toHaveLength(2);
    expect(scans[0].at).toBe("2026-06-27T09:00:00Z"); // sorted ascending
    expect(scans[1].ua).toBe("iPhone");
    expect(await store.getScans("other")).toHaveLength(1);
    expect(await store.getScans("never")).toHaveLength(0);
  });

  it("KVStore writes one append-only key per scan and reads them back", async () => {
    const kv = fakeKV();
    const store = new KVStore(kv);
    await store.logScan("joes-auto", { at: "2026-06-27T10:00:00Z", ua: "iPhone" });
    await store.logScan("joes-auto", { at: "2026-06-27T10:00:01Z", ua: "iPad" });

    const scanKeys = [...kv.map.keys()].filter((k) => k.startsWith("scan:joes-auto:"));
    expect(scanKeys).toHaveLength(2); // distinct keys → no read-modify-write race
    expect(await store.getScans("joes-auto")).toHaveLength(2);
  });
});
