"use client";

/**
 * Razorpay's own Checkout in the browser (owner's C9, TEST mode only). The card or UPI detail is typed into Razorpay's frame and goes to Razorpay: this code never sees it. It loads Razorpay's script by a script element of ours (the page's rules trust a script our own nonced code adds,
 * 'strict-dynamic'; the addresses are named in the rules only while RAZORPAY_CHECKOUT is on), opens the Checkout with the PUBLIC key id and the subscription the API made, and answers with the three values it returns, joined as C1's `checkout_ref`, or null if the person closed it.
 */
const SRC = "https://checkout.razorpay.com/v1/checkout.js";
type Handler = (r: { razorpay_payment_id?: string; razorpay_subscription_id?: string; razorpay_signature?: string }) => void;
type RazorpayCtor = new (o: { key: string; subscription_id: string; name: string; description?: string; handler: Handler; modal: { ondismiss: () => void } }) => { open: () => void; on?: (e: string, cb: () => void) => void };
declare global {
  interface Window {
    Razorpay?: RazorpayCtor;
  }
}

let loading: Promise<RazorpayCtor> | null = null;
function load(): Promise<RazorpayCtor> {
  if (window.Razorpay) return Promise.resolve(window.Razorpay);
  loading ??= new Promise<RazorpayCtor>((resolve, reject) => {
    const el = document.createElement("script");
    el.src = SRC;
    el.async = true;
    el.onload = () => (window.Razorpay ? resolve(window.Razorpay) : reject(new Error("razorpay")));
    el.onerror = () => {
      loading = null;
      reject(new Error("razorpay"));
    };
    document.head.appendChild(el);
  });
  return loading;
}

export type Paid = { ok: true; ref: string } | { ok: false; reason: "closed" | "failed" };

export async function payWithRazorpay(session: { keyId: string; subscriptionId: string }, name: string): Promise<Paid> {
  let Razorpay: RazorpayCtor;
  try {
    Razorpay = await load();
  } catch {
    return { ok: false, reason: "failed" };
  }
  return new Promise<Paid>((resolve) => {
    try {
      const box = new Razorpay({
        key: session.keyId,
        subscription_id: session.subscriptionId,
        name,
        handler: (r) => {
          const sub = r.razorpay_subscription_id;
          const pay = r.razorpay_payment_id;
          const sig = r.razorpay_signature;
          resolve(sub && pay && sig ? { ok: true, ref: `${sub}.${pay}.${sig}` } : { ok: false, reason: "failed" });
        },
        modal: { ondismiss: () => resolve({ ok: false, reason: "closed" }) },
      });
      box.open();
    } catch {
      resolve({ ok: false, reason: "failed" });
    }
  });
}
