import { makeT, type Words } from "../../words";

const ROWS = [1, 2, 3, 4] as const;

/**
 * "How calls are billed" on Credits and billing (owner, 29 Nov 2026; approved mock "Credits and billing"): four open rows, each a bold line and one grey sentence, each tagged "Draft: to be confirmed" until the owner confirms the rule (an unanswered or busy call costs nothing; how a call
 * is counted; a call to you costs the same; testing is free). No amount is written here: the rates are the plan's own and are drawn by the page. Server markup. The words come from the string store (`cpn.bill.`).
 */
export function CallBillingFacts({ words }: { words: Words }) {
  const t = makeT(words);
  return (
    <section data-part="call-billing" aria-labelledby="cpn-bill-h" className="mt-6 min-w-0">
      <h2 id="cpn-bill-h" className="m-0 font-display text-xl font-semibold text-ink">
        {t("cpn.bill.title")}
      </h2>
      <dl className="m-0 mt-2 border-t border-ink">
        {ROWS.map((n) => (
          <div key={n} data-row={n} className="grid gap-0.5 border-b border-line py-3.5">
            <dt className="min-w-0 font-bold text-ink">{t(`cpn.bill.${n}.b`)}</dt>
            <dd className="m-0 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[15px] text-muted">
              <span className="min-w-0">{t(`cpn.bill.${n}.t`)}</span>
              <small data-part="draft-tag" className="inline-block rounded-full border border-line px-2.5 py-px text-[13px] font-semibold text-muted">
                {t("cpn.bill.draft")}
              </small>
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
