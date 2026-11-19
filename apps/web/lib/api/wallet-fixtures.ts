import { EXTRA_NUMBER_PAISE, MINUTE_PAISE, PLAN_TERMS } from "@/lib/plan/plans-v2";
import type { PlanKey } from "@/lib/plan/names";

/**
 * The made-up months of BILLING_V2=mock (nothing is charged or sent): the same shape C1 will send (docs/contracts in `~/Desktop/stack19-jobs/contracts/wallet-web-needs.md`), one per state the screen has words for.
 * `?demo=` picks one on the Billing page; no demo is the middle of a normal month on Pro. Money is integer paise.
 */
export const DEMOS = ["normal", "low80", "full100", "over", "upgrade", "numbers"] as const;
export type Demo = (typeof DEMOS)[number];
export const isDemo = (v: unknown): v is Demo => typeof v === "string" && (DEMOS as readonly string[]).includes(v);

export type DemoMonth = {
  planKey: PlanKey;
  planId: string;
  balancePaise: number;
  /** Day of the billing month and its length: the upgrade hint is projected over the whole month. */
  day: number;
  days: number;
  minutes: number;
  searches: number;
  numbers: number;
  whatsappPaise: number;
  whatsappMessages: number;
  /** The spending limits already set in this scenario, by feature (paise). */
  limits: Partial<Record<"calls" | "find_customers" | "whatsapp", number>>;
  low: boolean;
};

const BASE: Omit<DemoMonth, "planKey" | "planId"> = { balancePaise: 155_000, day: 18, days: 30, minutes: 212.5, searches: 3, numbers: 1, whatsappPaise: 8_600, whatsappMessages: 54, limits: {}, low: false };

export function demoMonth(demo: Demo): DemoMonth {
  const pro = { planKey: "pro" as const, planId: "sales_assistant", ...BASE };
  switch (demo) {
    case "low80":
      return { ...pro, balancePaise: 18_000, minutes: PLAN_TERMS.pro.includedMinutes * 0.8, searches: 8, low: true };
    case "full100":
      return { ...pro, balancePaise: 62_000, minutes: 500 + 36, searches: 12, day: 24 };
    case "over":
      return { ...pro, balancePaise: 91_000, minutes: 500 + 400, searches: 4, day: 26, limits: { calls: 200_000 } };
    case "upgrade":
      // Pay as you go, 420 minutes so far at the end of the month: Pro would have cost ₹600 less
      return { ...BASE, planKey: "payg", planId: "payg", balancePaise: 84_000, day: 30, minutes: 420, searches: 1 };
    case "numbers":
      return { ...pro, numbers: 3, searches: 5 };
    default:
      return pro;
  }
}

/** What the month has cost from the wallet so far, by feature (paise): the minutes beyond the plan's own, the paid searches, the extra numbers and WhatsApp at Meta's cost. */
export function demoSpend(m: DemoMonth): { calls: number; find_customers: number; numbers: number; whatsapp: number } {
  const t = PLAN_TERMS[m.planKey];
  return {
    calls: Math.round(Math.max(0, m.minutes - t.includedMinutes) * MINUTE_PAISE),
    find_customers: Math.max(0, m.searches - t.freeSearches) * t.searchPaise,
    numbers: Math.max(0, m.numbers - 1) * EXTRA_NUMBER_PAISE,
    whatsapp: m.whatsappPaise,
  };
}
