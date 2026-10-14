import { ApiAuthError } from "@/lib/api/client";
import { listCatalogueItems } from "@/lib/api/catalogue";
import { getAccountSecurity } from "@/lib/api/pack";
import { getProfile } from "@/lib/api/profile";
import { fetchQuotePolicyVersions } from "@/lib/api/quote-policies";
import { fetchQuotes } from "@/lib/api/quotes";
import { getWhatsappAccount } from "@/lib/api/whatsapp";

import type { StepCheck } from "./activation";

async function yes(read: () => Promise<boolean>): Promise<boolean> {
  try {
    return await read();
  } catch (error) {
    if (error instanceof ApiAuthError) throw error;
    return false; // a fact that cannot be read is not "done"
  }
}

/** The facts behind the checks a pack's steps use, each read on its own with existing endpoints only (a check nobody asks for is not read). */
export async function readFacts(accessToken: string, tenantId: string, checks: readonly StepCheck[]): Promise<Partial<Record<StepCheck, boolean>>> {
  const want = new Set(checks);
  const reads: Partial<Record<StepCheck, () => Promise<boolean>>> = {
    business_profile: async () => (await getProfile(accessToken, tenantId)).town !== null,
    // the session is at the second level only when an authenticator code was given: the person has set it up (a status the server cannot give counts as not done)
    second_factor_set: async () => (await getAccountSecurity(accessToken))?.level === "aal2",
    catalogue_has_items: async () => (await listCatalogueItems(accessToken, tenantId, { limit: 1, includeInactive: true })).items.length > 0,
    quote_rules_set: async () => (await fetchQuotePolicyVersions(accessToken, tenantId)).length > 0,
    whatsapp_connected: async () => {
      const a = await getWhatsappAccount(accessToken, tenantId);
      return a.configured && a.status === "active";
    },
    // the system never sends a quote (the person does, outside it): a quote that reached "approved" is the product's own record of the first one
    first_quote_sent: async () => (await fetchQuotes(accessToken, tenantId, 50)).some((q) => q.outcome === "approved"),
  };
  const entries = await Promise.all((Object.keys(reads) as StepCheck[]).filter((c) => want.has(c)).map(async (c) => [c, await yes(reads[c]!)] as const));
  return Object.fromEntries(entries);
}
