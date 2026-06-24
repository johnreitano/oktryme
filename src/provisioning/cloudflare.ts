import { type Provisioner, ProvisionError } from "./provision.js";

/**
 * Real Cloudflare provisioner — implements the same `Provisioner` seam the
 * Stripe flow already uses (V3), so wiring it in is a one-line swap (V1).
 *
 * Endpoints (verified against developers.cloudflare.com, June 2026):
 *   - Registrar API (beta):
 *       POST /accounts/{acct}/registrar/domain-check
 *       POST /accounts/{acct}/registrar/registrations            -> 201 done | 202 in-progress
 *       GET  /accounts/{acct}/registrar/registrations/{name}/registration-status
 *   - Zones:    GET/POST /zones
 *   - Workers Custom Domains:
 *       PUT  /accounts/{acct}/workers/domains
 *
 * ⚠️ The Registrar API is beta: the exact `domain-check` body and the
 * registration polling states are confirmed in spike V1/V2 against a live
 * token. Each call is isolated so a shape fix is local.
 */

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export interface CloudflareConfig {
  accountId: string;
  apiToken: string;
  /** Worker service name to attach custom domains to. */
  workerService: string;
  /** Worker environment (omit for top-level). */
  environment?: string;
  /** Auto-renew registered domains (default true — we hold them, §4). */
  autoRenew?: boolean;
  /** Injected for tests; defaults to global fetch. */
  fetchImpl?: FetchLike;
  /** Registration poll cadence + ceiling. */
  pollIntervalMs?: number;
  maxPollMs?: number;
  /** API base (override in tests). */
  baseUrl?: string;
}

export class CloudflareApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly errors?: unknown,
  ) {
    super(message);
  }
}

interface CfEnvelope<T> {
  success: boolean;
  result: T;
  errors?: unknown;
  messages?: unknown;
}

const CF_BASE = "https://api.cloudflare.com/client/v4";

export class CloudflareProvisioner implements Provisioner {
  private fetch: FetchLike;
  private base: string;
  private pollIntervalMs: number;
  private maxPollMs: number;

  constructor(private cfg: CloudflareConfig) {
    this.fetch = cfg.fetchImpl ?? ((u, i) => fetch(u, i));
    this.base = cfg.baseUrl ?? CF_BASE;
    this.pollIntervalMs = cfg.pollIntervalMs ?? 2000;
    this.maxPollMs = cfg.maxPollMs ?? 60_000;
  }

  /** Low-level call. Returns status + parsed body; throws on >= 400. */
  private async cf<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<{ status: number; body: CfEnvelope<T> }> {
    const res = await this.fetch(`${this.base}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.cfg.apiToken}`,
        "content-type": "application/json",
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const json = (await res.json().catch(() => ({}))) as CfEnvelope<T>;
    if (res.status >= 400 || json.success === false) {
      throw new CloudflareApiError(
        `Cloudflare ${method} ${path} failed (${res.status})`,
        res.status,
        json.errors,
      );
    }
    return { status: res.status, body: json };
  }

  private get acct(): string {
    return `/accounts/${this.cfg.accountId}`;
  }

  // ---- Registrar ----

  /** Best-effort availability check (beta `domain-check`). */
  async isAvailable(domain: string): Promise<boolean> {
    try {
      const { body } = await this.cf<Array<{ domain_name?: string; available?: boolean }>>(
        "POST",
        `${this.acct}/registrar/domain-check`,
        { domains: [domain] },
      );
      const entry = Array.isArray(body.result)
        ? body.result.find((r) => r.domain_name === domain) ?? body.result[0]
        : undefined;
      // If we can't parse a definitive answer, assume available and let the
      // registration call be the source of truth (it'll fail → we walk on).
      return entry?.available ?? true;
    } catch {
      return true;
    }
  }

  /** Register a single domain; resolves true only on terminal success. */
  private async register(domain: string): Promise<boolean> {
    const { status, body } = await this.cf<{ status?: string }>(
      "POST",
      `${this.acct}/registrar/registrations`,
      { domain_name: domain, auto_renew: this.cfg.autoRenew ?? true },
    );
    if (status === 201) return true; // completed immediately
    if (status === 202) return this.pollRegistration(domain); // workflow in progress
    // Any other 2xx with a terminal status in the body:
    return body.result?.status === "succeeded";
  }

  private async pollRegistration(domain: string): Promise<boolean> {
    const deadline = this.maxPollMs;
    let waited = 0;
    for (;;) {
      await sleep(this.pollIntervalMs);
      waited += this.pollIntervalMs;
      const { body } = await this.cf<{ status: string }>(
        "GET",
        `${this.acct}/registrar/registrations/${encodeURIComponent(domain)}/registration-status`,
      );
      const state = body.result?.status;
      if (state === "succeeded") return true;
      if (state === "failed" || state === "blocked") return false;
      if (state === "action_required") {
        throw new ProvisionError(
          `Registration for ${domain} needs manual action (action_required)`,
        );
      }
      if (waited >= deadline) {
        throw new ProvisionError(`Registration for ${domain} timed out`);
      }
    }
  }

  async registerDomain(
    _handle: string,
    preferred: string,
    backups: string[],
  ): Promise<{ domain: string }> {
    for (const candidate of [preferred, ...backups]) {
      if (!(await this.isAvailable(candidate))) continue;
      try {
        if (await this.register(candidate)) return { domain: candidate };
      } catch (err) {
        if (err instanceof ProvisionError) throw err; // action_required, etc.
        // Otherwise a race/transient registrar error — try the next candidate.
      }
    }
    throw new ProvisionError(
      `Could not register any candidate domain (tried ${[preferred, ...backups].join(", ")})`,
    );
  }

  // ---- Zones + Workers Custom Domains ----

  /** Find the zone for a domain we hold, creating it if registration didn't. */
  private async ensureZone(
    domain: string,
  ): Promise<{ zoneId: string; zoneName: string }> {
    const { body } = await this.cf<Array<{ id: string; name: string }>>(
      "GET",
      `/zones?name=${encodeURIComponent(domain)}&account.id=${this.cfg.accountId}`,
    );
    if (Array.isArray(body.result) && body.result.length > 0) {
      return { zoneId: body.result[0].id, zoneName: body.result[0].name };
    }
    const created = await this.cf<{ id: string; name: string }>("POST", `/zones`, {
      name: domain,
      account: { id: this.cfg.accountId },
    });
    return { zoneId: created.body.result.id, zoneName: created.body.result.name };
  }

  private async attachHostname(
    hostname: string,
    zoneId: string,
    zoneName: string,
  ): Promise<void> {
    await this.cf("PUT", `${this.acct}/workers/domains`, {
      hostname,
      service: this.cfg.workerService,
      zone_id: zoneId,
      zone_name: zoneName,
      ...(this.cfg.environment ? { environment: this.cfg.environment } : {}),
    });
  }

  /** Attach apex + www as Workers Custom Domains (auto DNS + edge TLS). */
  async attachCustomDomain(domain: string): Promise<void> {
    const { zoneId, zoneName } = await this.ensureZone(domain);
    await this.attachHostname(domain, zoneId, zoneName);
    await this.attachHostname(`www.${domain}`, zoneId, zoneName);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
