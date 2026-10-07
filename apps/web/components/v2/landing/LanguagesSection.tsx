import { Languages } from "lucide-react";

import { card, container, h2, lead } from "@/components/v2/landing/ui";
import type { LandingT } from "@/i18n/landing";
import { LANGS, LANGUAGE_NAMES } from "@/i18n/lang";

export function LanguagesSection({ t }: { t: LandingT }) {
  return (
    <section id="languages" aria-labelledby="langs-h" className="scroll-mt-20 border-y border-line bg-surface-2/60 py-14 sm:py-20">
      <div className={container}>
        <h2 id="langs-h" className={`${h2} flex items-center gap-3`}>
          <Languages className="size-8 text-brand-text" aria-hidden="true" />
          {t("langs.title")}
        </h2>
        <p className={lead}>{t("langs.sub")}</p>
        <ul className="mt-8 grid gap-4 sm:grid-cols-2">
          {LANGS.map((l) => (
            <li key={l} className={card}>
              <h3 className="font-display text-xl font-semibold">{LANGUAGE_NAMES[l].native}</h3>
              <p className="text-sm text-muted">{t("langs.sampleLabel")}</p>
              <p lang={l} className="mt-3 rounded-lg border border-line border-l-4 border-l-brand-edge bg-surface-2 p-3 text-base">
                {t(`langs.sample.${l}`)}
              </p>
            </li>
          ))}
        </ul>
        <p className="mt-4 text-sm text-muted">{t("langs.note")}</p>
      </div>
    </section>
  );
}
