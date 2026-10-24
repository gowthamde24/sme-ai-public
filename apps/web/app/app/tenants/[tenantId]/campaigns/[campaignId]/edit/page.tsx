import { notFound } from "next/navigation";

import { isCanonicalUuid } from "@/lib/api/crm";

import { CampaignFormPage } from "../../pages";
import { campaignContext } from "../../prelude";
import { BRAND_NAME } from "@/design/brand";

export const metadata = { title: `Change campaign · ${BRAND_NAME}` };
export const dynamic = "force-dynamic";

/** /app/tenants/[tenantId]/campaigns/[campaignId]/edit: change a draft or an approved campaign (an approved one goes back to draft and has to be approved again). */
export default async function EditCampaignRoute({ params }: PageProps<"/app/tenants/[tenantId]/campaigns/[campaignId]/edit">) {
  const { tenantId, campaignId } = await params;
  if (!isCanonicalUuid(campaignId)) notFound();
  const got = await campaignContext(tenantId);
  if (!got.ok) return got.page;
  return CampaignFormPage({ ...got.ctx, campaignId });
}
