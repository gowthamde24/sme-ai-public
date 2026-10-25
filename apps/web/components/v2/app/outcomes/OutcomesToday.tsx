import { makeT, type Words } from "../words";
import { surface } from "../ui";
import type { OutcomeTotals } from "@/lib/outcomes/types";

/**
 * Today's totals on the Today screen (job DM): "[N] positive · [N] not interested" (and "[N] unclear" when there are some), counted from the calls and WhatsApp follow-ups that finished today. `totals` null = it could not be read
 * ("Not available yet"). A server component with no script.
 */
export function OutcomesToday({ words, totals }: { words: Words; totals: OutcomeTotals | null }) {
  const t = makeT(words);
  const any = totals !== null && totals.positive + totals.negative + totals.unclear > 0;
  return (
    <section aria-labelledby="outcomes-today-h" data-part="outcomes-today" className={`${surface} flex flex-wrap items-baseline gap-x-4 gap-y-1`}>
      <h2 id="outcomes-today-h" className="text-base font-semibold">
        {t("outcome.today.title")}
      </h2>
      {totals === null ? (
        <p className="text-base text-muted">{t("frame.notyet")}</p>
      ) : !any ? (
        <p className="text-base text-muted">{t("outcome.today.none")}</p>
      ) : (
        <p className="font-display text-xl font-semibold" data-totals={`${totals.positive}-${totals.negative}-${totals.unclear}`}>
          <span className="text-green-text">{t("outcome.today.positive", { n: totals.positive })}</span>
          <span aria-hidden="true" className="px-2 text-muted">
            ·
          </span>
          <span>{t("outcome.today.negative", { n: totals.negative })}</span>
          {totals.unclear > 0 ? (
            <>
              <span aria-hidden="true" className="px-2 text-muted">
                ·
              </span>
              <span className="text-muted">{t("outcome.today.unclear", { n: totals.unclear })}</span>
            </>
          ) : null}
        </p>
      )}
    </section>
  );
}
