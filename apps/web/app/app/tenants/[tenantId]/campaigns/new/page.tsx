import { CampaignFormPage } from "../pages";
import { campaignContext } from "../prelude";

export const metadata = { title: "New campaign · SME AI Revenue Engine" };
export const dynamic = "force-dynamic";

/** /app/tenants/[tenantId]/campaigns/new: make a campaign (job CQ). The page makes the campaign's id, so pressing Save twice is a retry. */
export default async function NewCampaignRoute({ params }: PageProps<"/app/tenants/[tenantId]/campaigns/new">) {
  const { tenantId } = await params;
  const got = await campaignContext(tenantId);
  if (!got.ok) return got.page;
  return CampaignFormPage({ ...got.ctx, campaignId: null });
}
