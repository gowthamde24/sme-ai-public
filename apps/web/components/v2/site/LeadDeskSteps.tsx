import type { SiteT } from "@/i18n/site";
import { LD_STEPS } from "@/lib/site/lead-desk";

/** The six steps of Lead Desk, numbered, in the order the work happens. Server markup only, and no import of any client component, so a page that draws it adds no script; the home page and /how-it-works draw the same list. */
export function LeadDeskSteps({ t }: { t: SiteT }) {
  return (
    <ol aria-label={t("ld.steps.list")} className="grid gap-5 md:grid-cols-2 lg:grid-cols-3" data-part="ld-steps">
      {LD_STEPS.map((n) => (
        <li key={n} data-ld-step={n} className="flex flex-col gap-2.5 rounded-[20px] border border-line bg-surface p-7">
          <span aria-hidden="true" className="flex size-10 items-center justify-center rounded-xl bg-brand-bg font-display text-lg font-extrabold text-brand-text">
            {n}
          </span>
          <strong className="font-display text-xl font-bold leading-tight">{t(`ld.s.${n}.t`)}</strong>
          <span className="text-[15px] leading-relaxed text-muted">{t(`ld.s.${n}.d`)}</span>
        </li>
      ))}
    </ol>
  );
}
