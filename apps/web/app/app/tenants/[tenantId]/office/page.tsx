import { notFound, redirect } from "next/navigation";

import { OfficeView } from "@/components/v2/app/office/OfficeView";
import { ApiDownV2 } from "@/components/v2/app/parts";
import { pageMain } from "@/components/v2/app/ui";
import { appT } from "@/i18n/app";
import { getLang } from "@/i18n/get-lang";
import { ApiAuthError, ApiRequestError, fetchTenant } from "@/lib/api/client";
import { escalate } from "@/lib/api/failure";
import { isCanonicalUuid } from "@/lib/api/crm";
import { requireUser } from "@/lib/auth/session";

import { readAgentsStatus, readEventLinks } from "./office-data";
import { partsWords } from "@/i18n/app-words";
import { readPackCached } from "@/lib/packs/read";
import { withPackT } from "@/lib/packs/resolve";
import { BRAND_NAME } from "@/design/brand";

export const metadata = { title: `Office · ${BRAND_NAME}` };
// Per-user data from the API: never statically rendered or cached.
export const dynamic = "force-dynamic";

const pick = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** /app/tenants/[tenantId]/office: the AI team as a plush room or a list (every member may see it), and each helper's latest event, linked to the page it is about. */
export default async function OfficePage({ params, searchParams }: PageProps<"/app/tenants/[tenantId]/office">) {
  const user = await requireUser();
  const { tenantId } = await params;
  const query = await searchParams;
  if (!isCanonicalUuid(tenantId)) notFound();
  try {
    await fetchTenant(user.accessToken, tenantId);
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    if (error instanceof ApiRequestError && error.status === 404) notFound();
    escalate(error);
    return <ApiDownV2 words={await partsWords()} />;
  }
  const lang = await getLang();
  // the helpers carry the names of the business type ("Site Measurer", "Fee Desk"; job CL)
  const pack = await readPackCached(user.accessToken, tenantId);
  const t = pack ? withPackT(appT(lang), pack, lang) : appT(lang);
  let agents;
  let links: Record<string, string>;
  try {
    agents = await readAgentsStatus(user.accessToken, tenantId);
    links = await readEventLinks(user.accessToken, tenantId, agents);
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    escalate(error);
    throw error;
  }
  const wanted = pick(query.agent);
  return (
    <main className={pageMain} lang={lang}>
      <OfficeView agents={agents} selected={wanted && agents?.some((a) => a.agent === wanted) ? wanted : null} links={links} base={`/app/tenants/${tenantId}`} t={(key, vars) => t(key as "frame.notyet", vars)} />
    </main>
  );
}
