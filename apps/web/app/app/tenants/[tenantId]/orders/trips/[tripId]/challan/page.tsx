import { notFound, redirect } from "next/navigation";

import { ChallanPrint } from "@/components/v2/app/deliveries/ChallanPrint";
import { ApiDownV2 } from "@/components/v2/app/parts";
import { partsWords } from "@/i18n/app-words";
import { getLang } from "@/i18n/get-lang";
import { ApiAuthError, ApiRequestError, fetchTenant } from "@/lib/api/client";
import { isCanonicalUuid } from "@/lib/api/crm";
import { getChallan } from "@/lib/api/deliveries";
import { escalate } from "@/lib/api/failure";
import { requireUser } from "@/lib/auth/session";
import { hasModule } from "@/lib/packs/has";
import { readPackCached } from "@/lib/packs/read";

import { tripWords } from "../../trip-words";

export const metadata = { title: "Delivery note · SME AI Revenue Engine" };
export const dynamic = "force-dynamic";

/** /app/tenants/[tenantId]/orders/trips/[tripId]/challan: the delivery note as a page to print or save as PDF (job CO). It has no amounts and no tax. Owner, Admin and Sales. */
export default async function ChallanPage({ params }: PageProps<"/app/tenants/[tenantId]/orders/trips/[tripId]/challan">) {
  const user = await requireUser();
  const { tenantId, tripId } = await params;
  if (!isCanonicalUuid(tenantId) || !isCanonicalUuid(tripId)) notFound();
  let tenant;
  try {
    tenant = await fetchTenant(user.accessToken, tenantId);
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    if (error instanceof ApiRequestError && error.status === 404) notFound();
    escalate(error);
    return <ApiDownV2 words={await partsWords()} />;
  }
  if (tenant.role === "viewer" || !hasModule(await readPackCached(user.accessToken, tenantId).catch(() => null), "deliveries")) notFound();
  let challan;
  try {
    challan = await getChallan(user.accessToken, tenantId, tripId);
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    if (error instanceof ApiRequestError && (error.status === 404 || error.status === 422)) notFound();
    escalate(error);
    return <ApiDownV2 words={await partsWords()} />;
  }
  const lang = await getLang();
  return (
    <main lang={lang} className="px-2 py-4">
      <ChallanPrint challan={challan} words={tripWords(lang)} />
    </main>
  );
}
