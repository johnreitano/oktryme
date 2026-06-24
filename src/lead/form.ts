import type { Store } from "../store.js";

export interface LeadEmailArgs {
  toBusinessName: string;
  /** Business inbox to notify; falls back to ops inbox if absent. */
  toEmail?: string;
  fromHandle: string;
  lead: { name: string; phone: string; message: string };
}

export interface LeadEmailSender {
  /** Send a lead notification to the business. Real impl: Resend (V5). */
  send(args: LeadEmailArgs): Promise<void>;
}

/** No-op sender for spikes without an email provider configured. */
export class LogSender implements LeadEmailSender {
  sent: LeadEmailArgs[] = [];
  async send(args: LeadEmailArgs): Promise<void> {
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
    toEmail: rec.business.email,
    fromHandle: handle,
    lead: { name, phone, message },
  });
  return { ok: true };
}
