import { notFound } from "next/navigation";

import { isCanonicalUuid } from "@/lib/api/crm";

import { materialsContext } from "../prelude";
import { MaterialProductPage } from "../pages";
import { BRAND_NAME } from "@/design/brand";

export const metadata = { title: `Product · ${BRAND_NAME}` };
export const dynamic = "force-dynamic";

/** /app/tenants/[tenantId]/materials/[itemId]: one product (job CO). A hidden product is for the Owner and Admin only. */
export default async function MaterialRoute({ params, searchParams }: PageProps<"/app/tenants/[tenantId]/materials/[itemId]">) {
  const { tenantId, itemId } = await params;
  if (!isCanonicalUuid(itemId)) notFound();
  const got = await materialsContext(tenantId);
  if (!got.ok) return got.page;
  return MaterialProductPage({ ...got.ctx, itemId, raw: await searchParams });
}
