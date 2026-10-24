import { notFound } from "next/navigation";

import { hasModule } from "@/lib/packs/has";

import { CampaignFormPage } from "../../campaigns/pages";
import { campaignContext } from "../../campaigns/prelude";
import { BRAND_NAME } from "@/design/brand";

export const metadata = { title: `New announcement · ${BRAND_NAME}` };
export const dynamic = "force-dynamic";

/** /app/tenants/[tenantId]/announcements/new: write an announcement (an event, an exam or a holiday) and then choose who it is for (job CS). The page makes the campaign's id, so pressing Save twice is a retry. */
export default async function NewAnnouncementRoute({ params }: PageProps<"/app/tenants/[tenantId]/announcements/new">) {
  const { tenantId } = await params;
  const got = await campaignContext(tenantId);
  if (!got.ok) return got.page;
  if (!hasModule(got.ctx.pack, "programmes")) notFound();
  return CampaignFormPage({ ...got.ctx, campaignId: null, announcements: true });
}
