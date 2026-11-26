import { Check } from "lucide-react";
import Link from "next/link";

import { card } from "@/components/v2/site/ui";
import type { SiteLang } from "@/i18n/lang";
import type { SiteT } from "@/i18n/site";
import { sitePath } from "@/lib/site/paths";
import { PUBLIC_PLANS, planVars, rupees, type PublicPlan } from "@/lib/site/plans";

const inr = (n: number): string => new Intl.NumberFormat("en-IN").format(n);

/**
 * The detailed comparison of the paid plans (owner, 26 Nov 2026: "like the last version, with extra minutes and all"): one row for each thing a plan has, one value for each plan. EVERY number is the plan's own or a PLAN_FACTS number (lib/site/plans.ts), never typed
 * into a sentence. What every plan shares is the same text in each column (every plan has every feature). On a laptop it is a table; on a phone each plan is its own card (no sideways scroll). Server markup only.
 */
export type CompareRow = { id: string; label: string; values: readonly [string, string, string] };

export function compareRows(t: SiteT): CompareRow[] {
  const v = planVars();
  const each = (f: (p: PublicPlan) => string) => PUBLIC_PLANS.map(f) as unknown as [string, string, string];
  const same = (text: string) => each(() => text);
  return [
    { id: "monthly", label: t("pp.d.row.price"), values: each((p) => `${rupees(p.monthly)} ${t("pp.gst")}`) },
    { id: "minutes", label: t("pp.d.row.minutes"), values: each((p) => (p.minutes === null ? t("pp.d.val.minutes.none", v) : t("pp.d.val.minutes.n", { n: inr(p.minutes) }))) },
    { id: "extra", label: t("pp.d.row.extra"), values: same(t("pp.d.val.extra", v)) },
    { id: "find", label: t("pp.d.row.find"), values: each((p) => (p.minutes === null ? t("pp.d.val.find.payg", { n: p.find.included, p: p.find.then }) : t("pp.d.val.find.n", { n: p.find.included, p: p.find.then }))) },
    { id: "setup", label: t("pp.d.row.setup"), values: each((p) => t(p.setup === "priority" ? "pp.setup.prio" : "pp.setup.self")) },
    { id: "number", label: t("pp.d.row.number"), values: same(t("pp.d.val.number")) },
    { id: "line", label: t("pp.d.row.line"), values: same(t("pp.d.val.line")) },
    { id: "xnumber", label: t("pp.d.row.xnumber"), values: same(t("pp.d.val.xnumber", v)) },
    { id: "xline", label: t("pp.d.row.xline"), values: same(t("pp.d.val.xline", v)) },
    { id: "whatsapp", label: t("pp.d.row.whatsapp"), values: same(t("pp.d.val.whatsapp")) },
    { id: "langs", label: t("pp.d.row.langs"), values: same(t("pp.d.val.langs")) },
    { id: "team", label: t("pp.d.row.team"), values: same(t("pp.d.val.yes")) },
    { id: "sources", label: t("pp.d.row.sources"), values: same(t("pp.d.val.yes")) },
  ];
}

export function PlanCompare({ t }: { t: SiteT }) {
  const rows = compareRows(t);
  return (
    <section aria-labelledby="compare-h" data-part="plan-compare" className="mt-12">
      <h2 id="compare-h" className="font-display text-2xl font-bold">
        {t("pp.d.title")}
      </h2>
      <p className="mt-2 max-w-3xl text-base text-muted">{t("pp.d.sub")}</p>
      {/* a laptop: one table, a column for each plan */}
      <div className="mt-5 hidden overflow-hidden rounded-xl border border-line md:block">
        <table className="w-full border-collapse text-left text-base" data-part="compare-table">
          <caption className="sr-only">{t("pp.d.title")}</caption>
          <thead>
            <tr className="bg-surface-2">
              <th scope="col" className="w-1/4 px-4 py-3 text-sm font-semibold text-muted">
                {t("pp.d.col.feature")}
              </th>
              {PUBLIC_PLANS.map((p) => (
                <th key={p.id} scope="col" className={`px-4 py-3 text-lg font-semibold ${p.recommended ? "text-brand-text" : ""}`}>
                  {p.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} data-row={r.id} className="border-t border-line align-top">
                <th scope="row" className="px-4 py-3 text-sm font-semibold text-muted">
                  {r.label}
                </th>
                {r.values.map((value, i) => (
                  <td key={PUBLIC_PLANS[i].id} className="px-4 py-3">
                    {value}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {/* a phone: a card for each plan, the same rows, nothing scrolls sideways */}
      <div className="mt-5 grid gap-4 md:hidden" data-part="compare-cards">
        {PUBLIC_PLANS.map((p, i) => (
          <article key={p.id} className={`${card} ${p.recommended ? "border-brand-text ring-1 ring-brand-text" : ""}`} data-compare-plan={p.id}>
            <h3 className="text-xl font-semibold">{p.name}</h3>
            <dl className="mt-3 flex flex-col gap-3">
              {rows.map((r) => (
                <div key={r.id} data-row={r.id}>
                  <dt className="text-sm font-semibold text-muted">{r.label}</dt>
                  <dd className="m-0 text-base">{r.values[i]}</dd>
                </div>
              ))}
            </dl>
          </article>
        ))}
      </div>
      <p className="mt-4 max-w-3xl text-sm text-muted">{t("pp.d.note")}</p>
    </section>
  );
}

/** "How minutes are billed": only rules that are true today (docs/contracts/call-billing.md), each with its numbers from PLAN_FACTS. */
export function MinutesBilled({ t, lang }: { t: SiteT; lang: SiteLang }) {
  const v = planVars();
  return (
    <section aria-labelledby="minutes-h" data-part="minutes-billed" className="mt-12">
      <h2 id="minutes-h" className="font-display text-2xl font-bold">
        {t("pp.min.t")}
      </h2>
      <ul className="mt-4 grid gap-3 md:grid-cols-2">
        {([1, 2, 3, 4, 5, 6, 7] as const).map((n) => (
          <li key={n} className={`${card} flex items-start gap-3`}>
            <Check className="mt-1 size-4 shrink-0 text-green-text" aria-hidden="true" />
            <p className="m-0 text-base">{t(`pp.min.${n}`, v)}</p>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-sm text-muted">
        <Link href={sitePath(lang, { kind: "page", page: "refunds" })} className="font-semibold text-brand-text underline underline-offset-2">
          {t("pp.min.refund")}
        </Link>
      </p>
    </section>
  );
}
