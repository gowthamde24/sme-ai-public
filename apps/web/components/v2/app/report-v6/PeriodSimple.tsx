import { periodHref, type Period } from "@/lib/reports-v6/period";

import { dayShort } from "../visits/dates";
import { filtersOpen } from "@/lib/screens/flag";
import { LinkSentence } from "../jobs/pages/LazyLinkSentence";
import { EffectLine, MoreBox, pgCard } from "../jobs/pages/parts";
import { makeT, type Words } from "../words";
import { PrintButton } from "./Lazy";
import { cardBox } from "../Card";

/**
 * The period of the Reports page under JOBS (the simplicity pass): ONE card with "Show [the last 14 days]." (today, the last 14 days or this month, a choice inside the sentence), the one line that says which days are on the screen and which they are compared with, and the PDF button.
 * Picking your own two days is under "More choices" (the same GET form as the Custom button of before: `?range=custom&from=&to=`). The report itself is not touched. Every choice goes to the same address as before (`periodHref`).
 */
export function PeriodSimple({ words, lang, base, period }: { words: Words; lang: string; base: string; period: Period }) {
  const t = makeT(words);
  const custom = period.key === "custom";
  const options = [
    ...(["today", "14", "month"] as const).map((k) => ({ value: k, text: t(`jobs.pg.rep.per.${k}`), href: periodHref(base, k) })),
    ...(custom ? [{ value: "custom", text: t("jobs.pg.rep.per.custom", { from: dayShort(period.from, lang), to: dayShort(period.to, lang) }), href: periodHref(base, "custom", { from: period.from, to: period.to }) }] : []),
  ];
  const one = period.from === period.to;
  const plain = filtersOpen();
  return (
    <section data-part="period" data-simple="" className={plain ? `${cardBox} flex flex-col gap-3` : `${pgCard} flex flex-col gap-3`}>
      <LinkSentence plain={plain} line="period" template={t("jobs.pg.rep.line")} choices={{ period: { label: t("rv6.range.label"), value: period.key, options } }} />
      {plain ? <p data-part="period-effect" className="m-0 text-[14px] text-muted">{one ? t("jobs.pg.rep.effect.one", { day: dayShort(period.from, lang), prev: dayShort(period.previous.to, lang) }) : t("jobs.pg.rep.effect", { from: dayShort(period.from, lang), to: dayShort(period.to, lang), pfrom: dayShort(period.previous.from, lang), pto: dayShort(period.previous.to, lang) })}</p> : null}
      {plain ? null : <EffectLine
        part="period-effect"
        text={one ? t("jobs.pg.rep.effect.one", { day: dayShort(period.from, lang), prev: dayShort(period.previous.to, lang) }) : t("jobs.pg.rep.effect", { from: dayShort(period.from, lang), to: dayShort(period.to, lang), pfrom: dayShort(period.previous.from, lang), pto: dayShort(period.previous.to, lang) })}
      />}
      {plain ? (
        <div data-part="custom-days">
        <form action={`${base}/report`} method="get" className="flex flex-wrap items-end gap-3" key={`${period.key}-${period.from}-${period.to}`}>
          <input type="hidden" name="range" value="custom" />
          <label className="flex flex-col gap-1 text-sm font-semibold">
            {t("rv6.per.from")}
            <input type="date" name="from" defaultValue={period.from} className="write-ctl min-h-11 rounded-md border border-line bg-surface px-3 text-base font-normal" />
          </label>
          <label className="flex flex-col gap-1 text-sm font-semibold">
            {t("rv6.per.to")}
            <input type="date" name="to" defaultValue={period.to} className="write-ctl min-h-11 rounded-md border border-line bg-surface px-3 text-base font-normal" />
          </label>
          <button type="submit" className="min-h-11 rounded-md border border-edge bg-transparent px-[18px] text-[15px] font-semibold text-ink hover:bg-surface-2">
            {t("rv6.per.apply")}
          </button>
        </form>
        </div>
      ) : (
      <MoreBox title={t("jobs.pg.more")} sub={t("jobs.pg.rep.more.sub")} open={custom}>
        <form action={`${base}/report`} method="get" className="flex flex-wrap items-end gap-3" key={`${period.key}-${period.from}-${period.to}`}>
          <input type="hidden" name="range" value="custom" />
          <label className="flex flex-col gap-1 text-sm font-semibold">
            {t("rv6.per.from")}
            <input type="date" name="from" defaultValue={period.from} className="write-ctl min-h-11 rounded-md border border-line bg-surface px-3 text-base font-normal" />
          </label>
          <label className="flex flex-col gap-1 text-sm font-semibold">
            {t("rv6.per.to")}
            <input type="date" name="to" defaultValue={period.to} className="write-ctl min-h-11 rounded-md border border-line bg-surface px-3 text-base font-normal" />
          </label>
          <button type="submit" className="min-h-11 rounded-md border border-edge bg-transparent px-[18px] text-[15px] font-semibold text-ink hover:bg-surface-2">
            {t("rv6.per.apply")}
          </button>
        </form>
      </MoreBox>
      )}
      <div>
        <PrintButton label={t("rv6.pdf")} className="inline-flex min-h-11 items-center rounded-md border border-edge px-[18px] text-[15px] font-semibold text-ink hover:bg-surface-2" />
      </div>
    </section>
  );
}
