import { materialsContext } from "./prelude";
import { MaterialProductsPage } from "./pages";
import { BRAND_NAME } from "@/design/brand";

export const metadata = { title: `Products · ${BRAND_NAME}` };
export const dynamic = "force-dynamic";

/** /app/tenants/[tenantId]/materials: the products of a business that sells by area, weight or piece (job CO; module `materials`). The saree catalogue's address sends such a business here. */
export default async function MaterialsProductsRoute({ params, searchParams }: PageProps<"/app/tenants/[tenantId]/materials">) {
  const { tenantId } = await params;
  const got = await materialsContext(tenantId);
  if (!got.ok) return got.page;
  return MaterialProductsPage({ ...got.ctx, raw: await searchParams });
}
