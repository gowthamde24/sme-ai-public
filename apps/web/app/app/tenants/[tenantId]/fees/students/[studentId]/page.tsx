import { randomUUID } from "node:crypto";

import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { FeeAssignment } from "@/components/v2/app/education/FeeAssignment";
import { EntrySheet } from "@/components/v2/app/ledger/EntrySheet";
import { StatementView } from "@/components/v2/app/ledger/StatementView";
import { today } from "@/components/v2/app/ledger/ledger-logic";
import { backLink, pageMain } from "@/components/v2/app/ui";
import { getLang } from "@/i18n/get-lang";
import { ApiAuthError, ApiRequestError } from "@/lib/api/client";
import { isCanonicalUuid } from "@/lib/api/crm";
import { getStudentFeeEntries, getStudentFees, listFeePlans } from "@/lib/api/education";
import { escalate } from "@/lib/api/failure";
import { REASONS, type Reason } from "@/lib/api/ledger";
import { clock } from "@/lib/clock";
import { requireUser } from "@/lib/auth/session";

import { voidEntryAction } from "../../../dues/ledger-actions";
import { eduContext, eduWords } from "../../../education-kit";
import { assignPlanAction, recordFeeEntryAction, voidAssignmentAction } from "../../actions";

export const metadata = { title: "Student fees · SME AI Revenue Engine" };
export const dynamic = "force-dynamic";

/**
 * /app/tenants/[tenantId]/fees/students/[studentId]: one student's fee account (job CS): the plan they hold, what is pending and how old it is, the instalments still open, the entries newest first (a mistake is voided, never edited) and
 * the buttons to take a payment (receipt at once), give a concession or make an adjustment. The numbers are the ledger's own. Owner, Admin and Sales read; a concession and an adjustment are the Owner's or an Admin's with the second factor.
 */
export default async function StudentFeesRoute({ params }: PageProps<"/app/tenants/[tenantId]/fees/students/[studentId]">) {
  const { tenantId, studentId } = await params;
  if (!isCanonicalUuid(studentId)) notFound();
  const got = await eduContext(tenantId, "fees");
  if (!got.ok) return got.page;
  const { accessToken, tenant } = got.ctx;
  const user = await requireUser();
  const lang = await getLang();
  const words = eduWords(lang);
  const base = `/app/tenants/${tenantId}`;
  let fees: Awaited<ReturnType<typeof getStudentFees>>;
  let entries: Awaited<ReturnType<typeof getStudentFeeEntries>>;
  let plans: Awaited<ReturnType<typeof listFeePlans>> = [];
  try {
    [fees, entries] = await Promise.all([getStudentFees(accessToken, tenantId, studentId), getStudentFeeEntries(accessToken, tenantId, studentId)]);
    if (fees.assignment === null) plans = (await listFeePlans(accessToken, tenantId, { programmeId: fees.student.programme_id })).filter((p) => p.group_id === null || p.group_id === fees.student.group_id);
  } catch (error) {
    if (error instanceof ApiRequestError && (error.status === 404 || error.status === 422)) notFound();
    if (error instanceof ApiAuthError) redirect("/login");
    escalate(error);
    throw error;
  }
  const here = `${base}/fees/students/${studentId}`;
  const admin = tenant.role === "owner" || tenant.role === "admin";
  const s = fees.student;
  const ledgerEntries = entries.entries.map((e) => ({ ...e, invoice_no: null, order_id: null, reason_code: e.reason_code !== null && (REASONS as readonly string[]).includes(e.reason_code) ? (e.reason_code as Reason) : null }));
  return (
    <main className={pageMain} lang={lang}>
      <p><Link href={`${base}/fees`} className={backLink}>{words["edu.fees.back"]}</Link></p>
      <h1 className="mb-1 mt-2 font-display text-[26px] font-semibold leading-[1.15] [overflow-wrap:anywhere] md:text-4xl">{s.display_name ?? words["edu.stu.erased"]}</h1>
      <p className="mb-4 text-sm text-muted">
        {[s.programme_name, s.group_label].filter(Boolean).join(" · ")}
        {" · "}
        <Link href={`${base}/students/${s.id}`} className="font-semibold text-brand-text underline">{words["edu.fees.student"]}</Link>
      </p>
      <div className="flex flex-col gap-5">
        <FeeAssignment assignment={fees.assignment} plans={plans} canEdit={admin} assignmentId={randomUUID()} words={words} base={base} actions={{ assign: assignPlanAction.bind(null, tenantId, studentId), void: voidAssignmentAction.bind(null, tenantId, studentId) }} />
        <EntrySheet kinds={["payment", "concession", "adjustment"]} prefix="fee" words={words} record={recordFeeEntryAction.bind(null, tenantId, studentId)} today={today(clock())} receiptBase={`${base}/fees/receipt`} secondFactorMissing={user.aal !== "aal2"} role={tenant.role} />
        <StatementView statement={fees.statement} entries={ledgerEntries} words={words} base={base} receiptBase={`${base}/fees/receipt`} canVoid={admin} voidEntry={voidEntryAction.bind(null, tenantId, here)} prefix="fee" />
      </div>
    </main>
  );
}
