import { describe, it, expect } from "vitest";
import { resolveImageUrl, serveImage } from "../src/images/r2.js";

describe("resolveImageUrl", () => {
  it("returns undefined for a missing value", () => {
    expect(resolveImageUrl(undefined)).toBeUndefined();
    expect(resolveImageUrl("")).toBeUndefined();
  });

  it("passes through absolute URLs and root-relative paths", () => {
    expect(resolveImageUrl("https://cdn.example.com/h.jpg")).toBe(
      "https://cdn.example.com/h.jpg",
    );
    expect(resolveImageUrl("/static/h.png")).toBe("/static/h.png");
  });

  it("treats anything else as an R2 key served at /img/, preserving slashes", () => {
    expect(resolveImageUrl("auto/hero.png")).toBe("/img/auto/hero.png");
  });

  it("encodes special characters within each key segment", () => {
    expect(resolveImageUrl("category/auto repair/hero 01.png")).toBe(
      "/img/category/auto%20repair/hero%2001.png",
    );
  });
});

/** Minimal R2 stand-in: only the bits serveImage touches. */
function fakeBucket(store: Record<string, string>): R2Bucket {
  return {
    get: async (key: string) => {
      if (!(key in store)) return null;
      return {
        body: store[key],
        httpEtag: '"etag123"',
        writeHttpMetadata: (h: Headers) => h.set("content-type", "image/png"),
      };
    },
  } as unknown as R2Bucket;
}

describe("serveImage", () => {
  it("serves an existing object with caching headers", async () => {
    const res = await serveImage(fakeBucket({ "auto/hero.png": "PNGDATA" }), "auto/hero.png");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("etag")).toBe('"etag123"');
    expect(res.headers.get("cache-control")).toContain("immutable");
    expect(await res.text()).toBe("PNGDATA");
  });

  it("404s when the object is absent", async () => {
    const res = await serveImage(fakeBucket({}), "missing.png");
    expect(res.status).toBe(404);
  });
});
