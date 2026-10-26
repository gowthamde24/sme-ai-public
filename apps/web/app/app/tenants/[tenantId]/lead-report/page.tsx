import Link from "next/link";

import { PageTop } from "@/components/v2/app/parts";
import { btnMain, fieldInput, fieldLabel, mutedText, pageH2, pageMain, surface } from "@/components/v2/app/ui";
import { BRAND_NAME } from "@/design/brand";
import { wordsFor } from "@/i18n/app-words";
import { getLang } from "@/i18n/get-lang";
import { formatRupeesShort } from "@/lib/money";
import { durationText } from "@/lib/outreach/words";
import { readReport } from "@/lib/outreach/source";
import { sourceNames } from "@/lib/outreach/words";
import { outreachScreens } from "@/lib/screens/flag";

import { leadContext } from "../lead-context";

export const metadata = { title: `Lead report · ${BRAND_NAME}` };
export const dynamic = "force-dynamic";

const pick = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const day = (d: Date) => d.toISOString().slice(0, 10);

/**
 * /app/tenants/[tenantId]/lead-report (night 4, part A7; a tab of Reports; Owner and Admin): how fast the leads are reached and what comes of it, per lead source: the median time to the first touch, how many calls were answered, how many
 * showed interest, the bookings, and what a booking cost (the calls plus the cost of the leads). Plain bars, one row per source and a total. The period is the last seven days unless the address says otherwise. In test mode the numbers are made up.
 */
export default async function LeadReportPage({ params, searchParams }: PageProps<"/app/tenants/[tenantId]/lead-report">) {
  const { tenantId } = await params;
  const query = await searchParams;
  const got = await leadContext(tenantId, { roles: ["owner", "admin"], on: outreachScreens() !== "off" });
  if (!got.ok) return got.page;
  const { accessToken, userId } = got.ctx;
  const lang = await getLang();
  const words = wordsFor(lang, ["ld.report.", "ld.source."]);
  const now = new Date();
  const toQ = pick(query.to);
  const fromQ = pick(query.from);
  const to = toQ && DAY.test(toQ) ? toQ : day(now);
  const from = fromQ && DAY.test(fromQ) && fromQ <= to ? fromQ : day(new Date(new Date(`${to}T00:00:00Z`).getTime() - 6 * 86_400_000));
  const report = await readReport({ token: accessToken, tenantId, userId }, from, to);
  const sn = sourceNames(words);
  const bar = (label: string, value: number, text: string) => (
    <div className="grid grid-cols-[minmax(6rem,9rem)_1fr_auto] items-center gap-2">
      <span className="text-sm font-semibold text-muted">{label}</span>
      <progress value={Math.min(100, Math.max(0, value))} max={100} aria-label={`${label}: ${text}`} className="h-3 w-full accent-brand-edge" />
      <span className="min-w-12 text-right text-base font-semibold">{text}</span>
    </div>
  );
  const cost = (p: number | null) => (p === null ? words["ld.report.none"] : formatRupeesShort(p));
  return (
    <main className={pageMain} lang={lang}>
      <PageTop title={words["ld.report.title"] ?? "Lead report"} sub={words["ld.report.sub"] ?? ""} />
      {outreachScreens() === "mock" ? (
        <p role="note" className="mt-3 text-sm text-muted">
          {words["ld.report.mock"]}
        </p>
      ) : null}
      <form method="get" action={`/app/tenants/${tenantId}/lead-report`} className={`${surface} mt-4 flex flex-wrap items-end gap-3`}>
        <div>
          <label htmlFor="lr-from" className={fieldLabel}>
            {words["ld.report.from"]}
          </label>
          <input id="lr-from" name="from" type="date" defaultValue={from} className={fieldInput} />
        </div>
        <div>
          <label htmlFor="lr-to" className={fieldLabel}>
            {words["ld.report.to"]}
          </label>
          <input id="lr-to" name="to" type="date" defaultValue={to} className={fieldInput} />
        </div>
        <button type="submit" className={btnMain}>
          {words["ld.report.show"]}
        </button>
      </form>
      {report === null ? (
        <p className={mutedText}>{words["ld.report.na"]}</p>
      ) : report.bySource.length === 0 ? (
        <p className={mutedText}>{words["ld.report.empty"]}</p>
      ) : (
        <>
          <h2 className={pageH2}>{words["ld.report.total"]}</h2>
          <section data-part="total" className={`${surface} flex flex-col gap-2`}>
            <p className="text-base">{(words["ld.report.total.line"] ?? "").replace("{leads}", String(report.total.leads)).replace("{calls}", String(report.total.calls)).replace("{bookings}", String(report.total.bookings))}</p>
            {bar(words["ld.report.connected"], report.total.connectedRate, `${Math.round(report.total.connectedRate)}%`)}
            {bar(words["ld.report.interested"], report.total.interestedPct, `${Math.round(report.total.interestedPct)}%`)}
            <p className="text-base">
              {words["ld.report.costper"]}: <strong>{cost(report.total.costPerBookingPaise)}</strong>
            </p>
          </section>
          <h2 className={pageH2}>{words["ld.report.bysource"]}</h2>
          <ul data-part="sources" className="flex flex-col gap-3">
            {report.bySource.map((r) => (
              <li key={r.source} data-source={r.source} className={`${surface} flex flex-col gap-2`}>
                <p className="font-display text-lg font-bold">{sn[r.source] ?? r.source}</p>
                <p className={`${mutedText} !mt-0`}>{(words["ld.report.row"] ?? "").replace("{leads}", String(r.leads)).replace("{calls}", String(r.calls))}</p>
                <p className="text-base">
                  {words["ld.report.first"]}: <strong>{durationText(r.firstTouchMedianSeconds, words)}</strong>
                </p>
                {bar(words["ld.report.connected"], r.connectedRate, `${Math.round(r.connectedRate)}%`)}
                {bar(words["ld.report.interested"], r.interestedPct, `${Math.round(r.interestedPct)}%`)}
                <p className="text-base">
                  {words["ld.report.bookings"]}: <strong>{r.bookings}</strong> · {words["ld.report.costper"]}: <strong>{cost(r.costPerBookingPaise)}</strong>
                </p>
              </li>
            ))}
          </ul>
          <p className={mutedText}>{words["ld.report.help"]}</p>
          <p className="mt-3">
            <Link href={`/app/tenants/${tenantId}/outreach`} className="font-semibold text-brand-text underline">
              {words["ld.report.link"]}
            </Link>
          </p>
        </>
      )}
    </main>
  );
}
