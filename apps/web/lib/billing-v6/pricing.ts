/**
 * The plans and their prices (C1's `GET /v1/pricing`, any signed-in user; docs/contracts/pricing-v2.md): `{gst_text, free_start_text, plans: [{id, name, monthly_text, yearly_text, yearly_saving_text, included_minutes, rate_text, numbers_included, lead_finder, lines}]}`.
 * The ids are data (payg, sales_assistant, sales_lead_finder): the screen loops over `plans`, it never names one. The texts are C1's own words; the screen shows them as they are. Pure.
 */
export type PricePlan = { id: string; name: string; monthlyText: string; yearlyText: string | null; yearlySavingText: string | null; includedMinutes: number | null; rateText: string | null; numbersIncluded: number | null; leadFinder: boolean };
export type Pricing = { gstText: string | null; freeStartText: string | null; plans: PricePlan[] };

const text = (v: unknown, max = 120): string | null => (typeof v === "string" && v.trim().length > 0 && v.length <= max ? v : null);
const whole = (v: unknown): number | null => (typeof v === "number" && Number.isSafeInteger(v) && v >= 0 && v <= 10_000_000 ? v : null);

export function parsePricing(json: unknown): Pricing | null {
  if (typeof json !== "object" || json === null || Array.isArray(json)) return null;
  const o = json as Record<string, unknown>;
  if (!Array.isArray(o.plans) || o.plans.length === 0 || o.plans.length > 10) return null;
  const plans: PricePlan[] = [];
  for (const p of o.plans) {
    if (typeof p !== "object" || p === null || Array.isArray(p)) return null;
    const x = p as Record<string, unknown>;
    const id = text(x.id, 60);
    const name = text(x.name, 60);
    const monthly = text(x.monthly_text, 60);
    if (id === null || name === null || monthly === null) return null;
    plans.push({ id, name, monthlyText: monthly, yearlyText: text(x.yearly_text, 60), yearlySavingText: text(x.yearly_saving_text, 60), includedMinutes: whole(x.included_minutes), rateText: text(x.rate_text, 60), numbersIncluded: whole(x.numbers_included), leadFinder: x.lead_finder === true });
  }
  return { gstText: text(o.gst_text), freeStartText: text(o.free_start_text), plans };
}

/** The test catalogue (the owner's final pricing of 13 Nov): pay as you go, Sales assistant, Sales assistant with Lead Finder. */
export const MOCK_PRICING: Pricing = {
  gstText: "+18% GST on invoices",
  freeStartText: "₹50 free to start, no card",
  plans: [
    { id: "payg", name: "Pay as you go", monthlyText: "₹499 a month", yearlyText: "₹4,990 a year", yearlySavingText: "2 months free", includedMinutes: 0, rateText: "₹5 a minute", numbersIncluded: 1, leadFinder: false },
    { id: "sales_assistant", name: "Sales assistant", monthlyText: "₹1,999 a month", yearlyText: "₹19,990 a year", yearlySavingText: "2 months free", includedMinutes: 500, rateText: "₹4.50 a minute", numbersIncluded: 1, leadFinder: false },
    { id: "sales_lead_finder", name: "Sales assistant with Lead Finder", monthlyText: "₹5,999 a month", yearlyText: "₹59,990 a year", yearlySavingText: "2 months free", includedMinutes: 1500, rateText: "₹4 a minute", numbersIncluded: 3, leadFinder: true },
  ],
};
