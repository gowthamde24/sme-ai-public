import { card, container, h2, lead } from "@/components/v2/landing/ui";
import type { LandingT } from "@/i18n/landing";

const STEPS = ["lead", "research", "requirement", "quote", "followup", "order"] as const;

export function How({ t }: { t: LandingT }) {
  return (
    <section id="how" aria-labelledby="how-h" className={`${container} scroll-mt-20 py-14 sm:py-20`}>
      <h2 id="how-h" className={h2}>{t("how.title")}</h2>
      <p className={lead}>{t("how.sub")}</p>
      <ol className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {STEPS.map((s, i) => (
          <li key={s} className={card}>
            <span className="grid size-8 place-items-center rounded-full border border-brand-edge bg-brand text-base font-semibold text-on-brand" aria-hidden="true">{i + 1}</span>
            <h3 className="mt-3 break-words text-xl font-semibold">{t(`step.${s}.t`)}</h3>
            <p className="mt-2 text-muted">{t(`step.${s}.d`)}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}
