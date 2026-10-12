import { card, container, h2, lead } from "@/components/v2/landing/ui";
import type { LandingT } from "@/i18n/landing";

const STEPS = [1, 2, 3] as const;

export function How({ t }: { t: LandingT }) {
  return (
    <section id="how" aria-labelledby="how-h" className={`${container} scroll-mt-20 py-14 sm:py-20`}>
      <h2 id="how-h" className={h2}>{t("how.title")}</h2>
      <p className={lead}>{t("how.sub")}</p>
      <ol className="mt-8 grid gap-4 md:grid-cols-3">
        {STEPS.map((n) => (
          <li key={n} className={card}>
            <span className="grid size-9 place-items-center rounded-full border border-brand-edge bg-brand text-lg font-semibold text-on-brand" aria-hidden="true">{n}</span>
            <h3 className="mt-3 break-words text-xl font-semibold">{t(`how.${n}.t`)}</h3>
            <p className="mt-2 text-muted">{t(`how.${n}.d`)}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}
