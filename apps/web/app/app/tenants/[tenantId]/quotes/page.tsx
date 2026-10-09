import { Plus } from "lucide-react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { WRITERS } from "@/components/v2/app/nav";
import { ApiDownV2, NotShownV2, PageTop, Pill } from "@/components/v2/app/parts";
import { btnMain, cellRight, pageMain, table, tableWrap, td, th } from "@/components/v2/app/ui";
import { ApiAuthError, ApiRequestError, fetchTenant } from "@/lib/api/client";
import { isCanonicalUuid } from "@/lib/api/crm";
import { OUTCOME_LABELS, formatDate, formatRupees } from "@/lib/api/quotes";
import { requireUser } from "@/lib/auth/session";

import { fetchQuoteList } from "./quote-list-data";

export const metadata = { title: "Quotes · SME AI Revenue Engine" };
// Per-user data from the API: never statically rendered or cached.
export const dynamic = "force-dynamic";

const TONE = { draft: "neutral", approved: "brand", rejected: "red", withdrawn: "amber", superseded: "neutral" } as const;

/**
 * /app/tenants/[tenantId]/quotes: the workspace's quotes, newest first (GET /quotes, the newest 50). Each row opens the enquiry the quote belongs to, where it is checked and approved.
 * A quote's price comes from the price list by fixed rules; the list shows what the API says, nothing more. A viewer sees none (the API refuses them too).
 */
export default async function QuotesPage({ params }: PageProps<"/app/tenants/[tenantId]/quotes">) {
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
  if (!(WRITERS as readonly string[]).includes(tenant.role)) return <NotShownV2 tenantId={tenantId} tenantName={tenant.name} title="Quotes" message="Quotes are shown to owners, admins and sales users." />;

  let quotes;
  try {
    quotes = await fetchQuoteList(user.accessToken, tenantId);
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    return <ApiDownV2 />;
  }
  const base = `/app/tenants/${tenantId}`;
  return (
    <main className={pageMain}>
      <PageTop
        title="Quotes"
        sub="Prices come from your price list by fixed rules. AI never sets a price."
        action={
          <Link href={`${base}/review`} className={`${btnMain} gap-2`}>
            <Plus className="size-5" aria-hidden="true" />
            New quote
          </Link>
        }
      />
      <p className="mt-2 text-sm text-muted">A quote starts from an enquiry on a lead: open the lead, then the enquiry.</p>
      {quotes.length === 0 ? (
        <p className="mt-6 text-base">No quotes yet.</p>
      ) : (
        <div className={tableWrap}>
          <table className={table}>
            <caption className="sr-only">Quotes, newest first</caption>
            <thead>
              <tr>
                <th scope="col" className={th}>Quote</th>
                <th scope="col" className={th}>Customer</th>
                <th scope="col" className={`${th} ${cellRight}`}>Total</th>
                <th scope="col" className={th}>Valid until</th>
                <th scope="col" className={th}>Status</th>
              </tr>
            </thead>
            <tbody>
              {quotes.map((q) => (
                <tr key={q.id}>
                  <td className={td}>
                    <Link href={`${base}/enquiries/${q.enquiry_id}?quote=${q.id}`} className="inline-flex min-h-11 items-center font-mono font-bold text-brand-text hover:underline">
                      Quote {q.quote_no}
                    </Link>
                  </td>
                  <td className={td}>{q.customer_kind === "repeat" ? "Repeat customer" : "New customer"}</td>
                  <td className={`${td} ${cellRight} font-semibold tabular-nums`}>{formatRupees(q.total_paise)}</td>
                  <td className={`${td} text-muted`}>{formatDate(q.valid_until)}</td>
                  <td className={td}>
                    <Pill tone={TONE[q.outcome]}>{OUTCOME_LABELS[q.outcome]}</Pill>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
