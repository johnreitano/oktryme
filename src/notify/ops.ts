// Internal ("ops") notifications — distinct from the customer-facing lead email
// (V5, src/lead). Used for provisioning-fallback alerts (§5a E) and the
// done-for-you intake bridge (§6) until the Phase-6 editor lands.

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export interface OpsMessage {
  subject: string;
  /** Pre-escaped HTML body (callers escape any user content). */
  html: string;
}

export interface OpsNotifier {
  notify(msg: OpsMessage): Promise<void>;
}

/** No-op notifier for spikes/tests without an email provider. Records calls. */
export class LogOpsNotifier implements OpsNotifier {
  sent: OpsMessage[] = [];
  async notify(msg: OpsMessage): Promise<void> {
    this.sent.push(msg);
  }
}

export class OpsNotifyError extends Error {}

export interface ResendOpsConfig {
  apiKey: string;
  /** Verified sender, e.g. "OK Try Me <ops@oktryme.com>". */
  from: string;
  /** Ops inbox the alerts land in. */
  to: string;
  fetchImpl?: FetchLike;
  baseUrl?: string;
}

const RESEND_BASE = "https://api.resend.com";

/** Ops alerts via Resend (reuses the V5 outbound transport, separate inbox). */
export class ResendOpsNotifier implements OpsNotifier {
  private fetch: FetchLike;
  private base: string;

  constructor(private cfg: ResendOpsConfig) {
    this.fetch = cfg.fetchImpl ?? ((u, i) => fetch(u, i));
    this.base = cfg.baseUrl ?? RESEND_BASE;
  }

  async notify({ subject, html }: OpsMessage): Promise<void> {
    const res = await this.fetch(`${this.base}/emails`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.cfg.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ from: this.cfg.from, to: this.cfg.to, subject, html }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new OpsNotifyError(`Resend ops alert failed (${res.status}): ${detail}`);
    }
  }
}
