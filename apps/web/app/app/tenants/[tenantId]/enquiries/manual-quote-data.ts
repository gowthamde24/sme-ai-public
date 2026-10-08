import { fetchItemTypes, sellableItemTypes } from "@/lib/api/item-types";
import { fetchQuotePolicyVersions } from "@/lib/api/quote-policies";

import type { GstInForce } from "./manual-quote-form";
import type { ManualQuoteData } from "./quote-panel";

/**
 * What the "Quote with typed prices" form needs, read with the signed-in user's own token (owner and admin only: the page never calls this for anyone else): the ACTIVE item
 * types in display order with their ranges, and the GST rate of the quote policy in force today. The rate is shown, never worked out here: a policy version carries its own
 * rate and the date it applies from, and no rate that applies today means the form says so and cannot be sent. The API and the database decide again when the draft is made.
 */
export async function loadManualQuoteData(accessToken: string, tenantId: string, today: string, newQuoteId: string): Promise<ManualQuoteData> {
  const [types, policies] = await Promise.all([fetchItemTypes(accessToken, tenantId), fetchQuotePolicyVersions(accessToken, tenantId)]);
  const inForce = policies.find((p) => p.in_force);
  // dates are YYYY-MM-DD, so comparing them as text is comparing days
  const gst: GstInForce | null = inForce && inForce.gst_effective_from <= today ? { rateBps: inForce.gst_rate_bps, from: inForce.gst_effective_from } : null;
  return { unavailable: false, itemTypes: sellableItemTypes(types), gst, newQuoteId };
}
