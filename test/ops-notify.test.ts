import { describe, it, expect } from "vitest";
import { LogOpsNotifier, ResendOpsNotifier, OpsNotifyError } from "../src/notify/ops.js";
import { handleDfyRequest } from "../src/dfy/intake.js";
import { MemoryStore } from "../src/store.js";
import { sampleBusiness } from "./helpers.js";

describe("Phase 4: ResendOpsNotifier", () => {
  it("POSTs the alert to the ops inbox", async () => {
    let body: any;
    const fetchImpl = async (_u: string, init?: RequestInit) => {
      body = JSON.parse(init!.body as string);
      return new Response("{}", { status: 200 });
    };
    await new ResendOpsNotifier({
      apiKey: "re_test",
      from: "OK Try Me <ops@oktryme.com>",
      to: "ops@oktryme.com",
      fetchImpl,
    }).notify({ subject: "hi", html: "<p>x</p>" });
    expect(body.to).toBe("ops@oktryme.com");
    expect(body.subject).toBe("hi");
  });

  it("throws on a non-2xx response", async () => {
    const fetchImpl = async () => new Response("nope", { status: 500 });
    await expect(
      new ResendOpsNotifier({ apiKey: "re", from: "a@b", to: "c@d", fetchImpl }).notify({
        subject: "s",
        html: "h",
      }),
    ).rejects.toBeInstanceOf(OpsNotifyError);
  });
});

describe("Phase 4: handleDfyRequest", () => {
  async function active() {
    const store = new MemoryStore();
    const rec = sampleBusiness();
    rec.status = "active";
    rec.plan = "done_for_you";
    await store.put(rec);
    return store;
  }

  it("emails ops with the plan + escaped message for an active customer", async () => {
    const store = await active();
    const ops = new LogOpsNotifier();
    const form = new FormData();
    form.set("message", "Change hours <b>now</b>");
    const res = await handleDfyRequest("joes-auto", form, store, ops);
    expect(res.ok).toBe(true);
    expect(ops.sent).toHaveLength(1);
    expect(ops.sent[0].subject).toContain("done_for_you");
    expect(ops.sent[0].html).toContain("&lt;b&gt;"); // escaped, no raw HTML injection
    expect(ops.sent[0].html).not.toContain("<b>now</b>");
  });

  it("rejects when no message is provided", async () => {
    const store = await active();
    const res = await handleDfyRequest("joes-auto", new FormData(), store, new LogOpsNotifier());
    expect(res).toMatchObject({ ok: false, error: "missing message" });
  });

  it("rejects when the business has no active subscription", async () => {
    const store = new MemoryStore();
    await store.put(sampleBusiness()); // status: preview
    const form = new FormData();
    form.set("message", "do it");
    const res = await handleDfyRequest("joes-auto", form, store, new LogOpsNotifier());
    expect(res).toMatchObject({ ok: false, error: "no active subscription" });
  });
});
