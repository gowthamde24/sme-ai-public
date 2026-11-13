import type { Metadata } from "next";

import { BusinessesCard, CostsCard, Kpis, PrivacyNote, SupportQueue, SystemHealth } from "@/components/v2/app/staff/OverviewParts";
import { Topbar } from "@/components/v2/app/staff/Topbar";
import { loadStaff } from "@/lib/staff/load";

export const metadata: Metadata = { title: "Overview · Staff console · Stack19" };
// the figures are read per request, for the signed-in staff member
export const dynamic = "force-dynamic";

/** Staff console, Overview (approved mock approved-mocks/admin-overview.html): the four figures, the support queue, system health, the businesses, our costs and the privacy note, in ONE read of C1's `GET /v1/admin/overview`. A block the role does not get is not drawn. */
export default async function OverviewPage() {
  const state = await loadStaff();
  if (!state.ok) return null; // the layout drew the reason
  const o = state.data.overview;
  return (
    <>
      <Topbar title="Overview" envLabel={o.environment.label} generatedAt={o.generatedAt} />
      <Kpis kpis={o.kpis} />
      <div className={o.supportQueue ? "sc-g2" : "sc-g2 sc-one"}>
        {o.supportQueue ? <SupportQueue queue={o.supportQueue} /> : null}
        <SystemHealth components={o.health.components} />
      </div>
      <div className={o.costs ? "sc-g2 sc-biz" : "sc-g2 sc-one"}>
        <BusinessesCard rows={o.businesses} total={o.badges.businesses} nowIso={o.generatedAt} />
        {o.costs ? <CostsCard costs={o.costs} since={o.kpis.margin?.costsRecordedSince ?? null} /> : null}
      </div>
      <PrivacyNote />
    </>
  );
}
