import { materialsContext } from "../prelude";
import { MaterialProductEditPage } from "../pages";

export const metadata = { title: "Add a product · SME AI Revenue Engine" };
export const dynamic = "force-dynamic";

/** /app/tenants/[tenantId]/materials/new: add a product (job CO; Owner and Admin; anyone else goes to the list). The page makes the product's id, so pressing Save twice is a retry. */
export default async function NewMaterialRoute({ params }: PageProps<"/app/tenants/[tenantId]/materials/new">) {
  const { tenantId } = await params;
  const got = await materialsContext(tenantId);
  if (!got.ok) return got.page;
  return MaterialProductEditPage({ ...got.ctx, itemId: null });
}
