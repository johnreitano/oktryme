import { describe, expect, it } from "vitest";
import {
  composePrompt,
  generateImage,
  parseGeminiImageResponse,
  uploadImage,
} from "../src/images/generate.js";
import { fullImagePrompt, heroKeyForTheme, IMAGE_PROMPTS } from "../src/images/prompts.js";

// Tiny 1x1 PNG, base64.
const PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

describe("prompts", () => {
  it("has a prompt for every theme with overlay/realism constraints", () => {
    for (const theme of ["auto", "hvac", "landscaping", "universal"] as const) {
      const p = IMAGE_PROMPTS[theme];
      expect(p.prompt.length).toBeGreaterThan(100);
      const full = fullImagePrompt(theme);
      // Shared avoid list folds in (no text/logos so the overlay reads cleanly).
      expect(full.negative).toMatch(/logo|text/);
    }
  });
  it("derives a stable hero R2 key per theme", () => {
    expect(heroKeyForTheme("auto")).toBe("trade/auto/hero.jpg");
  });
});

describe("composePrompt", () => {
  it("folds the avoid list into the prompt text", () => {
    const text = composePrompt({ prompt: "A garage.", negative: "neon, text" });
    expect(text).toContain("A garage.");
    expect(text).toContain("Avoid: neon, text.");
  });
});

describe("parseGeminiImageResponse", () => {
  it("extracts inline image bytes (camelCase)", () => {
    const img = parseGeminiImageResponse({
      candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/png", data: PNG_B64 } }] } }],
    });
    expect(img.mimeType).toBe("image/png");
    expect(img.bytes.length).toBeGreaterThan(0);
    expect(img.bytes[0]).toBe(0x89); // PNG magic byte
  });

  it("tolerates snake_case inline_data", () => {
    const img = parseGeminiImageResponse({
      candidates: [{ content: { parts: [{ inline_data: { mime_type: "image/jpeg", data: PNG_B64 } }] } }],
    });
    expect(img.mimeType).toBe("image/jpeg");
  });

  it("throws when no image part is present", () => {
    expect(() => parseGeminiImageResponse({ candidates: [{ content: { parts: [{}] } }] })).toThrow(
      /no inline image/,
    );
  });
});

describe("generateImage", () => {
  it("POSTs to the Nano Banana Pro model and returns parsed bytes", async () => {
    let calledUrl = "";
    const fetchImpl = (async (url: string) => {
      calledUrl = url;
      return new Response(
        JSON.stringify({
          candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/png", data: PNG_B64 } }] } }],
        }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;

    const img = await generateImage("a garage", { apiKey: "k", fetchImpl });
    expect(img.bytes.length).toBeGreaterThan(0);
    expect(calledUrl).toContain("gemini-3-pro-image:generateContent");
    expect(calledUrl).toContain("key=k");
  });

  it("throws on a non-OK response", async () => {
    const fetchImpl = (async () => new Response("nope", { status: 429 })) as unknown as typeof fetch;
    await expect(generateImage("x", { apiKey: "k", fetchImpl })).rejects.toThrow(/Gemini 429/);
  });
});

describe("uploadImage", () => {
  it("puts bytes into the bucket with the content type", async () => {
    const puts: Array<{ key: string; opts: unknown }> = [];
    const bucket = {
      put: async (key: string, _body: unknown, opts: unknown) => {
        puts.push({ key, opts });
      },
    } as unknown as R2Bucket;
    await uploadImage(bucket, "trade/auto/hero.jpg", {
      bytes: new Uint8Array([1, 2, 3]),
      mimeType: "image/png",
    });
    expect(puts[0].key).toBe("trade/auto/hero.jpg");
    expect(puts[0].opts).toMatchObject({ httpMetadata: { contentType: "image/png" } });
  });
});
