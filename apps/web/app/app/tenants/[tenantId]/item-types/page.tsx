import { notFound, redirect } from "next/navigation";

import { isCanonicalUuid } from "@/lib/api/crm";

/**
 * /app/tenants/[tenantId]/item-types: moved (owner, 15 Nov 2026). The item types are "Price ranges", a section under the price list: the old address (links, bookmarks, the assistant of before) goes there.
 */
export default async function ItemTypesPage({ params }: PageProps<"/app/tenants/[tenantId]/item-types">) {
  const { tenantId } = await params;
  if (!isCanonicalUuid(tenantId)) notFound();
  redirect(`/app/tenants/${tenantId}/price-list#price-ranges`);
}
