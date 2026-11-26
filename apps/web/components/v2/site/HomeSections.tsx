import Link from "next/link";

import { btnPrimary, wrapHome } from "@/components/v2/site/ui";
import { Orb } from "@/components/v2/Orb";
import type { SiteT } from "@/i18n/site";
import type { SiteLang } from "@/i18n/lang";
import { startEntry } from "@/lib/site/entry";
import { waitlistMode } from "@/lib/waitlist/mode";

/** The closing band of a business type's page and the security page: the assistant's orb, the last line, one button. (The home page has its own closing section, components/v2/site/home/HomeMain.tsx.) */
export function CloseBand({ t, lang }: { t: SiteT; lang: SiteLang }) {
  const start = startEntry(t, lang, t("cta.start"), { hasForm: waitlistMode() !== "off" });
  return (
    <section id="start" aria-labelledby="start-h" className="scroll-mt-20 bg-surface py-[84px] sm:py-[120px]">
      <div className={wrapHome}>
        <div className="grid items-center gap-9 rounded-xl bg-night p-7 text-on-night sm:p-12 lg:grid-cols-[auto_minmax(0,1fr)_auto] lg:gap-12 lg:p-[72px]">
          <Orb px={140} state="speak" />
          <div>
            <h2 id="start-h" className="font-display text-[length:clamp(30px,calc(2.4vw_+_12px),46px)] font-extrabold leading-[1.08] tracking-[-0.025em] [text-wrap:balance]">
              {t("v3.close.t")}
            </h2>
            <p className="mt-3.5 text-lg text-night-muted">{t("v3.close.d")}</p>
          </div>
          <Link href={start.href} className={`${btnPrimary} rounded-full font-bold`}>
            {start.label}
          </Link>
        </div>
      </div>
    </section>
  );
}
