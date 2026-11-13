import { notFound, redirect } from "next/navigation";

import { isCanonicalUuid } from "@/lib/api/crm";
import { designV6 } from "@/lib/screens/flag";

export const dynamic = "force-dynamic";

/**
 * /app/tenants/[tenantId]/billing (DESIGN_V6): plan, rupee balance, top-up and invoices. The page is built in its own change; until then the menu's row opens the plan page. A plain 404 where DESIGN_V6 is off.
 */
export default async function BillingPage({ params }: PageProps<"/app/tenants/[tenantId]/billing">): Promise<never> {
  const { tenantId } = await params;
  if (!designV6() || !isCanonicalUuid(tenantId)) notFound();
  redirect(`/app/tenants/${tenantId}/plans`);
}
