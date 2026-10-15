import Link from "next/link";

import { QuoteBuilder, type BuilderItem, type BuilderLine } from "@/components/v2/app/materials/QuoteBuilder";
import { Pill } from "@/components/v2/app/parts";
import { pageH2, mutedText, noteBox } from "@/components/v2/app/ui";
import { fetchLead } from "@/lib/api/crm";
import type { RequirementField, RequirementView } from "@/lib/api/enquiries";
import { getMaterialPolicy, listMaterialItems, listMaterialQuotes } from "@/lib/api/materials";
import { settle } from "@/lib/api/part";
import { listSites } from "@/lib/api/sites";
import { formatRupees } from "@/lib/money";
import { makeT, type Words } from "@/components/v2/app/words";

import { draftMaterialQuoteAction, previewMaterialQuoteAction } from "../quotes/material-actions";

const TONE = { draft: "neutral", approved: "green", rejected: "red", superseded: "amber" } as const;

/** The lines of a requirement as the builder shows them: the product, the measure the customer gave and the thickness. */
export function builderLines(view: RequirementView, t: (k: string, v?: Record<string, string | number>) => string): BuilderLine[] {
  const live = (f: RequirementField) => f.state !== "rejected";
  return view.lines.map((lineNo) => {
    const of = (key: string) => view.fields.find((f) => f.line_no === lineNo && f.field_key === key && live(f));
    const product = of("product_type");
    const area = of("area");
    const length = of("length");
    const width = of("width");
    const qty = of("quantity");
    const thick = of("thickness");
    const measure = [area?.display, length && width ? `${length.display} × ${width.display}` : length?.display ?? width?.display, qty?.display, thick?.display].filter(Boolean).join(" · ");
    const unit = area?.value.basis;
    return {
      lineNo,
      title: product?.display ?? t("mat.b.line", { n: lineNo }),
      measure: measure || t("mat.b.nomeasure"),
      area: area && area.value.int_value !== null && (unit === "sq_ft" || unit === "sq_m") ? { areaX100: area.value.int_value, areaUnit: unit } : null,
    };
  });
}

/**
 * Making a quote from an enquiry whose requirement a person has approved (job CO): the owner's quote rules must exist, then the builder (pick the product of each line and the site, see the figures, keep a draft),
 * and under it the quotes already made for this requirement. Reads each part on its own, so one part failing does not take the others down.
 */
export async function MaterialQuoteSection({ accessToken, tenantId, enquiry, view, role, words, newQuoteId }: { accessToken: string; tenantId: string; enquiry: { id: string; lead_id: string }; view: RequirementView; role: "owner" | "admin" | "sales" | "viewer"; words: Words & Record<string, string>; newQuoteId: string }) {
  const t = makeT(words);
  const base = `/app/tenants/${tenantId}`;
  const requirement = view.requirement;
  if (!requirement || requirement.status !== "confirmed")
    return (
      <section aria-labelledby="mq-heading">
        <h2 id="mq-heading" className={pageH2}>{t("mat.part.quote")}</h2>
        <p role="note" className={noteBox}>{t("mat.b.approvefirst")} <Link href={`${base}/enquiries/${enquiry.id}`} className="font-semibold underline">{t("enq.part.request")}</Link></p>
      </section>
    );
  const [policy, items, quotes, lead] = await Promise.all([
    settle(() => getMaterialPolicy(accessToken, tenantId)),
    settle(() => listMaterialItems(accessToken, tenantId, { limit: 50 })),
    settle(() => listMaterialQuotes(accessToken, tenantId, { requirementId: requirement.id, limit: 20 })),
    settle(() => fetchLead(accessToken, tenantId, enquiry.lead_id)),
  ]);
  const sites = lead.ok && lead.data.company_id ? await settle(() => listSites(accessToken, tenantId, { companyId: lead.data.company_id as string, limit: 50 })) : null;
  const noRules = policy.ok && policy.data.current === null;
  const lines = builderLines(view, t as never);
  return (
    <section aria-labelledby="mq-heading" className="flex flex-col gap-4" data-part="material-quote">
      <h2 id="mq-heading" className={pageH2}>{t("mat.part.quote")}</h2>
      {!view.ready_for_quote ? <p role="note" className={noteBox}>{t("mat.b.notready")}</p> : null}
      {quotes.ok && quotes.data.items.length > 0 ? (
        <div>
          <h3 className="font-display text-lg font-bold">{t("mat.b.made")}</h3>
          <ul className="mt-2 flex flex-col gap-2">
            {quotes.data.items.map((q) => (
              <li key={q.id}>
                <Link href={`${base}/quotes/${q.id}`} className="flex min-h-11 flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-surface px-3 py-2 hover:border-brand-edge">
                  <span className="font-semibold">{t("mat.q.title", { n: q.quote_no })}</span>
                  <span className="tabular-nums">{formatRupees(q.total_paise)}</span>
                  <Pill tone={TONE[q.status]}>{t(`mat.status.${q.status}`)}</Pill>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {role === "viewer" ? (
        <p className={mutedText}>{t("mat.q.viewer")}</p>
      ) : !policy.ok || !items.ok ? (
        <p role="alert" className="rounded-lg border border-red-text bg-red-bg p-3 font-medium text-red-text">{t("mat.b.cannotload")}</p>
      ) : noRules ? (
        <p role="note" className={noteBox}>
          {t("mat.b.norules")}{" "}
          {role === "owner" ? <Link href={`${base}/quote-policy`} className="font-semibold underline">{t("mat.b.setrules")}</Link> : t("mat.b.askowner")}
        </p>
      ) : (
        <QuoteBuilder
          base={base}
          requirementId={requirement.id}
          newQuoteId={newQuoteId}
          lines={lines}
          items={items.data.items.filter((i) => i.active).map((i): BuilderItem => ({ id: i.id, name: i.name, unit: i.sell_unit, priceText: i.price_text, missing: i.price_paise === null ? ["price"] : [] }))}
          sites={sites && sites.ok ? sites.data.items.filter((s) => s.active).map((s) => ({ id: s.id, label: [s.name, s.city].filter(Boolean).join(", ") })) : []}
          words={words}
          actions={{ preview: previewMaterialQuoteAction.bind(null, tenantId, requirement.id), draft: draftMaterialQuoteAction.bind(null, tenantId, requirement.id) }}
        />
      )}
    </section>
  );
}
