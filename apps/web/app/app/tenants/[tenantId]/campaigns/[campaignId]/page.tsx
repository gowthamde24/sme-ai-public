import { CampaignPage } from "../pages";
import { campaignContext } from "../prelude";
import { BRAND_NAME } from "@/design/brand";

export const metadata = { title: `Campaign · ${BRAND_NAME}` };
export const dynamic = "force-dynamic";

/** /app/tenants/[tenantId]/campaigns/[campaignId]: one campaign, in four tabs (job CQ): overview, audience, check and approve, results. `?tab=` picks the tab. */
export default async function CampaignRoute({ params, searchParams }: PageProps<"/app/tenants/[tenantId]/campaigns/[campaignId]">) {
  const { tenantId, campaignId } = await params;
  const got = await campaignContext(tenantId);
  if (!got.ok) return got.page;
  return CampaignPage({ ...got.ctx, campaignId, raw: await searchParams });
}
