"use client";

import type { Order } from "@/lib/api/credits";

/**
 * Razorpay Checkout for a top-up order (C1's docs/contracts/credits-topup.md): with a public `key_id` Razorpay's own frame opens (the card or UPI detail is typed into Razorpay's frame and never reaches this code); with no key (the API's fake provider on staging) the payment is faked:
 * payment id `pay_fake_...` and signature `sig_fake_ok`, which the API accepts only while its provider is fake. The answer is the three values to confirm with, or why not.
 */
const SRC = "https://checkout.razorpay.com/v1/checkout.js";
type Response = { razorpay_payment_id?: string; razorpay_signature?: string };
type Box = { open: () => void; on?: (e: string, cb: () => void) => void };
type RazorpayCtor = new (o: { key: string; order_id: string; amount: number; currency: string; name: string; description: string; handler: (r: Response) => void; modal: { ondismiss: () => void }; prefill?: Record<string, string> }) => Box;
const razorpay = (): RazorpayCtor | undefined => (window as unknown as { Razorpay?: RazorpayCtor }).Razorpay;
let loading: Promise<RazorpayCtor> | null = null;
function load(): Promise<RazorpayCtor> {
  const have = razorpay();
  if (have) return Promise.resolve(have);
  loading ??= new Promise<RazorpayCtor>((resolve, reject) => {
    const el = document.createElement("script");
    el.src = SRC;
    el.async = true;
    el.onload = () => {
      const r = razorpay();
      if (r) resolve(r);
      else reject(new Error("razorpay"));
    };
    el.onerror = () => {
      loading = null;
      reject(new Error("razorpay"));
    };
    document.head.appendChild(el);
  });
  return loading;
}

export type Paid = { ok: true; paymentId: string; signature: string } | { ok: false; reason: "closed" | "failed" };

export async function payOrder(order: Pick<Order, "keyId" | "orderId" | "amountPaise" | "name" | "description">): Promise<Paid> {
  if (!order.keyId) return { ok: true, paymentId: `pay_fake_${Math.random().toString(36).slice(2, 12)}`, signature: "sig_fake_ok" };
  let Razorpay: RazorpayCtor;
  try {
    Razorpay = await load();
  } catch {
    return { ok: false, reason: "failed" };
  }
  return new Promise<Paid>((resolve) => {
    try {
      const box = new Razorpay({
        key: order.keyId as string,
        order_id: order.orderId,
        amount: order.amountPaise,
        currency: "INR",
        name: order.name,
        description: order.description,
        handler: (r) => resolve(r.razorpay_payment_id && r.razorpay_signature ? { ok: true, paymentId: r.razorpay_payment_id, signature: r.razorpay_signature } : { ok: false, reason: "failed" }),
        modal: { ondismiss: () => resolve({ ok: false, reason: "closed" }) },
      });
      box.on?.("payment.failed", () => resolve({ ok: false, reason: "failed" }));
      box.open();
    } catch {
      resolve({ ok: false, reason: "failed" });
    }
  });
}
