import { describe, it, expect } from "vitest";
import worker from "../src/index.js";

/** Minimal Env: only the bindings the routes under test actually touch. */
function makeEnv(images: Record<string, string> = {}): any {
  return {
    BUSINESS_KV: { get: async () => null }, // no record → routes fall through to 404
    PREVIEW_HOST: "oktryme.com",
    IMAGES: {
      get: async (key: string) => {
        if (!(key in images)) return null;
        return {
          body: images[key],
          httpEtag: '"e"',
          writeHttpMetadata: (h: Headers) => h.set("content-type", "image/png"),
        };
      },
    },
  };
}

describe("www → apex redirect (Phase 2)", () => {
  it("301s www on a live custom domain to the apex, preserving the path", async () => {
    const res = await worker.fetch(
      new Request("https://www.joesauto.com/services?x=1"),
      makeEnv(),
    );
    expect(res.status).toBe(301);
    expect(res.headers.get("location")).toBe("https://joesauto.com/services?x=1");
  });

  it("does NOT redirect the preview host's own www", async () => {
    const res = await worker.fetch(
      new Request("https://www.oktryme.com/p/nope"),
      makeEnv(),
    );
    expect(res.status).not.toBe(301);
  });
});

describe("brand landing page (preview host root)", () => {
  it("serves the landing page at the preview host root", async () => {
    const res = await worker.fetch(new Request("https://oktryme.com/"), makeEnv());
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Ok, Try Me");
    expect(html).toContain("High-Performance Business Websites");
    expect(html).toContain("hello@oktryme.com");
    expect(html).toContain("Multiply Technologies LLC DBA Ok, Try Me");
  });

  it("does not serve the landing page at the root of a non-preview host", async () => {
    const res = await worker.fetch(new Request("https://joesauto.com/"), makeEnv());
    expect(res.status).not.toBe(200);
  });
});

describe("/img R2 route (Phase 2)", () => {
  it("serves an existing image from the IMAGES bucket", async () => {
    const res = await worker.fetch(
      new Request("https://oktryme.com/img/auto/hero.png"),
      makeEnv({ "auto/hero.png": "PNGDATA" }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(await res.text()).toBe("PNGDATA");
  });

  it("decodes encoded key segments back to the stored key", async () => {
    const res = await worker.fetch(
      new Request("https://oktryme.com/img/auto/hero%2001.png"),
      makeEnv({ "auto/hero 01.png": "PNGDATA" }),
    );
    expect(res.status).toBe(200);
  });

  it("404s for a missing image", async () => {
    const res = await worker.fetch(
      new Request("https://oktryme.com/img/missing.png"),
      makeEnv(),
    );
    expect(res.status).toBe(404);
  });
});
