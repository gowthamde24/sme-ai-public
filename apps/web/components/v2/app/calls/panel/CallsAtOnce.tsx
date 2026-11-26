import type { ExtraLines as ExtraOverview, LineActions } from "@/lib/extra-lines/types";
import type { Lines } from "@/lib/phone-lines/types";
import { ADDRESSES } from "@/lib/site/business";

import { makeT, type Words } from "../../words";
import { ExtraLines } from "./ExtraLines";
import { cardBox } from "../../Card";

/** EXTRA_LINES: what the Owner needs to add and cancel lines. Absent = the switch is off: "Add a line" is the mail to us, as it was. */
export type ExtraProps = { overview: ExtraOverview; actions: LineActions; creditsHref: string; locale: string; test: boolean };

/**
 * "Calls at once" on the Phone numbers page (owner, 29 Nov 2026; approved mock "Phone numbers"; Outpero study addendum 2): how many calls can run together, how many do now, and one flat tile per line: "Open" (dashed, nothing in it) or "On a call" (a solid edge and the calls category dot). The lines are shared
 * by every number. A neutral notice (a grey dot and one sentence, no box) says what a caller hears when every line is busy. "Add a line" is for the Owner only. With EXTRA_LINES off it has no price and opens a mail to us (we add the line by hand); with it on (`extra`) the total is the workspace's own and the Owner adds a line for the price shown, paid from the credits, and cancels it for the end of the month (ExtraLines.tsx). `lines` null = the route could not be read: one grey sentence, never a guess; `total` 0 = calls are not switched on.
 * Server markup. The words come from the string store (`cpn.once.`).
 */
export function CallsAtOnce({ words, lines, owner, test = false, extra = null }: { words: Words; lines: Lines | null; owner: boolean; test?: boolean; extra?: ExtraProps | null }) {
  const t = makeT(words);
  const subject = encodeURIComponent(t("cpn.once.add"));
  return (
    <section data-part="calls-at-once" aria-labelledby="cpn-once-h" className={`mt-8 ${cardBox}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id="cpn-once-h" className="m-0 font-display text-xl font-semibold text-ink">
          {t("cpn.once.title")}
        </h2>
        {lines && lines.total > 0 ? (
          <b data-part="once-count" className="text-base font-semibold text-ink">
            {t("cpn.once.count", { used: lines.inUse, total: lines.total })}
          </b>
        ) : null}
      </div>
      {lines === null ? (
        <p role="status" data-part="once-unread" className="m-0 mt-2 text-[15px] text-muted">
          {t("cpn.once.unread")}
        </p>
      ) : lines.total === 0 ? (
        <p data-part="once-none" className="m-0 mt-2 text-[15px] text-muted">
          {t("cpn.once.none")}
        </p>
      ) : (
        <>
          <p className="m-0 mt-1 text-[15px] text-muted">{t("cpn.once.shared")}</p>
          <ul role="list" data-part="once-lines" className="m-0 mt-3 grid list-none grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-2.5 p-0">
            {lines.lines.map((l) => (
              <li key={l.n} data-line={l.n} data-state={l.state} className={`flex min-h-14 min-w-0 items-center gap-2.5 rounded-xl border px-3.5 py-2.5 font-semibold text-ink ${l.state === "open" ? "border-dashed border-line bg-transparent" : "border-line bg-surface"}`}>
                {l.state === "on_call" ? <span aria-hidden="true" data-k="call" className="size-2.5 shrink-0 rounded-full bg-current" /> : null}
                <span className="min-w-0">
                  {t("cpn.once.line", { n: l.n })}
                  <small className="block text-sm font-medium text-muted">{t(l.state === "open" ? "cpn.once.open" : "cpn.once.busy")}</small>
                </span>
              </li>
            ))}
          </ul>
          <p data-part="once-note" className="m-0 mt-3 flex items-start gap-2 text-[15px] text-muted">
            <span aria-hidden="true" className="mt-2 size-2 shrink-0 rounded-full bg-muted" />
            <span className="min-w-0">{t("cpn.once.note")}</span>
          </p>
        </>
      )}
      {test ? <p className="m-0 mt-2 text-sm text-muted">{t("cpn.once.test")}</p> : null}
      {extra !== null && owner && lines !== null && lines.total > 0 ? <ExtraLines words={words} overview={extra.overview} actions={extra.actions} creditsHref={extra.creditsHref} locale={extra.locale} test={extra.test} /> : null}
      {extra === null && owner && lines !== null && lines.total > 0 ? (
        <a data-part="add-line" href={`mailto:${ADDRESSES.support}?subject=${subject}`} className="mt-1 inline-flex min-h-11 items-center text-base font-semibold text-ink underline underline-offset-4">
          {t("cpn.once.add")}
        </a>
      ) : null}
    </section>
  );
}
