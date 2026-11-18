import { notFound, redirect } from "next/navigation";

import { SECTIONS } from "@/components/v2/app/my-assistant/tabs";
import { BRAND_NAME } from "@/design/brand";
import { isCanonicalUuid } from "@/lib/api/crm";
import { designV6 } from "@/lib/screens/flag";

import { renderMyAssistant } from "./view";

export const metadata = { title: `My assistant · ${BRAND_NAME}` };
// Per-user data from the API: never statically rendered or cached.
export const dynamic = "force-dynamic";

/**
 * /app/tenants/[tenantId]/my-assistant (DESIGN_V6; the Owner and Admin): the Overview of the assistant: its state (Not live / In training / Live) as a status card with the one next step, and the Practice panel. One row under the menu's My assistant (owner, 18 Nov 2026):
 * Overview | Train how it talks | Office. Knowledge, Voice & tone, Rules and Practice are sections of Train how it talks (/ai-team/training?section=); the old `?tab=` addresses go there, and `?tab=golive` stays here. A plain 404 where DESIGN_V6 is off.
 */
export default async function MyAssistantPage({ params, searchParams }: PageProps<"/app/tenants/[tenantId]/my-assistant">) {
  const { tenantId } = await params;
  if (!designV6() || !isCanonicalUuid(tenantId)) notFound();
  const tab = (await searchParams).tab;
  const one = Array.isArray(tab) ? tab[0] : tab;
  if (one && (SECTIONS as readonly string[]).includes(one)) redirect(`/app/tenants/${tenantId}/ai-team/training?section=${one}`);
  return renderMyAssistant(tenantId, "overview");
}
