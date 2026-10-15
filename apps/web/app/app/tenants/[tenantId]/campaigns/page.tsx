import { CampaignsListPage } from "./pages";
import { campaignContext } from "./prelude";

export const metadata = { title: "Campaigns · SME AI Revenue Engine" };
export const dynamic = "force-dynamic";

/** /app/tenants/[tenantId]/campaigns: the reminder campaigns (job CQ; module `campaigns`, checked by the workspace's module guard). Owner, Admin and Sales read and make drafts; the Owner approves. */
export default async function CampaignsRoute({ params, searchParams }: PageProps<"/app/tenants/[tenantId]/campaigns">) {
  const { tenantId } = await params;
  const got = await campaignContext(tenantId);
  if (!got.ok) return got.page;
  return CampaignsListPage({ ...got.ctx, raw: await searchParams });
}
