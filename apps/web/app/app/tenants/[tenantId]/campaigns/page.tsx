import { CampaignsListPage } from "./pages";
import { redirectToJob } from "@/lib/jobs/redirect";
import { campaignContext } from "./prelude";
import { BRAND_NAME } from "@/design/brand";

export const metadata = { title: `Campaigns · ${BRAND_NAME}` };
export const dynamic = "force-dynamic";

/** /app/tenants/[tenantId]/campaigns: the reminder campaigns (job CQ; module `campaigns`, checked by the workspace's module guard). Owner, Admin and Sales read and make drafts; the Owner approves. */
export default async function CampaignsRoute({ params, searchParams }: PageProps<"/app/tenants/[tenantId]/campaigns">) {
  const { tenantId } = await params;
  const got = await campaignContext(tenantId);
  if (!got.ok) return got.page;
  const raw = await searchParams;
  await redirectToJob(got.ctx.accessToken, tenantId, "payment_reminders", raw.all); // JOBS on: the reminder campaigns are a job (later kind; until it exists: the Jobs page)
  return CampaignsListPage({ ...got.ctx, raw });
}
