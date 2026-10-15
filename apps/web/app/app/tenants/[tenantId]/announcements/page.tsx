import { notFound } from "next/navigation";

import { hasModule } from "@/lib/packs/has";

import { CampaignsListPage } from "../campaigns/pages";
import { campaignContext } from "../campaigns/prelude";

export const metadata = { title: "Announcements · SME AI Revenue Engine" };
export const dynamic = "force-dynamic";

/** /app/tenants/[tenantId]/announcements: messages to parents about an event, an exam or a holiday (job CS; module `programmes`), the service-message campaigns of a school. The Owner approves each once, as for any campaign. */
export default async function AnnouncementsRoute({ params, searchParams }: PageProps<"/app/tenants/[tenantId]/announcements">) {
  const { tenantId } = await params;
  const got = await campaignContext(tenantId);
  if (!got.ok) return got.page;
  if (!hasModule(got.ctx.pack, "programmes")) notFound();
  return CampaignsListPage({ ...got.ctx, raw: await searchParams, announcements: true });
}
