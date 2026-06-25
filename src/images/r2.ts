// R2 image pipeline (Phase 2, §3a/§6 of PLAN.md).
//
// Imagery is licensed/AI-generated category stock or customer uploads — NEVER
// Google Maps photos (§11). Generation is deferred to a post-Phase-2 step using
// Google Nano Banana Pro (Gemini API); this module is the serving/resolution
// side, ready to receive those assets into the IMAGES bucket.

/**
 * Turn a stored `images.*` value into a URL the page can load.
 * - Absolute URLs (`https://…`) and root-relative paths (`/…`) pass through.
 * - Anything else is treated as an R2 object key, served by the Worker at
 *   `/img/{key}` (see `serveImage`). Each path segment is encoded so keys with
 *   spaces or unusual characters stay valid in the URL.
 */
export function resolveImageUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  if (/^https?:\/\//i.test(value) || value.startsWith("/")) return value;
  const encoded = value.split("/").map(encodeURIComponent).join("/");
  return `/img/${encoded}`;
}

/** Serve an object from the IMAGES R2 bucket, or 404 if it's absent. */
export async function serveImage(
  bucket: R2Bucket,
  key: string,
): Promise<Response> {
  const object = await bucket.get(key);
  if (!object) return new Response("Not found", { status: 404 });

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  // Site imagery is immutable once generated; cache hard at the edge + browser.
  headers.set("cache-control", "public, max-age=86400, immutable");
  return new Response(object.body, { headers });
}
