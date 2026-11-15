import { notFound, redirect } from "next/navigation";

import { isCanonicalUuid } from "@/lib/api/crm";

/**
 * /app/tenants/[tenantId]/quote-policy: moved (owner, 15 Nov 2026). The quote policy is Settings, Quotes: the old address (links, bookmarks, the checklist, the assistant of before) goes there, and a "saved" mark
 * from the materials form goes with it.
 */
export default async function QuotePolicyPage({ params, searchParams }: PageProps<"/app/tenants/[tenantId]/quote-policy">) {
  const { tenantId } = await params;
  if (!isCanonicalUuid(tenantId)) notFound();
  const query = await searchParams;
  const saved = (Array.isArray(query.saved) ? query.saved[0] : query.saved) === "1";
  redirect(`/app/tenants/${tenantId}/settings?section=quotes${saved ? "&saved=1" : ""}`);
}
