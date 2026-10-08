import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { ApiAuthError, ApiRequestError, fetchTenant } from "@/lib/api/client";
import { isCanonicalUuid } from "@/lib/api/crm";
import { requireUser } from "@/lib/auth/session";

import { addProductAction } from "./actions";
import { ProductForm } from "./product-form";

export const metadata = { title: "Add a product · SME AI Revenue Engine" };
// Per-user data from the API: never statically rendered or cached.
export const dynamic = "force-dynamic";

const ADMINS = ["owner", "admin"];

/**
 * /app/tenants/[tenantId]/products/new: add one product (a saree type). Owner or Admin. Server-side; requireUser() runs FIRST and every call goes to OUR API with the user's own token. Anyone else sees a
 * plain notice and the API is not asked anything for them; the API and the database enforce the role regardless.
 */
export default async function NewProductPage({ params }: PageProps<"/app/tenants/[tenantId]/products/new">) {
  const user = await requireUser();
  const { tenantId } = await params;
  if (!isCanonicalUuid(tenantId)) notFound();

  let tenant;
  try {
    tenant = await fetchTenant(user.accessToken, tenantId);
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    if (error instanceof ApiRequestError && error.status === 404) notFound();
    return (
      <main className="shell wide">
        <p role="alert" className="error">
          Could not load this from the API. Try again shortly.
        </p>
        <p>
          <Link href="/app">Back to your workspaces</Link>
        </p>
      </main>
    );
  }
  const back = (
    <p>
      <Link href={`/app/tenants/${tenantId}`}>← {tenant.name}</Link>
    </p>
  );
  if (!ADMINS.includes(tenant.role))
    return (
      <main className="shell wide">
        {back}
        <h1>Add a product</h1>
        <p>An owner or an admin adds products.</p>
      </main>
    );
  // one id per render: a second press is a retry. The key remounts the form for the next product.
  const id = crypto.randomUUID();
  return (
    <main className="shell wide">
      {back}
      <h1>Add a product</h1>
      <p>
        Your role: <strong>{tenant.role}</strong>
      </p>
      <p className="hint">A product is a saree type you sell. No price is set here: prices are loaded on the price-list page, or typed for each quote.</p>
      <ProductForm key={id} action={addProductAction.bind(null, tenantId)} tenantId={tenantId} id={id} />
    </main>
  );
}
