import { describe, it, expect } from "vitest";
import { renderQrSvg, scanUrl } from "../src/outreach/qr.js";

describe("scanUrl", () => {
  it("builds the /r short link the QR must encode", () => {
    expect(scanUrl("oktryme.com", "joes-auto")).toBe("https://oktryme.com/r/joes-auto");
  });
});

describe("renderQrSvg", () => {
  it("produces a self-contained SVG with a dark-module path", () => {
    const svg = renderQrSvg("https://oktryme.com/r/joes-auto");
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(svg).toContain("viewBox=");
    expect(svg).toContain("<path");
    expect(svg).toContain("</svg>");
  });

  it("is deterministic for the same input and differs across inputs", () => {
    expect(renderQrSvg("https://oktryme.com/r/a")).toBe(renderQrSvg("https://oktryme.com/r/a"));
    expect(renderQrSvg("https://oktryme.com/r/a")).not.toBe(renderQrSvg("https://oktryme.com/r/b"));
  });

  it("includes a quiet-zone margin in the viewBox (≥ module count)", () => {
    const svg = renderQrSvg("x");
    const m = svg.match(/viewBox="0 0 (\d+) \1"/);
    expect(m).not.toBeNull();
    // A version-1 QR is 21 modules; with margin 4 each side the canvas is ≥ 29.
    expect(Number(m![1])).toBeGreaterThanOrEqual(29);
  });
});
