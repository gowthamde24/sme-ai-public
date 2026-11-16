import { notFound, redirect } from "next/navigation";

import { isCanonicalUuid } from "@/lib/api/crm";

// Per-user data from the API: never statically rendered or cached.
export const dynamic = "force-dynamic";

/** The old address of the message templates (they were on the WhatsApp connection page): they are the Chats page's third tab now (owner, 16 Nov), so this sends there. */
export default async function OldTemplatesAddress({ params }: PageProps<"/app/tenants/[tenantId]/integrations/whatsapp/templates">) {
  const { tenantId } = await params;
  if (!isCanonicalUuid(tenantId)) notFound();
  redirect(`/app/tenants/${tenantId}/chats/templates`);
}
