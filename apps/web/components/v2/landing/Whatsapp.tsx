import { Bot, CircleSlash, MessageSquareWarning, Power, ShieldCheck, Timer, UserCheck } from "lucide-react";

import { card, container, h2, lead } from "@/components/v2/landing/ui";
import type { LandingT } from "@/i18n/landing";

const ITEMS = [
  [1, UserCheck],
  [2, CircleSlash],
  [3, Timer],
  [4, MessageSquareWarning],
  [5, Bot],
  [6, Power],
] as const;

/** "Your WhatsApp number stays safe" (job BS): what Agent OWL does so a number stays in good standing, each line something the app really does, and no promise about what WhatsApp decides. */
export function Whatsapp({ t }: { t: LandingT }) {
  return (
    <section id="whatsapp" aria-labelledby="wa-h" className="scroll-mt-20 border-y border-line bg-surface-2/60 py-14 sm:py-20">
      <div className={container}>
        <h2 id="wa-h" className={`${h2} flex items-center gap-3`}>
          <ShieldCheck className="size-8 shrink-0 text-brand-text" aria-hidden="true" />
          {t("wa.title")}
        </h2>
        <p className={lead}>{t("wa.sub")}</p>
        <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {ITEMS.map(([n, Icon]) => (
            <li key={n} className={card}>
              <Icon className="size-6 text-brand-text" aria-hidden="true" />
              <h3 className="mt-3 break-words text-xl font-semibold">{t(`wa.${n}.t`)}</h3>
              <p className="mt-2 text-muted">{t(`wa.${n}.d`)}</p>
            </li>
          ))}
        </ul>
        <p className="mt-6 max-w-2xl text-base text-muted">{t("wa.note")}</p>
      </div>
    </section>
  );
}
