import { notFound, redirect } from "next/navigation";

import { InvoiceView } from "@/components/v2/app/credits/InvoiceView";
import { pageMain } from "@/components/v2/app/ui";
import { BRAND_NAME } from "@/design/brand";
import { wordsFor } from "@/i18n/app-words";
import { getLang } from "@/i18n/get-lang";
import { ApiAuthError, ApiRequestError, fetchTenant } from "@/lib/api/client";
import { getInvoice } from "@/lib/api/credits";
import { isCanonicalUuid } from "@/lib/api/crm";
import { escalate } from "@/lib/api/failure";
import { requireUser } from "@/lib/auth/session";
import { creditsScreens } from "@/lib/screens/flag";

export const metadata = { title: `Invoice · ${BRAND_NAME}` };
export const dynamic = "force-dynamic";

/** /billing/invoices/[number] (Owner and Admin; flag CREDITS_SCREENS): one GST invoice as a plain printable page. */
export default async function InvoicePage({ params }: PageProps<"/app/tenants/[tenantId]/billing/invoices/[number]">) {
  const { tenantId, number } = await params;
  if (!creditsScreens() || !isCanonicalUuid(tenantId) || !/^[A-Z0-9-]{5,20}$/.test(number)) notFound();
  const user = await requireUser();
  let role: string;
  try {
    role = (await fetchTenant(user.accessToken, tenantId)).role;
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    notFound();
  }
  if (role !== "owner" && role !== "admin") notFound();
  let invoice;
  try {
    invoice = await getInvoice(user.accessToken, tenantId, number);
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    if (error instanceof ApiRequestError && error.status === 404) notFound();
    escalate(error);
    throw error;
  }
  const lang = await getLang();
  return (
    <main className={pageMain} lang={lang}>
      <InvoiceView invoice={invoice} words={wordsFor(lang, ["cr."])} back={`/app/tenants/${tenantId}/billing`} />
    </main>
  );
}
