import { Clock, ListChecks, MessagesSquare } from "lucide-react";

import { card, container, h2, lead } from "@/components/v2/landing/ui";
import type { LandingT } from "@/i18n/landing";

const ITEMS = [
  { n: 1, Icon: MessagesSquare },
  { n: 2, Icon: Clock },
  { n: 3, Icon: ListChecks },
] as const;

export function Problem({ t }: { t: LandingT }) {
  return (
    <section aria-labelledby="problem" className="border-y border-line bg-surface-2/60 py-14 sm:py-20">
      <div className={container}>
        <h2 id="problem" className={h2}>{t("problem.title")}</h2>
        <p className={lead}>{t("problem.sub")}</p>
        <ul className="mt-8 grid gap-4 md:grid-cols-3">
          {ITEMS.map(({ n, Icon }) => (
            <li key={n} className={card}>
              <Icon className="size-6 text-brand-text" aria-hidden="true" />
              <h3 className="mt-3 text-xl font-semibold">{t(`problem.${n}.t`)}</h3>
              <p className="mt-2 text-muted">{t(`problem.${n}.d`)}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
