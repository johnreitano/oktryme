import type { Store } from "../store.js";

export interface LeadEmailSender {
  /** Send a lead notification to the business. Real impl: Resend/Postmark (V5). */
  send(args: {
    toBusinessName: string;
    fromHandle: string;
    lead: { name: string; phone: string; message: string };
  }): Promise<void>;
}

/** No-op sender for spikes without an email provider configured (V5 wires the real one). */
export class LogSender implements LeadEmailSender {
  sent: unknown[] = [];
  async send(args: Parameters<LeadEmailSender["send"]>[0]): Promise<void> {
    this.sent.push(args);
  }
}

/** Parse + validate a contact-form submission and notify the business. */
export async function handleLead(
  handle: string,
  form: FormData,
  store: Store,
  sender: LeadEmailSender,
): Promise<{ ok: boolean; error?: string }> {
  const rec = await store.get(handle);
  if (!rec) return { ok: false, error: "unknown business" };

  const name = String(form.get("name") ?? "").trim();
  const phone = String(form.get("phone") ?? "").trim();
  const message = String(form.get("message") ?? "").trim();
  if (!name || !phone || !message) {
    return { ok: false, error: "missing fields" };
  }

  await sender.send({
    toBusinessName: rec.business.name,
    fromHandle: handle,
    lead: { name, phone, message },
  });
  return { ok: true };
}
