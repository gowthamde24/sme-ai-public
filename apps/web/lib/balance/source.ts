import { apiRequest } from "@/lib/api/client";
import { isCanonicalUuid } from "@/lib/api/crm";
import { formatRupeesShort } from "@/lib/money";
import { balanceScreens } from "@/lib/screens/flag";

/**
 * The business's rupee balance (owner, 13 Nov 2026; C1's billing v2): `GET /v1/tenants/{t}/billing/balance` (any member) -> `{balance_paise, balance_text, minutes_estimate, plan_id, plan_name, low, topup_available, free_start_left_paise}`. Money is shown as ₹ and never as "credits". The text is made HERE from the
 * paise (the API's `balance_text` is not trusted for the screen). A failed or odd answer is null: the menu then shows the plan alone. `mock` = ₹1,550 for staging until the route exists.
 */
export type Balance = { paise: number; text: string; low: boolean; minutesEstimate: number | null; planName: string | null; topupAvailable: boolean; freeStartLeftPaise: number | null };

const MAX = 100_000_000_00; // ₹10 crore in paise: anything above is not a wallet
export function parseBalance(json: unknown): Balance | null {
  if (typeof json !== "object" || json === null || Array.isArray(json)) return null;
  const o = json as Record<string, unknown>;
  const paise = o.balance_paise;
  if (typeof paise !== "number" || !Number.isSafeInteger(paise) || paise < 0 || paise > MAX) return null;
  const num = (v: unknown): number | null => (typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? v : null);
  const name = typeof o.plan_name === "string" && o.plan_name.length > 0 && o.plan_name.length <= 60 ? o.plan_name : null;
  return { paise, text: formatRupeesShort(paise), low: o.low === true, minutesEstimate: num(o.minutes_estimate), planName: name, topupAvailable: o.topup_available === true, freeStartLeftPaise: num(o.free_start_left_paise) };
}

export async function readBalance(accessToken: string, tenantId: string): Promise<Balance | null> {
  const mode = balanceScreens();
  if (mode === "off" || !isCanonicalUuid(tenantId)) return null;
  if (mode === "mock") {
    // the Billing page's test top-ups and free start (a cookie of this browser) show in the menu's business card too; with none it is the made-up ₹1,550
    const { paiseOf, readState } = await import("@/lib/billing-v6/mock-state");
    const paise = paiseOf(await readState());
    return { paise, text: formatRupeesShort(paise), low: false, minutesEstimate: Math.floor(paise / 500), planName: "Sales assistant", topupAvailable: true, freeStartLeftPaise: null };
  }
  try {
    return parseBalance(await apiRequest(`/v1/tenants/${tenantId}/billing/balance`, accessToken));
  } catch {
    return null;
  }
}
