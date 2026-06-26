import type { Store } from "../store.js";
import type { OpsNotifier } from "../notify/ops.js";
import { escapeHtml } from "../render/renderer.js";

/**
 * Done-for-you intake (§6, the $99 tier) — a bridge until the Phase-6 self-serve
 * AI editor ships. An active customer submits a change request; we route it to
 * ops by email so a human applies it via the same edit engine (V4). Only active
 * subscribers can file a request; the customer's plan is surfaced so ops can
 * prioritize $99 (done-for-you) requests and nudge $49 (self-serve) ones toward
 * the editor / upgrade.
 */
export async function handleDfyRequest(
  handle: string,
  form: FormData,
  store: Store,
  ops: OpsNotifier,
): Promise<{ ok: boolean; error?: string }> {
  const rec = await store.get(handle);
  if (!rec) return { ok: false, error: "unknown business" };
  if (rec.status !== "active") {
    return { ok: false, error: "no active subscription" };
  }

  const message = String(form.get("message") ?? "").trim();
  if (!message) return { ok: false, error: "missing message" };

  await ops.notify({
    subject: `Change request (${rec.plan}) — ${rec.business.name}`,
    html: `
      <h2>Done-for-you change request</h2>
      <ul>
        <li><strong>Business:</strong> ${escapeHtml(rec.business.name)}</li>
        <li><strong>Handle:</strong> ${escapeHtml(handle)}</li>
        <li><strong>Plan:</strong> ${escapeHtml(rec.plan)}</li>
        ${rec.domain ? `<li><strong>Domain:</strong> ${escapeHtml(rec.domain)}</li>` : ""}
      </ul>
      <p><strong>Requested change:</strong><br>${escapeHtml(message)}</p>`,
  });
  return { ok: true };
}
