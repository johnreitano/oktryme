import { describe, it, expect } from "vitest";
import { CloudflareProvisioner } from "../src/provisioning/cloudflare.js";

// Minimal ambient decl so this Node-run live probe typechecks without @types/node.
declare const process: { env: Record<string, string | undefined> };

/**
 * V1/V2 LIVE read-only probe (Phase 0). Hits the real Cloudflare API with the
 * scoped `oktryme-provisioner` token to confirm, WITHOUT spending money:
 *   - V2  — Registrar `domain-check` works + the beta response shape matches
 *           what `CloudflareProvisioner.isAvailable` parses; surfaces pricing.
 *   - V1  — Registrar domains land as a zone in our account (zone read);
 *           Workers Custom Domains are visible/manageable via API (workers read).
 *
 * Read-only by construction: only GETs + the read-only `domain-check` POST are
 * made here — no register/attach call. (The runtime token now carries Registrar
 * Admin + Zone/DNS/SSL write for the real write path, so safety here comes from
 * what this probe does, not from the token scope.) The write path
 * (register → attach → DNS + SSL) is exercised separately in V1-live (Phase 4).
 *
 * Skips automatically when CF creds aren't present (CI / no-cred runs).
 */

// Env-gated so plain `npm test` / CI skip the live calls. Run explicitly with:
//   set -a; . ./.dev.vars; set +a; npx vitest run test/v1-probe.live.test.ts
function loadCfCreds(): { accountId: string; apiToken: string } | null {
  const accountId = process.env.CF_ACCOUNT_ID ?? "";
  const apiToken = process.env.CF_API_TOKEN ?? "";
  return accountId && apiToken ? { accountId, apiToken } : null;
}

const creds = loadCfCreds();
const CF_BASE = "https://api.cloudflare.com/client/v4";

/** Tiny read-only GET helper (mirrors the provisioner's envelope handling). */
async function cfGet(path: string): Promise<{ status: number; body: any }> {
  const res = await fetch(`${CF_BASE}${path}`, {
    headers: { Authorization: `Bearer ${creds!.apiToken}` },
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

describe.skipIf(!creds)("V1/V2 live read-only probe", () => {
  const prov = () =>
    new CloudflareProvisioner({
      accountId: creds!.accountId,
      apiToken: creds!.apiToken,
      workerService: process.env.CF_WORKER_SERVICE ?? "maps-website-builder",
    });

  it("V2: domain-check returns availability for a likely-free .com (real beta shape)", async () => {
    const candidate = "oktryme-v1probe-7x29q.com";
    // Raw POST first so we can SEE the real beta response shape + any pricing.
    const res = await fetch(
      `${CF_BASE}/accounts/${creds!.accountId}/registrar/domain-check`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${creds!.apiToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ domains: [candidate] }),
      },
    );
    const body = (await res.json()) as any;
    console.log("[V2] domain-check status:", res.status);
    console.log("[V2] domain-check body:", JSON.stringify(body, null, 2));
    expect(res.status).toBeLessThan(400);
    expect(body.success).toBe(true);

    // Now confirm the provisioner's parser agrees with the live shape.
    const available = await prov().isAvailable(candidate);
    console.log(`[V2] isAvailable(${candidate}) ->`, available);
    expect(typeof available).toBe("boolean");
  });

  it("V2: a known-taken domain reports unavailable", async () => {
    const res = await fetch(
      `${CF_BASE}/accounts/${creds!.accountId}/registrar/domain-check`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${creds!.apiToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ domains: ["google.com"] }),
      },
    );
    const body = (await res.json()) as any;
    console.log("[V2] domain-check(google.com) body:", JSON.stringify(body, null, 2));
    const available = await prov().isAvailable("google.com");
    console.log("[V2] isAvailable(google.com) ->", available);
    expect(available).toBe(false);
  });

  it("V1: zone-read works on the dedicated account (zone read)", async () => {
    // Dedicated account starts intentionally empty: oktryme.com still lives in the
    // old account (Phase B inter-account transfer), and a throwaway .com registered
    // in V1-live is what first populates a zone here. So we assert the zone-read
    // token scope works, not that any specific zone exists yet.
    const { status, body } = await cfGet(`/zones?account.id=${creds!.accountId}`);
    console.log("[V1] zones status:", status);
    console.log(
      "[V1] zone result:",
      JSON.stringify(body.result?.map((z: any) => ({ id: z.id, name: z.name, status: z.status })), null, 2),
    );
    expect(status).toBeLessThan(400);
    expect(body.success).toBe(true);
    expect(Array.isArray(body.result)).toBe(true);
  });

  it("V1: Workers Custom Domains are listable + the account is clean (workers read)", async () => {
    const { status, body } = await cfGet(
      `/accounts/${creds!.accountId}/workers/domains`,
    );
    console.log("[V1] workers/domains status:", status);
    console.log(
      "[V1] current custom domains:",
      JSON.stringify(body.result?.map((d: any) => ({ hostname: d.hostname, service: d.service })), null, 2),
    );
    expect(status).toBeLessThan(400);
    expect(body.success).toBe(true);
    expect(Array.isArray(body.result)).toBe(true);
    // The point of the dedicated account: zero pre-existing custom domains (no
    // unrelated `multiplytech` domains the token could touch). Starts empty.
    expect(body.result.length).toBe(0);
  });
});
