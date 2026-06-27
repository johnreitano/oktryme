// QR-code rendering for postcards (§1C of PLAN.md).
//
// The QR encodes our branded short link `https://{host}/r/{handle}`, NOT the
// preview URL directly — so every scan lands on `/r/{handle}` first, which logs
// the scan (the channel's conversion event) before 302-ing to the preview. That
// indirection is the whole reason we self-host the image: it keeps scan
// attribution ours regardless of the print provider.
//
// We render scalable vector SVG (not raster) — it prints razor-sharp at any
// postcard DPI and the bytes are tiny. Encoding correctness is delegated to the
// vetted `qrcode-generator` library (the one runtime dependency); the SVG markup
// is ours so we control the quiet zone and keep the output dependency-light.

import qrcode from "qrcode-generator";

/** The short-link a postcard's QR points at — must match the `/r/{handle}` route. */
export function scanUrl(host: string, handle: string): string {
  return `https://${host}/r/${handle}`;
}

/**
 * Render `text` as a QR code in a self-contained SVG document.
 * Error-correction level M (~15% recovery) balances density vs. print
 * robustness; the version (size) auto-selects to fit the data. `margin` is the
 * quiet-zone width in modules (the spec requires ≥4 for reliable scanning).
 */
export function renderQrSvg(text: string, margin = 4): string {
  const qr = qrcode(0, "M");
  qr.addData(text);
  qr.make();

  const count = qr.getModuleCount();
  const dim = count + margin * 2;

  // One <path> of all dark modules: cheaper than thousands of <rect>s and lets
  // the QR scale crisply via the viewBox. Each module is a 1×1 unit square.
  let path = "";
  for (let row = 0; row < count; row++) {
    for (let col = 0; col < count; col++) {
      if (qr.isDark(row, col)) {
        path += `M${col + margin} ${row + margin}h1v1h-1z`;
      }
    }
  }

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${dim} ${dim}" ` +
    `shape-rendering="crispEdges" role="img" aria-label="QR code">` +
    `<rect width="${dim}" height="${dim}" fill="#fff"/>` +
    `<path d="${path}" fill="#000"/>` +
    `</svg>`
  );
}
