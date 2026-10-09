import { notFound, redirect } from "next/navigation";

import { OfficeView } from "@/components/v2/app/office/OfficeView";
import { ApiDownV2 } from "@/components/v2/app/parts";
import { pageMain } from "@/components/v2/app/ui";
import { appT } from "@/i18n/app";
import { getLang } from "@/i18n/get-lang";
import { ApiAuthError, ApiRequestError, fetchTenant } from "@/lib/api/client";
import { isCanonicalUuid } from "@/lib/api/crm";
import { requireUser } from "@/lib/auth/session";

import { readAgentsStatus } from "./office-data";

export const metadata = { title: "Office · SME AI Revenue Engine" };
// Per-user data from the API: never statically rendered or cached.
export const dynamic = "force-dynamic";

const pick = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** /app/tenants/[tenantId]/office: the AI team as a list (every member may see it). The 3D room is a later batch (docs/plans/office-3d-proposal.md). */
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
    return <ApiDownV2 />;
  }
  const lang = await getLang();
  const t = appT(lang);
  let agents;
  try {
    agents = await readAgentsStatus(user.accessToken, tenantId);
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    throw error;
  }
  const wanted = pick(query.agent);
  return (
    <main className={pageMain} lang={lang}>
      <OfficeView agents={agents} selected={wanted && agents?.some((a) => a.agent === wanted) ? wanted : null} base={`/app/tenants/${tenantId}`} t={(key, vars) => t(key as "frame.notyet", vars)} />
    </main>
  );
}
