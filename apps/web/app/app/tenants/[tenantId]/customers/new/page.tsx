import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { ApiAuthError, ApiRequestError, fetchTenant } from "@/lib/api/client";
import { isCanonicalUuid } from "@/lib/api/crm";
import { requireUser } from "@/lib/auth/session";

import { addCustomerAction } from "./actions";
import { CustomerForm } from "./customer-form";

export const metadata = { title: "Add a customer · SME AI Revenue Engine" };
// Per-user data from the API: never statically rendered or cached.
export const dynamic = "force-dynamic";

const WRITERS = ["owner", "admin", "sales"];

/**
 * /app/tenants/[tenantId]/customers/new: add one customer (a contact with a phone, and a lead for it). Owner, Admin or Sales. Server-side; requireUser() runs FIRST and every call goes to OUR API with the
 * user's own token. Anyone else sees a plain notice and the API is not asked anything for them; the API and the database enforce the role regardless.
 */
export default async function NewCustomerPage({ params }: PageProps<"/app/tenants/[tenantId]/customers/new">) {
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
  if (!WRITERS.includes(tenant.role))
    return (
      <main className="shell wide">
        {back}
        <h1>Add a customer</h1>
        <p>An owner, an admin or a sales person adds customers.</p>
      </main>
    );
  // one set of ids per render: a second press of the button is a retry. The key remounts the form for the next customer, so its state starts clean.
  const ids = { company: crypto.randomUUID(), contact: crypto.randomUUID(), lead: crypto.randomUUID() };
  return (
    <main className="shell wide">
      {back}
      <h1>Add a customer</h1>
      <p>
        Your role: <strong>{tenant.role}</strong>
      </p>
      <p className="hint">
        A customer is a person with a phone number, and a lead for them. Nothing is sent to anyone. Consent is not recorded here: you record it on the next screen, when the customer has told you.
      </p>
      <CustomerForm key={ids.contact} action={addCustomerAction.bind(null, tenantId)} tenantId={tenantId} ids={ids} />
    </main>
  );
}
