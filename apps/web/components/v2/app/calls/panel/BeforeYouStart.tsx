import { makeT, type Words } from "../../words";

const RULES = [1, 2, 3, 4, 5] as const;

/**
 * "Before you start calling" (owner, 29 Nov 2026; approved mock "Calls" and "Lead sources"): the five plain rules of calling, as open rows on the page (no card, one ink line above, hairlines between). Open on the Calls page; folded on Lead sources, where the summary reads "Read the five rules".
 * The calling hours are the call gate's own (10 am to 9 pm, set by us, not by the business); do-not-call is automatic; the business is the caller. Server markup: a native <details>, no script. The words come from the string store (`cpn.rules.`, `cpn.rule.`).
 */
export function BeforeYouStart({ words, open }: { words: Words; open: boolean }) {
  const t = makeT(words);
  return (
    <section data-part="before-you-start" data-open={open ? "true" : "false"} className="min-w-0 border-y border-line">
      <details open={open} className="group">
        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 py-2 [&::-webkit-details-marker]:hidden">
          <h2 className="m-0 min-w-0 font-display text-[17px] font-bold text-ink">{t("cpn.rules.title")}</h2>
          <span data-part="rules-read" className="shrink-0 text-sm font-semibold text-muted group-open:hidden">
            {t("cpn.rules.read")}
          </span>
        </summary>
        <ol role="list" className="m-0 list-none p-0">
          {RULES.map((n) => (
            <li key={n} data-rule={n} className="grid grid-cols-[26px_minmax(0,1fr)] gap-3 border-t border-line py-2.5 text-[15px] text-muted">
              <span aria-hidden="true" className="grid size-[22px] place-items-center rounded-full border border-line text-[13px] font-bold text-muted">
                {n}
              </span>
              <span className="min-w-0 break-words">
                <b className="font-semibold text-ink">{t(`cpn.rule.${n}.b`)}</b> {t(`cpn.rule.${n}.t`)}
              </span>
            </li>
          ))}
        </ol>
      </details>
    </section>
  );
}
