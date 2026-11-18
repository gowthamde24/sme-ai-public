import { ApiAuthError } from "@/lib/api/client";
import { listCampaigns } from "@/lib/api/campaigns";
import { offerScreens } from "@/lib/screens/flag";

import type { Role } from "@/components/v2/app/today/types";

/**
 * Today's line "offers waiting for your approval" (owner, 18 Nov; campaigns S4): the owner's own offers that are ready (a draft with customers added) and not yet approved. Only the Owner (approving is the owner's step), only with OFFER_SCREENS on.
 * It is a line of its own, not a card in "Needs you": the menu's number and that heading stay C1's one count. One offer opens it; several open the Campaigns page. A read that fails (or takes more than 1.5 seconds) draws nothing; a rejected session is thrown.
 */
export type OffersWaiting = { count: number; href: string };

export async function readOffersWaiting(token: string, tenantId: string, role: Role, base: string): Promise<OffersWaiting | null> {
  if (role !== "owner" || offerScreens() === "off") return null;
  try {
    const page = await Promise.race([listCampaigns(token, tenantId, { status: "draft" }), new Promise<null>((resolve) => setTimeout(() => resolve(null), 1500))]);
    if (!page) return null;
    const ready = page.items.filter((c) => c.kind === "offer" && c.recipients > 0);
    if (ready.length === 0) return null;
    return { count: ready.length, href: ready.length === 1 ? `${base}/campaigns/${ready[0].id}` : `${base}/campaigns` };
  } catch (error) {
    if (error instanceof ApiAuthError) throw error;
    return null;
  }
}
