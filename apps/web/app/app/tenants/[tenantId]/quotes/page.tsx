import { Plus } from "lucide-react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { WRITERS } from "@/components/v2/app/nav";
import { ApiDownV2, NotShownV2, PageTop, Pill } from "@/components/v2/app/parts";
import { btnMain, cellRight, pageMain, table, tableWrap, td, th } from "@/components/v2/app/ui";
import { ApiAuthError, ApiRequestError, fetchTenant } from "@/lib/api/client";
import { escalate } from "@/lib/api/failure";
import { isCanonicalUuid } from "@/lib/api/crm";
import { fetchQuotes, formatDate, formatRupees } from "@/lib/api/quotes";
import { requireUser } from "@/lib/auth/session";
import { hasModule } from "@/lib/packs/has";
import { readPackCached } from "@/lib/packs/read";
import { MaterialQuotesPage } from "./material-pages";
import { makeT } from "@/components/v2/app/words";
import { wordsFor, partsWords } from "@/i18n/app-words";
import { getLang } from "@/i18n/get-lang";
import { BRAND_NAME } from "@/design/brand";


export const metadata = { title: `Quotes · ${BRAND_NAME}` };
// Per-user data from the API: never statically rendered or cached.
export const dynamic = "force-dynamic";

const TONE = { draft: "neutral", approved: "brand", rejected: "red", withdrawn: "amber", superseded: "neutral" } as const;

/**
 * /app/tenants/[tenantId]/quotes: the workspace's quotes, newest first (`fetchQuotes`, the newest 50, each with the customer's name and city). Each row opens the enquiry the quote belongs to, where it is checked and approved.
 * A quote's price comes from the price list by fixed rules; the list shows what the API says, nothing more. A viewer sees none (the API refuses them too).
 */
export default async function QuotesPage({ params }: PageProps<"/app/tenants/[tenantId]/quotes">) {
  const lang = await getLang();
  const words = wordsFor(lang, ["enq."]);
  const t = makeT(words);
  const user = await requireUser();
  const { tenantId } = await params;
  if (!isCanonicalUuid(tenantId)) notFound();
  let tenant;
  try {
    tenant = await fetchTenant(user.accessToken, tenantId);
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    if (error instanceof ApiRequestError && error.status === 404) notFound();
    escalate(error);
    return <ApiDownV2 words={await partsWords()} />;
  }
  if (!(WRITERS as readonly string[]).includes(tenant.role)) return <NotShownV2 tenantId={tenantId} tenantName={tenant.name} title={t("enq.quotes")} message={t("enq.quotes_are_shown_to_owners_admins")} />;

  // a business that sells by area, weight or piece (module `materials`, job CO) sees its material quotes here
  if (hasModule(await readPackCached(user.accessToken, tenantId).catch(() => null), "materials")) return MaterialQuotesPage({ accessToken: user.accessToken, tenantId, lang });
  let quotes;
  try {
    quotes = await fetchQuotes(user.accessToken, tenantId, 50);
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    escalate(error);
    return <ApiDownV2 words={await partsWords()} />;
  }
  const base = `/app/tenants/${tenantId}`;
  return (
    <main className={pageMain} lang={lang}>
      <PageTop
        title={t("enq.quotes")}
        sub={t("enq.prices_come_from_your_price_list")}
        action={
          <Link href={`${base}/review`} className={`${btnMain} gap-2`}>
            <Plus className="size-5" aria-hidden="true" />
            {t("enq.new_quote")}
          </Link>
        }
      />
      <p className="mt-2 text-sm text-muted">{t("enq.a_quote_starts_from_an_enquiry")}</p>
      {quotes.length === 0 ? (
        <p className="mt-6 text-base">{t("enq.no_quotes_yet")}</p>
      ) : (
        <div className={tableWrap}>
          <table className={table}>
            <caption className="sr-only">{t("enq.quotes_newest_first")}</caption>
            <thead>
              <tr>
                <th scope="col" className={th}>{t("enq.quote")}</th>
                <th scope="col" className={th}>{t("enq.customer")}</th>
                <th scope="col" className={`${th} ${cellRight}`}>{t("enq.total")}</th>
                <th scope="col" className={th}>{t("enq.valid_until")}</th>
                <th scope="col" className={th}>{t("enq.status")}</th>
              </tr>
            </thead>
            <tbody>
              {quotes.map((q) => (
                <tr key={q.id}>
                  <td className={td}>
                    <Link href={`${base}/enquiries/${q.enquiry_id}?quote=${q.id}`} className="inline-flex min-h-11 items-center font-mono font-bold text-brand-text hover:underline">
                      {t("enq.quote_n", { n: q.quote_no })}
                    </Link>
                  </td>
                  <td className={td}>
                    <span className="block font-medium">{q.customer ?? t("enq.a_customer")}</span>
                    <span className="block text-sm text-muted">{[q.city, t(`enq.kind.${q.customer_kind}`)].filter(Boolean).join(" · ")}</span>
                  </td>
                  <td className={`${td} ${cellRight} font-semibold tabular-nums`}>{formatRupees(q.total_paise)}</td>
                  <td className={`${td} text-muted`}>{formatDate(q.valid_until)}</td>
                  <td className={td}>
                    <Pill tone={TONE[q.outcome]}>{t(`enq.outcome.${q.outcome}`)}</Pill>
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
