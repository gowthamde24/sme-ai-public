// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

import { payWithRazorpay } from "./razorpay-client";

const SESSION = { keyId: "rzp_test_AbC123xyz", subscriptionId: "sub_Qw12Er34Ty" };
afterEach(() => {
  delete window.Razorpay;
  document.head.innerHTML = "";
});

function fake(run: (o: ConstructorParameters<NonNullable<typeof window.Razorpay>>[0]) => void) {
  window.Razorpay = class {
    constructor(private o: ConstructorParameters<NonNullable<typeof window.Razorpay>>[0]) {}
    open() {
      run(this.o);
    }
  } as unknown as NonNullable<typeof window.Razorpay>;
}

describe("Razorpay's Checkout in the browser (the card detail never reaches this code)", () => {
  it("opens with the PUBLIC key and the subscription only, and joins the three returned values as the checkout_ref", async () => {
    const seen = vi.fn();
    fake((o) => {
      seen(Object.keys(o).sort());
      o.handler({ razorpay_subscription_id: "sub_Qw12Er34Ty", razorpay_payment_id: "pay_Zx98Cv76Bn", razorpay_signature: "c".repeat(64) });
    });
    expect(await payWithRazorpay(SESSION, "Growth")).toEqual({ ok: true, ref: `sub_Qw12Er34Ty.pay_Zx98Cv76Bn.${"c".repeat(64)}` });
    expect(seen).toHaveBeenCalledWith(["handler", "key", "modal", "name", "subscription_id"]);
  });

  it("closing the window is 'closed'; an incomplete answer is 'failed'", async () => {
    fake((o) => o.modal.ondismiss());
    expect(await payWithRazorpay(SESSION, "Growth")).toEqual({ ok: false, reason: "closed" });
    fake((o) => o.handler({ razorpay_payment_id: "pay_Zx98Cv76Bn" }));
    expect(await payWithRazorpay(SESSION, "Growth")).toEqual({ ok: false, reason: "failed" });
  });

  it("a Checkout that throws is 'failed'; a script that does not load is 'failed' and can be tried again", async () => {
    fake(() => {
      throw new Error("x");
    });
    expect(await payWithRazorpay(SESSION, "Growth")).toEqual({ ok: false, reason: "failed" });
    delete window.Razorpay;
    const pending = payWithRazorpay(SESSION, "Growth");
    const el = document.head.querySelector("script") as HTMLScriptElement;
    expect(el.src).toBe("https://checkout.razorpay.com/v1/checkout.js");
    el.onerror?.(new Event("error"));
    expect(await pending).toEqual({ ok: false, reason: "failed" });
    document.head.innerHTML = "";
    const again = payWithRazorpay(SESSION, "Growth");
    expect(document.head.querySelectorAll("script")).toHaveLength(1);
    fake((o) => o.modal.ondismiss());
    (document.head.querySelector("script") as HTMLScriptElement).onload?.(new Event("load"));
    expect(await again).toEqual({ ok: false, reason: "closed" });
  });
});
