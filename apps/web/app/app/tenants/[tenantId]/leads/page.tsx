import { notFound, redirect } from "next/navigation";

import { isCanonicalUuid } from "@/lib/api/crm";

/** `/leads` on its own is the Leads tab's menu address family (nav `also`), but the page of the list is `/review`: a typed or bookmarked `/leads` used to say "Not found" (staging walk, 20 Nov). A single lead is still `/leads/[leadId]`. */
export default async function LeadsRedirect({ params }: PageProps<"/app/tenants/[tenantId]/leads">): Promise<never> {
  const { tenantId } = await params;
  if (!isCanonicalUuid(tenantId)) notFound();
  redirect(`/app/tenants/${tenantId}/review`);
}
