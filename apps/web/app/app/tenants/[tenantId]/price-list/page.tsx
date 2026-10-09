import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { ApiAuthError, ApiRequestError, fetchTenant } from "@/lib/api/client";
import { isCanonicalUuid } from "@/lib/api/crm";
import { requireUser } from "@/lib/auth/session";

import { commitPriceListAction, previewPriceListAction } from "./price-list-actions";
import { PriceListImport } from "./price-list-import";
import { backLink, mutedText, noteBox, pageH1, pageMain } from "@/components/v2/app/ui";
import { ApiDownV2 } from "@/components/v2/app/parts";

export const metadata = { title: "Price list · SME AI Revenue Engine" };
// Per-user data from the API: never statically rendered or cached.
export const dynamic = "force-dynamic";

/** Today's date in India: the default day a new price list starts. */
function todayInIndia(now: Date): string {
  return new Date(now.getTime() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
}

/**
 * /app/tenants/[tenantId]/price-list: load a price list from a CSV file (owner or admin). Server-side only; requireUser() runs FIRST and every call goes to OUR API with the user's own token.
 * Anyone else sees a plain notice and nothing is asked of the API for them.
 */
export default async function PriceListPage({ params }: PageProps<"/app/tenants/[tenantId]/price-list">) {
  const user = await requireUser();
  const { tenantId } = await params;
  if (!isCanonicalUuid(tenantId)) notFound();

  let tenant;
  try {
    tenant = await fetchTenant(user.accessToken, tenantId);
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    if (error instanceof ApiRequestError && error.status === 404) notFound();
    return <ApiDownV2 />;
  }
  const back = (
    <p>
      <Link href={`/app/tenants/${tenantId}`} className={backLink}>← {tenant.name}</Link>
    </p>
  );
  if (tenant.role !== "owner" && tenant.role !== "admin")
    return (
      <main className={pageMain}>
        {back}
        <h1 className={pageH1}>Price list</h1>
        <p className={mutedText}>An owner or admin loads the price list.</p>
      </main>
    );
  return (
    <main className={pageMain}>
      {back}
      <h1 className={pageH1}>Load a price list</h1>
      <p>
        Your role: <strong>{tenant.role}</strong>
      </p>
      <p role="note" className={noteBox}>
        A price list is a file of your products and their prices. Check it first: nothing is saved until you press save, and nothing is sent to anyone. Prices in a quote always come from the price list in force on the
        day, never from a person or an assistant.
      </p>
      <PriceListImport
        preview={previewPriceListAction.bind(null, tenantId)}
        commit={commitPriceListAction.bind(null, tenantId)}
        today={todayInIndia(new Date())}
        secondFactorMissing={user.aal !== "aal2"}
      />
    </main>
  );
}
