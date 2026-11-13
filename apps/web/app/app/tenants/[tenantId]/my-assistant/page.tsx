import { notFound, redirect } from "next/navigation";

import { isCanonicalUuid } from "@/lib/api/crm";
import { designV6 } from "@/lib/screens/flag";

export const dynamic = "force-dynamic";

/**
 * /app/tenants/[tenantId]/my-assistant (DESIGN_V6): the assistant's own page. The page with its tabs (Knowledge, Voice & tone, Rules, Practice, Go live) is built in its own change; until then the menu's row opens the page it replaces (Train how it talks). A plain 404 where DESIGN_V6 is off.
 */
export default async function MyAssistantPage({ params }: PageProps<"/app/tenants/[tenantId]/my-assistant">): Promise<never> {
  const { tenantId } = await params;
  if (!designV6() || !isCanonicalUuid(tenantId)) notFound();
  redirect(`/app/tenants/${tenantId}/ai-team/training`);
}
