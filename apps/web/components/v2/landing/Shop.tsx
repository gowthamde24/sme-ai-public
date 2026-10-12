import { Bell, CalendarCheck, Images, MessageCircle, ReceiptIndianRupee, UserCheck } from "lucide-react";

import { card, container, h2, lead } from "@/components/v2/landing/ui";
import type { LandingT } from "@/i18n/landing";

const ITEMS = [
  [1, MessageCircle],
  [2, Images],
  [3, CalendarCheck],
  [4, Bell],
  [5, ReceiptIndianRupee],
  [6, UserCheck],
] as const;

/** What Agent OWL does for a saree or textile shop (job BS): six plain jobs. */
export function Shop({ t }: { t: LandingT }) {
  return (
    <section id="shop" aria-labelledby="shop-h" className={`${container} scroll-mt-20 py-14 sm:py-20`}>
      <h2 id="shop-h" className={h2}>{t("shop.title")}</h2>
      <p className={lead}>{t("shop.sub")}</p>
      <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {ITEMS.map(([n, Icon]) => (
          <li key={n} className={card}>
            <span className="grid size-11 place-items-center rounded-xl bg-brand-bg text-brand-text" aria-hidden="true">
              <Icon className="size-6" />
            </span>
            <h3 className="mt-3 break-words text-xl font-semibold">{t(`shop.${n}.t`)}</h3>
            <p className="mt-2 text-muted">{t(`shop.${n}.d`)}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
