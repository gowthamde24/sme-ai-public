import { notFound } from "next/navigation";

import { isCanonicalUuid } from "@/lib/api/crm";

import { materialsContext } from "../../prelude";
import { MaterialProductEditPage } from "../../pages";
import { BRAND_NAME } from "@/design/brand";

export const metadata = { title: `Change a product · ${BRAND_NAME}` };
export const dynamic = "force-dynamic";

/** /app/tenants/[tenantId]/materials/[itemId]/edit: change a product and its photos (job CO; Owner and Admin; anyone else is sent to the product). */
export default async function EditMaterialRoute({ params }: PageProps<"/app/tenants/[tenantId]/materials/[itemId]/edit">) {
  const { tenantId, itemId } = await params;
  if (!isCanonicalUuid(itemId)) notFound();
  const got = await materialsContext(tenantId);
  if (!got.ok) return got.page;
  return MaterialProductEditPage({ ...got.ctx, itemId });
}
