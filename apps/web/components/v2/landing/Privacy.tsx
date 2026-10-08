import { ShieldCheck } from "lucide-react";

import { card, container, h2, lead } from "@/components/v2/landing/ui";
import type { LandingT } from "@/i18n/landing";

const ITEMS = [1, 2, 3, 4] as const;

export function Privacy({ t }: { t: LandingT }) {
  return (
    <section id="privacy" aria-labelledby="privacy-h" className={`${container} scroll-mt-20 py-14 sm:py-20`}>
      <h2 id="privacy-h" className={`${h2} flex items-center gap-3`}>
        <ShieldCheck className="size-8 text-brand-text" aria-hidden="true" />
        {t("privacy.title")}
      </h2>
      <p className={lead}>{t("privacy.sub")}</p>
      <ul className="mt-8 grid gap-4 sm:grid-cols-2">
        {ITEMS.map((n) => (
          <li key={n} className={card}>
            <h3 className="text-xl font-semibold">{t(`priv.${n}.t`)}</h3>
            <p className="mt-2 text-muted">{t(`priv.${n}.d`)}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
