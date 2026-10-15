import { redirect } from "next/navigation";

import { QuotesListView } from "@/components/v2/app/materials/QuotesListView";
import { pageMain } from "@/components/v2/app/ui";
import type { Lang } from "@/i18n/lang";
import { ApiAuthError } from "@/lib/api/client";
import { escalate } from "@/lib/api/failure";
import { listMaterialQuotes } from "@/lib/api/materials";

import { readLeadLabel } from "../visits/visits-data";
import { quoteWords } from "./material-words";

/** The material quotes of a workspace, newest first (job CO), with the customer's name for each (a name that cannot be read is simply missing). */
export async function MaterialQuotesPage({ accessToken, tenantId, lang }: { accessToken: string; tenantId: string; lang: Lang }) {
  let quotes: Awaited<ReturnType<typeof listMaterialQuotes>>["items"] | null = null;
  const customers: Record<string, string> = {};
  try {
    quotes = (await listMaterialQuotes(accessToken, tenantId, { limit: 50 })).items;
    const leads = [...new Set(quotes.map((q) => q.lead_id))].slice(0, 30);
    await Promise.all(leads.map(async (id) => { try { const l = await readLeadLabel(accessToken, tenantId, id); if (l) customers[id] = l.label; } catch (e) { if (e instanceof ApiAuthError) throw e; } }));
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    escalate(error);
    quotes = null;
  }
  return (
    <main className={pageMain} lang={lang}>
      <QuotesListView base={`/app/tenants/${tenantId}`} words={quoteWords(lang)} quotes={quotes} customers={customers} />
    </main>
  );
}
