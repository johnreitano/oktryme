import type { LeadEmailSender, LeadEmailArgs } from "./form.js";
import { escapeHtml } from "../render/renderer.js";

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export interface ResendConfig {
  apiKey: string;
  /** Verified sender, e.g. "OK Try Me <leads@oktryme.com>". */
  from: string;
  /** Where to send if a business has no email on file (ops inbox). */
  fallbackTo?: string;
  fetchImpl?: FetchLike;
  baseUrl?: string;
}

export class ResendError extends Error {}

const RESEND_BASE = "https://api.resend.com";

/**
 * Outbound lead notifications via Resend (V5). Inbound/forwarding is handled
 * separately by Cloudflare Email Routing — Resend is send-only (§5a D).
 */
export class ResendSender implements LeadEmailSender {
  private fetch: FetchLike;
  private base: string;

  constructor(private cfg: ResendConfig) {
    this.fetch = cfg.fetchImpl ?? ((u, i) => fetch(u, i));
    this.base = cfg.baseUrl ?? RESEND_BASE;
  }

  async send(args: LeadEmailArgs): Promise<void> {
    const to = args.toEmail ?? this.cfg.fallbackTo;
    if (!to) {
      throw new ResendError(
        `No destination email for lead on ${args.fromHandle} and no fallbackTo configured`,
      );
    }

    const { name, phone, message } = args.lead;
    const subject = `New quote request for ${args.toBusinessName}`;
    const html = `
      <h2>New quote request</h2>
      <p>Someone requested a quote via your website.</p>
      <ul>
        <li><strong>Name:</strong> ${escapeHtml(name)}</li>
        <li><strong>Phone:</strong> <a href="tel:${escapeHtml(phone)}">${escapeHtml(phone)}</a></li>
      </ul>
      <p><strong>Message:</strong><br>${escapeHtml(message)}</p>`;

    const res = await this.fetch(`${this.base}/emails`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.cfg.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ from: this.cfg.from, to, subject, html }),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new ResendError(`Resend send failed (${res.status}): ${detail}`);
    }
  }
}
