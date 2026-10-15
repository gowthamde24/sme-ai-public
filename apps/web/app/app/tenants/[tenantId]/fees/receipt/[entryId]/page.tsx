import { notFound, redirect } from "next/navigation";

import { ReceiptPrint } from "@/components/v2/app/ledger/ReceiptPrint";
import { getLang } from "@/i18n/get-lang";
import { ApiAuthError, ApiRequestError } from "@/lib/api/client";
import { isCanonicalUuid } from "@/lib/api/crm";
import { getFeeReceipt } from "@/lib/api/education";
import { escalate } from "@/lib/api/failure";
import { formatRupees } from "@/lib/money";

import { eduContext, eduWords } from "../../../education-kit";

export const metadata = { title: "Receipt · SME AI Revenue Engine" };
export const dynamic = "force-dynamic";

/** /app/tenants/[tenantId]/fees/receipt/[entryId]: a fee payment as a receipt to print or save as PDF, and the same words to copy for the guardian (job CS). The system sends nothing; a person pastes the text into WhatsApp. */
export default async function FeeReceiptRoute({ params }: PageProps<"/app/tenants/[tenantId]/fees/receipt/[entryId]">) {
  const { tenantId, entryId } = await params;
  if (!isCanonicalUuid(entryId)) notFound();
  const got = await eduContext(tenantId, "fees");
  if (!got.ok) return got.page;
  const { accessToken } = got.ctx;
  const lang = await getLang();
  const words = eduWords(lang);
  let r;
  try {
    r = await getFeeReceipt(accessToken, tenantId, entryId);
  } catch (error) {
    if (error instanceof ApiRequestError && (error.status === 404 || error.status === 422)) notFound();
    if (error instanceof ApiAuthError) redirect("/login");
    escalate(error);
    throw error;
  }
  const student = r.student.display_name ?? words["edu.stu.erased"];
  const text = (words["fee.receipt.text"] ?? "").replace("{business}", r.business_name).replace("{no}", r.receipt_no).replace("{amount}", formatRupees(r.amount_paise)).replace("{date}", r.received_on).replace("{student}", student);
  return (
    <main lang={lang} className="px-2 py-4">
      <ReceiptPrint
        receipt={{ receipt_no: r.receipt_no, received_on: r.received_on, amount_paise: r.amount_paise, method: r.method, voided: r.voided, business_name: r.business_name, party_name: r.paid_by, party_kind: "contact", against: r.against, balance_after_paise: r.balance_after_paise, recorded_at: r.recorded_at }}
        words={words}
        prefix="fee"
        extra={[{ label: words["fee.receipt.student"], value: [student, r.student.programme_name, r.student.group_label].filter(Boolean).join(" · ") }]}
        copyText={r.voided ? undefined : text}
      />
    </main>
  );
}
