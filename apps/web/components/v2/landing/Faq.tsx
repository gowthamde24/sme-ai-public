import { container, h2 } from "@/components/v2/landing/ui";
import type { LandingT } from "@/i18n/landing";

const QUESTIONS = [1, 2, 3, 4, 5, 6, 7] as const;

export function Faq({ t }: { t: LandingT }) {
  return (
    <section id="faq" aria-labelledby="faq-h" className={`${container} max-w-3xl scroll-mt-20 py-14 sm:py-20`}>
      <h2 id="faq-h" className={h2}>{t("faq.title")}</h2>
      <div className="mt-8 divide-y divide-line rounded-xl border border-line bg-surface">
        {QUESTIONS.map((n) => (
          <details key={n} className="group">
            <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-4 px-5 py-3 text-lg font-semibold">
              {t(`faq.${n}.q`)}
              <span aria-hidden="true" className="text-2xl leading-none text-brand-text transition-transform duration-200 group-open:rotate-45">+</span>
            </summary>
            <p className="px-5 pb-5 text-base text-muted">{t(`faq.${n}.a`)}</p>
          </details>
        ))}
      </div>
    </section>
  );
}
