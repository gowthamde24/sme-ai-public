import { CallListPage } from "../campaigns/pages";
import { campaignContext } from "../campaigns/prelude";

export const metadata = { title: "Call list · SME AI Revenue Engine" };
export const dynamic = "force-dynamic";

/** /app/tenants/[tenantId]/call-list: the people a money reminder did not reach, who have not paid (job CQ; module `campaigns`). Owner and Admin can ring them through the shop's own phone; everyone who may read writes down how it went. */
export default async function CallListRoute({ params, searchParams }: PageProps<"/app/tenants/[tenantId]/call-list">) {
  const { tenantId } = await params;
  const got = await campaignContext(tenantId);
  if (!got.ok) return got.page;
  return CallListPage({ ...got.ctx, raw: await searchParams });
}
