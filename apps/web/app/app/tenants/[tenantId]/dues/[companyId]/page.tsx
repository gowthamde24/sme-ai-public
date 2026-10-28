import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { CreditLimitForm } from "@/components/v2/app/ledger/CreditLimitForm";
import { EntrySheet } from "@/components/v2/app/ledger/EntrySheet";
import { StatementView } from "@/components/v2/app/ledger/StatementView";
import { today } from "@/components/v2/app/ledger/ledger-logic";
import { ApiDownV2, NotShownV2 } from "@/components/v2/app/parts";
import { backLink, pageMain } from "@/components/v2/app/ui";
import { partsWords } from "@/i18n/app-words";
import { getLang } from "@/i18n/get-lang";
import { ApiAuthError, ApiRequestError, fetchTenant } from "@/lib/api/client";
import { fetchCompany, isCanonicalUuid } from "@/lib/api/crm";
import { escalate } from "@/lib/api/failure";
import { getLedgerEntries, getLedgerStatement } from "@/lib/api/ledger";
import { clock } from "@/lib/clock";
import { requireUser } from "@/lib/auth/session";

import { dueWords } from "../due-words";
import { recordEntryAction, setCreditLimitAction, voidEntryAction } from "../ledger-actions";
import { BRAND_NAME } from "@/design/brand";
import { secondFactorNeeded } from "@/lib/auth/second-factor";

export const metadata = { title: `Account · ${BRAND_NAME}` };
export const dynamic = "force-dynamic";

/** /app/tenants/[tenantId]/dues/[companyId]: one customer's account (job CO): what is owed and how old it is, the open invoices, the entries, and the buttons to write down a payment, an invoice or an adjustment. */
export default async function CustomerDuesPage({ params }: PageProps<"/app/tenants/[tenantId]/dues/[companyId]">) {
  const user = await requireUser();
  const { tenantId, companyId } = await params;
  if (!isCanonicalUuid(tenantId) || !isCanonicalUuid(companyId)) notFound();
  let tenant;
  try {
    tenant = await fetchTenant(user.accessToken, tenantId);
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    if (error instanceof ApiRequestError && error.status === 404) notFound();
    escalate(error);
    return <ApiDownV2 words={await partsWords()} />;
  }
  const lang = await getLang();
  const words = dueWords(lang);
  const base = `/app/tenants/${tenantId}`;
  if (tenant.role === "viewer") return <NotShownV2 tenantId={tenantId} tenantName={tenant.name} title={words["nav.item.dues"]} message={words["due.viewer"]} />;
  let statement;
  let entries;
  let company;
  try {
    [statement, entries, company] = await Promise.all([getLedgerStatement(user.accessToken, tenantId, { company_id: companyId }), getLedgerEntries(user.accessToken, tenantId, { company_id: companyId }), fetchCompany(user.accessToken, tenantId, companyId)]);
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    if (error instanceof ApiRequestError && (error.status === 404 || error.status === 422)) notFound();
    escalate(error);
    return <ApiDownV2 words={await partsWords()} />;
  }
  const here = `${base}/dues/${companyId}`;
  const party = { company_id: companyId };
  const admin = tenant.role === "owner" || tenant.role === "admin";
  return (
    <main className={pageMain} lang={lang}>
      <p><Link href={`${base}/dues`} className={backLink}>← {words["nav.item.dues"]}</Link></p>
      <h1 className="mb-1 mt-2 font-display text-[26px] font-semibold leading-[1.15] [overflow-wrap:anywhere] md:text-4xl">{company.name}</h1>
      <p className="mb-4 text-sm text-muted">{company.city ?? ""}</p>
      <div className="flex flex-col gap-5">
        <EntrySheet
          kinds={["payment", "charge", "adjustment"]}
          prefix="due"
          words={words}
          record={recordEntryAction.bind(null, tenantId, party, here)}
          today={today(clock())}
          receiptBase={`${base}/dues/receipt`}
          secondFactorMissing={secondFactorNeeded(user)}
          role={tenant.role}
        />
        <StatementView statement={statement} entries={entries.entries} words={words} base={base} receiptBase={`${base}/dues/receipt`} canVoid={admin} voidEntry={voidEntryAction.bind(null, tenantId, here)} prefix="due" />
        {tenant.role === "owner" ? (
          !secondFactorNeeded(user) ? <CreditLimitForm current={statement.credit_limit_paise} words={words} save={setCreditLimitAction.bind(null, tenantId, companyId, here)} /> : <p role="note" className="text-sm text-muted">{words["due.limit.2fa"]} <Link href="/app/security" className="font-semibold underline">{words["today.err.mfa.link"]}</Link></p>
        ) : null}
      </div>
    </main>
  );
}
