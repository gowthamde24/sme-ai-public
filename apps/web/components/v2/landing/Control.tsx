import { Ban, ListChecks, Lock, TriangleAlert, UserCheck } from "lucide-react";

import { EXAMPLE_MONEY_HELD_RUPEES } from "@/components/v2/landing/example-data";
import { card, container, h2, lead } from "@/components/v2/landing/ui";
import { formatINR } from "@/design/format";
import type { LandingT } from "@/i18n/landing";

const CARDS = [
  { n: 1, Icon: Ban },
  { n: 2, Icon: UserCheck },
  { n: 3, Icon: Lock },
  { n: 4, Icon: ListChecks },
] as const;
const LIFE = [1, 2, 3, 4, 5, 6, 7, 8] as const;

export function Control({ t }: { t: LandingT }) {
  return (
    <section id="control" aria-labelledby="control-h" className="scroll-mt-20 border-y border-line bg-surface-2/60 py-14 sm:py-20">
      <div className={container}>
        <h2 id="control-h" className={h2}>{t("control.title")}</h2>
        <p className={lead}>{t("control.sub")}</p>
        <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {CARDS.map(({ n, Icon }) => (
            <li key={n} className={card}>
              <Icon className="size-6 text-brand-text" aria-hidden="true" />
              <h3 className="mt-3 text-xl font-semibold">{t(`ctl.${n}.t`)}</h3>
              <p className="mt-2 text-muted">{t(`ctl.${n}.d`)}</p>
            </li>
          ))}
        </ul>

        <h3 className="mt-10 text-xl font-semibold">{t("ctl.lifecycle")}</h3>
        <ol className="mt-3 flex flex-wrap gap-2">
          {LIFE.map((n) => (
            <li key={n} className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-line bg-surface px-3 text-sm font-medium">
              <span className="grid size-5 place-items-center rounded-full bg-surface-2 text-sm text-muted" aria-hidden="true">{n}</span>
              {t(`life.${n}`)}
            </li>
          ))}
        </ol>
        <div role="note" className="mt-5 flex items-start gap-3 rounded-lg border border-amber-text bg-amber-bg p-4 text-amber-text">
          <TriangleAlert className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
          <div>
            <p className="font-semibold">{t("ctl.money", { held: formatINR(EXAMPLE_MONEY_HELD_RUPEES, { decimals: 2 }) })}</p>
            <p className="mt-1 text-base">{t("ctl.moneyNote")}</p>
            {/* the amount above is a made-up example: always labelled */}
            <p className="mt-2 inline-block rounded-md bg-info-bg px-2 py-1 text-sm font-medium text-info-text">{t("flow.example")}</p>
          </div>
        </div>
      </div>
    </section>
  );
}
