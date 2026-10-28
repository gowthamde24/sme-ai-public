import { ApiAuthError } from "@/lib/api/client";
import { listCampaigns } from "@/lib/api/campaigns";
import { listCatalogueItems } from "@/lib/api/catalogue";
import { listLeadImports } from "@/lib/api/lead-imports";
import { listSources } from "@/lib/api/lead-sources";
import { listRules } from "@/lib/api/outreach";
import { listTasks } from "@/lib/api/tasks";
import { getInstitutionProfile, listFeePlans, listStudents } from "@/lib/api/education";
import { getAccountSecurity } from "@/lib/api/pack";
import { getMaterialPolicy } from "@/lib/api/materials";
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
    // job CS: the school is set up once its institution profile is saved; the students file has brought in at least one student; a fee plan exists; the first reminder campaign was approved (not still a draft)
    institution_set: async () => (await getInstitutionProfile(accessToken, tenantId)).configured,
    students_imported: async () => (await listStudents(accessToken, tenantId, { limit: 1 })).items.length > 0,
    fee_plan_set: async () => (await listFeePlans(accessToken, tenantId, { includeInactive: true })).length > 0,
    first_campaign_approved: async () => (await listCampaigns(accessToken, tenantId, { limit: 50 })).items.some((c) => c.status !== "draft"),
    // night 4, Lead Desk: a live source is connected or a file/sheet of leads was brought in; a call rule was approved (a rule exists only once approved); the first "Ask {assistant} to do it" task was made
    lead_source_added: async () => (await listSources(accessToken, tenantId)).length > 0 || (await listLeadImports(accessToken, tenantId, 1)).length > 0,
    call_rule_approved: async () => (await listRules(accessToken, tenantId)).length > 0,
    ask_assistant_tried: async () => (await listTasks(accessToken, tenantId, { limit: 1 })).length > 0,
    // the building-materials quote rules (delivery, transport and rounding) are in force
    delivery_rule_set: async () => (await getMaterialPolicy(accessToken, tenantId)).current !== null,
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
