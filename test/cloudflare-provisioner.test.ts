import { describe, it, expect } from "vitest";
import { CloudflareProvisioner, CloudflareApiError } from "../src/provisioning/cloudflare.js";

interface Call {
  method: string;
  url: string;
  body?: any;
}

/** Build a mock fetch from a (call) → {status, json} router, recording calls. */
function mockFetch(
  router: (call: Call) => { status: number; json?: unknown },
) {
  const calls: Call[] = [];
  const fn = async (url: string, init?: RequestInit): Promise<Response> => {
    const call: Call = {
      method: init?.method ?? "GET",
      url,
      body: init?.body ? JSON.parse(init.body as string) : undefined,
    };
    calls.push(call);
    const { status, json } = router(call);
    return new Response(JSON.stringify(json ?? { success: true, result: {} }), {
      status,
    });
  };
  return { fn, calls };
}

function provisioner(fetchImpl: any, extra: Record<string, unknown> = {}) {
  return new CloudflareProvisioner({
    accountId: "acct_1",
    apiToken: "tok_1",
    workerService: "maps-website-builder",
    fetchImpl,
    pollIntervalMs: 0,
    maxPollMs: 100,
    ...extra,
  });
}

describe("V1: CloudflareProvisioner.registerDomain", () => {
  it("registers an available domain that completes immediately (201)", async () => {
    const { fn, calls } = mockFetch((c) => {
      if (c.url.includes("/domain-check"))
        return { status: 200, json: { success: true, result: { domains: [{ name: c.body.domains[0], registrable: true }] } } };
      if (c.url.includes("/registrations"))
        return { status: 201, json: { success: true, result: { status: "succeeded" } } };
      return { status: 200, json: { success: true, result: {} } };
    });
    const res = await provisioner(fn).registerDomain("joes-auto", "joesauto.com", []);
    expect(res.domain).toBe("joesauto.com");
    expect(calls.some((c) => c.method === "POST" && c.url.includes("/registrations"))).toBe(true);
  });

  it("polls a 202 workflow until succeeded", async () => {
    let polls = 0;
    const { fn } = mockFetch((c) => {
      if (c.url.includes("/domain-check"))
        return { status: 200, json: { success: true, result: { domains: [{ name: "joesauto.com", registrable: true }] } } };
      if (c.url.includes("/registration-status")) {
        polls++;
        return { status: 200, json: { success: true, result: { status: polls >= 2 ? "succeeded" : "pending" } } };
      }
      if (c.url.includes("/registrations"))
        return { status: 202, json: { success: true, result: { status: "pending" } } };
      return { status: 200, json: { success: true, result: {} } };
    });
    const res = await provisioner(fn).registerDomain("joes-auto", "joesauto.com", []);
    expect(res.domain).toBe("joesauto.com");
    expect(polls).toBeGreaterThanOrEqual(2);
  });

  it("walks to a backup when the preferred is unavailable", async () => {
    const { fn } = mockFetch((c) => {
      if (c.url.includes("/domain-check")) {
        const d = c.body.domains[0];
        return { status: 200, json: { success: true, result: { domains: [{ name: d, registrable: d !== "joesauto.com" }] } } };
      }
      if (c.url.includes("/registrations"))
        return { status: 201, json: { success: true, result: { status: "succeeded" } } };
      return { status: 200, json: { success: true, result: {} } };
    });
    const res = await provisioner(fn).registerDomain("joes-auto", "joesauto.com", ["joesauto.net"]);
    expect(res.domain).toBe("joesauto.net");
  });

  it("throws when no candidate can be registered", async () => {
    const { fn } = mockFetch((c) => {
      if (c.url.includes("/domain-check"))
        return { status: 200, json: { success: true, result: { domains: [{ name: c.body.domains[0], registrable: false }] } } };
      return { status: 200, json: { success: true, result: {} } };
    });
    await expect(provisioner(fn).registerDomain("joes-auto", "joesauto.com", ["joesauto.net"])).rejects.toThrow(/Could not register/);
  });
});

describe("V1: CloudflareProvisioner.attachCustomDomain", () => {
  it("attaches apex + www using the existing zone", async () => {
    const { fn, calls } = mockFetch((c) => {
      if (c.method === "GET" && c.url.includes("/zones?name="))
        return { status: 200, json: { success: true, result: [{ id: "zone_1", name: "joesauto.com" }] } };
      if (c.method === "PUT" && c.url.includes("/workers/domains"))
        return { status: 200, json: { success: true, result: { id: "cd_1", cert_id: "cert_1" } } };
      return { status: 200, json: { success: true, result: {} } };
    });
    await provisioner(fn).attachCustomDomain("joesauto.com");
    const attaches = calls.filter((c) => c.method === "PUT" && c.url.includes("/workers/domains"));
    expect(attaches.map((c) => c.body.hostname).sort()).toEqual(["joesauto.com", "www.joesauto.com"]);
    expect(attaches[0].body.zone_id).toBe("zone_1");
    expect(attaches[0].body.service).toBe("maps-website-builder");
  });

  it("creates the zone when registration didn't", async () => {
    const { fn, calls } = mockFetch((c) => {
      if (c.method === "GET" && c.url.includes("/zones?name="))
        return { status: 200, json: { success: true, result: [] } };
      if (c.method === "POST" && c.url.endsWith("/zones"))
        return { status: 200, json: { success: true, result: { id: "zone_new", name: "joesauto.com" } } };
      if (c.method === "PUT" && c.url.includes("/workers/domains"))
        return { status: 200, json: { success: true, result: {} } };
      return { status: 200, json: { success: true, result: {} } };
    });
    await provisioner(fn).attachCustomDomain("joesauto.com");
    expect(calls.some((c) => c.method === "POST" && c.url.endsWith("/zones"))).toBe(true);
  });

  it("throws CloudflareApiError on a 4xx", async () => {
    const { fn } = mockFetch(() => ({ status: 403, json: { success: false, errors: [{ message: "forbidden" }] } }));
    await expect(provisioner(fn).attachCustomDomain("joesauto.com")).rejects.toBeInstanceOf(CloudflareApiError);
  });
});
