import { NOTHING_TODAY, type TodayData } from "@/components/v2/app/today/types";
import { ApiAuthError } from "@/lib/api/client";
import { fetchMembers, fetchOrders, moneyHeld, type Order } from "@/lib/api/orders";

const PAGE = 50; // the API's largest page
const MAX_PAGES = 10;

/**
 * What the Today screen shows. The contract's `getToday()` (lib/api, Job AD, Claude 1) does not exist yet, so this fills what the EXISTING reads can answer and leaves the rest null
 * ("Not available yet"):
 *  - "Orders in progress" and "Customer money held" from GET /orders (every page up to 500 orders; a workspace with more says "Not available yet" rather than a partial number);
 *  - "Needs you", "Waiting for you", "Your team right now" and "Recently recorded": null. The list needs the customer, city and agent of each item, which the existing reads do not
 *    carry (quote approvals have no workspace-wide read at all).
 * When `getToday()` lands, REPLACE the body of this function with that call (the result has this shape) and give each item its `href`.
 * A failure of a read is a null for that part only; a rejected session still sends the person to sign in (the caller handles ApiAuthError).
 */
export async function readToday(accessToken: string, tenantId: string): Promise<TodayData> {
  const data: TodayData = { ...NOTHING_TODAY, cards: { ...NOTHING_TODAY.cards } };
  try {
    const orders: Order[] = [];
    let cursor: string | null = null;
    for (let i = 0; i < MAX_PAGES; i++) {
      const page = await fetchOrders(accessToken, tenantId, { limit: PAGE, cursor });
      orders.push(...page.items);
      cursor = page.next_cursor;
      if (!cursor) break;
    }
    if (!cursor) {
      data.cards.orders_open = orders.filter((o) => o.outcome === "open").length;
      data.cards.money_held_paise = orders.reduce((sum, o) => sum + moneyHeld(o), 0);
    }
  } catch (error) {
    // a refusal, a contract error or a network failure: the two cards stay "Not available yet"
    if (error instanceof ApiAuthError) throw error;
  }
  return data;
}

/** The person's display name in this workspace, if the members list has one for them (it is null for most). Never throws except for a rejected session. */
export async function readDisplayName(accessToken: string, tenantId: string, userId: string): Promise<string | null> {
  try {
    return (await fetchMembers(accessToken, tenantId)).find((m) => m.user_id === userId)?.display_name ?? null;
  } catch (error) {
    if (error instanceof ApiAuthError) throw error;
    return null;
  }
}
