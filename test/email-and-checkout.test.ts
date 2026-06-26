import { describe, it, expect } from "vitest";
import { ResendSender, ResendError } from "../src/lead/resend.js";
import { createCheckoutSession, createPortalSession } from "../src/billing/stripe.js";
import type { LeadEmailArgs } from "../src/lead/form.js";

const LEAD: LeadEmailArgs = {
  toBusinessName: "Joe's Auto Repair",
  toEmail: "joe@joesauto.com",
  fromHandle: "joes-auto",
  lead: { name: "Maria", phone: "312-555-0101", message: "Need a brake quote." },
};

describe("V5: ResendSender", () => {
  it("POSTs a well-formed email to Resend", async () => {
    let captured: any;
    const fetchImpl = async (url: string, init?: RequestInit) => {
      captured = { url, headers: init?.headers, body: JSON.parse(init!.body as string) };
      return new Response(JSON.stringify({ id: "email_1" }), { status: 200 });
    };
    await new ResendSender({ apiKey: "re_test", from: "OK Try Me <leads@oktryme.com>", fetchImpl }).send(LEAD);
    expect(captured.url).toBe("https://api.resend.com/emails");
    expect(captured.body.from).toBe("OK Try Me <leads@oktryme.com>");
    expect(captured.body.to).toBe("joe@joesauto.com");
    expect(captured.body.subject).toContain("Joe's Auto Repair");
    expect(captured.body.html).toContain("Maria");
    expect(captured.body.html).toContain("brake quote");
  });

  it("falls back to the ops inbox when the business has no email", async () => {
    let to: string | undefined;
    const fetchImpl = async (_u: string, init?: RequestInit) => {
      to = JSON.parse(init!.body as string).to;
      return new Response("{}", { status: 200 });
    };
    await new ResendSender({ apiKey: "re_test", from: "x@oktryme.com", fallbackTo: "ops@oktryme.com", fetchImpl }).send({
      ...LEAD,
      toEmail: undefined,
    });
    expect(to).toBe("ops@oktryme.com");
  });

  it("escapes lead content (no injection in the email HTML)", async () => {
    let html = "";
    const fetchImpl = async (_u: string, init?: RequestInit) => {
      html = JSON.parse(init!.body as string).html;
      return new Response("{}", { status: 200 });
    };
    await new ResendSender({ apiKey: "re_test", from: "x@oktryme.com", fetchImpl }).send({
      ...LEAD,
      lead: { ...LEAD.lead, message: "<script>alert(1)</script>" },
    });
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("throws with no destination and no fallback", async () => {
    const fetchImpl = async () => new Response("{}", { status: 200 });
    await expect(
      new ResendSender({ apiKey: "re_test", from: "x@oktryme.com", fetchImpl }).send({ ...LEAD, toEmail: undefined }),
    ).rejects.toBeInstanceOf(ResendError);
  });

  it("throws on a non-2xx Resend response", async () => {
    const fetchImpl = async () => new Response("rate limited", { status: 429 });
    await expect(new ResendSender({ apiKey: "re_test", from: "x@oktryme.com", fetchImpl }).send(LEAD)).rejects.toThrow(/429/);
  });
});

describe("V3: createCheckoutSession", () => {
  it("creates a subscription session carrying the handle and returns the URL", async () => {
    let captured: any;
    const fetchImpl = async (url: string, init?: RequestInit) => {
      captured = { url, body: new URLSearchParams(init!.body as string) };
      return new Response(JSON.stringify({ url: "https://checkout.stripe.com/c/pay/cs_test_1" }), { status: 200 });
    };
    const { url } = await createCheckoutSession(
      {
        handle: "joes-auto",
        priceId: "price_49",
        plan: "self_serve",
        successUrl: "https://oktryme.com/p/joes-auto?welcome=1",
        cancelUrl: "https://oktryme.com/p/joes-auto",
        customerEmail: "joe@joesauto.com",
      },
      "sk_test_x",
      fetchImpl,
    );
    expect(url).toContain("checkout.stripe.com");
    expect(captured.url).toBe("https://api.stripe.com/v1/checkout/sessions");
    expect(captured.body.get("mode")).toBe("subscription");
    expect(captured.body.get("client_reference_id")).toBe("joes-auto");
    expect(captured.body.get("metadata[handle]")).toBe("joes-auto");
    expect(captured.body.get("line_items[0][price]")).toBe("price_49");
    expect(captured.body.get("customer_email")).toBe("joe@joesauto.com");
  });

  it("stamps the plan and enables Stripe Tax (§5a A)", async () => {
    let body: URLSearchParams | undefined;
    const fetchImpl = async (_u: string, init?: RequestInit) => {
      body = new URLSearchParams(init!.body as string);
      return new Response(JSON.stringify({ url: "https://checkout.stripe.com/c/pay/x" }), { status: 200 });
    };
    await createCheckoutSession(
      {
        handle: "joes-auto",
        priceId: "price_99",
        plan: "done_for_you",
        successUrl: "https://x",
        cancelUrl: "https://x",
      },
      "sk_test_x",
      fetchImpl,
    );
    expect(body!.get("metadata[plan]")).toBe("done_for_you");
    expect(body!.get("subscription_data[metadata][plan]")).toBe("done_for_you");
    expect(body!.get("subscription_data[metadata][handle]")).toBe("joes-auto");
    expect(body!.get("automatic_tax[enabled]")).toBe("true");
    expect(body!.get("billing_address_collection")).toBe("required");
  });

  it("throws when Stripe returns an error", async () => {
    const fetchImpl = async () => new Response(JSON.stringify({ error: { message: "bad" } }), { status: 400 });
    await expect(
      createCheckoutSession(
        { handle: "h", priceId: "p", plan: "self_serve", successUrl: "https://x", cancelUrl: "https://x" },
        "sk_test_x",
        fetchImpl,
      ),
    ).rejects.toThrow(/failed/);
  });
});

describe("Phase 4: createPortalSession", () => {
  it("creates a billing-portal session for the customer and returns the URL", async () => {
    let captured: any;
    const fetchImpl = async (url: string, init?: RequestInit) => {
      captured = { url, body: new URLSearchParams(init!.body as string) };
      return new Response(JSON.stringify({ url: "https://billing.stripe.com/p/session_x" }), { status: 200 });
    };
    const { url } = await createPortalSession(
      "cus_123",
      "https://oktryme.com/p/joes-auto",
      "sk_test_x",
      fetchImpl,
    );
    expect(url).toContain("billing.stripe.com");
    expect(captured.url).toBe("https://api.stripe.com/v1/billing_portal/sessions");
    expect(captured.body.get("customer")).toBe("cus_123");
    expect(captured.body.get("return_url")).toBe("https://oktryme.com/p/joes-auto");
  });

  it("throws when the portal session can't be created", async () => {
    const fetchImpl = async () => new Response(JSON.stringify({ error: { message: "no config" } }), { status: 400 });
    await expect(
      createPortalSession("cus_123", "https://x", "sk_test_x", fetchImpl),
    ).rejects.toThrow(/failed/);
  });
});
