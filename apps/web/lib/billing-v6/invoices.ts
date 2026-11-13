import type { MockState } from "./mock-state";

/**
 * The invoices of the Billing page (C1 builds them with Razorpay TEST later; GST invoices). Until then the list is TEST data: two made-up invoices and the top-ups made in this browser, each marked as a test. `1` = C1's list, which does not exist yet, so the page says
 * invoices come after the first payment. Money is paise: `totalPaise` is what was paid, `gstPaise` the 18 percent GST inside it. Pure.
 */
export type Invoice = { id: string; at: string; kind: "plan" | "topup"; totalPaise: number; gstPaise: number; test: boolean };

/** The GST inside a total that already includes 18 percent: total * 18 / 118, rounded to the paisa. */
export const gstInside = (totalPaise: number): number => Math.round((totalPaise * 18) / 118);
/** A total from an amount before GST (+18 percent). */
export const withGst = (netPaise: number): number => netPaise + Math.round((netPaise * 18) / 100);

export function mockInvoices(state: MockState): Invoice[] {
  const sample: Invoice[] = [
    { id: "t-2026-10-plan", at: "2026-10-13T05:00:00Z", kind: "plan", totalPaise: withGst(199_900), gstPaise: withGst(199_900) - 199_900, test: true },
    { id: "t-2026-11-plan", at: "2026-11-13T05:00:00Z", kind: "plan", totalPaise: withGst(199_900), gstPaise: withGst(199_900) - 199_900, test: true },
  ];
  const mine: Invoice[] = state.topups.map((t) => ({ id: `t-${t.id}`, at: t.at, kind: "topup", totalPaise: withGst(t.paise), gstPaise: withGst(t.paise) - t.paise, test: true }));
  return [...mine, ...sample].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
}
