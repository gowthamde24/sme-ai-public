import { notFound, redirect } from "next/navigation";

import { ReceiptPrint } from "@/components/v2/app/ledger/ReceiptPrint";
import { ApiDownV2 } from "@/components/v2/app/parts";
import { partsWords } from "@/i18n/app-words";
import { getLang } from "@/i18n/get-lang";
import { ApiAuthError, ApiRequestError, fetchTenant } from "@/lib/api/client";
import { isCanonicalUuid } from "@/lib/api/crm";
import { escalate } from "@/lib/api/failure";
import { getLedgerReceipt } from "@/lib/api/ledger";
import { requireUser } from "@/lib/auth/session";

import { dueWords } from "../../due-words";
import { BRAND_NAME } from "@/design/brand";

export const metadata = { title: `Receipt · ${BRAND_NAME}` };
export const dynamic = "force-dynamic";

/** /app/tenants/[tenantId]/dues/receipt/[entryId]: a payment as a receipt to print or save as PDF (job CO). Owner, Admin and Sales; a Viewer reads no money. */
export default async function ReceiptPage({ params }: PageProps<"/app/tenants/[tenantId]/dues/receipt/[entryId]">) {
  const user = await requireUser();
  const { tenantId, entryId } = await params;
  if (!isCanonicalUuid(tenantId) || !isCanonicalUuid(entryId)) notFound();
  let tenant;
  try {
    tenant = await fetchTenant(user.accessToken, tenantId);
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    if (error instanceof ApiRequestError && error.status === 404) notFound();
    escalate(error);
    return <ApiDownV2 words={await partsWords()} />;
  }
  if (tenant.role === "viewer") notFound();
  let receipt;
  try {
    receipt = await getLedgerReceipt(user.accessToken, tenantId, entryId);
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    if (error instanceof ApiRequestError && (error.status === 404 || error.status === 422)) notFound();
    escalate(error);
    return <ApiDownV2 words={await partsWords()} />;
  }
  const lang = await getLang();
  return (
    <main lang={lang} className="px-2 py-4">
      <ReceiptPrint receipt={receipt} words={dueWords(lang)} prefix="due" />
    </main>
  );
}
