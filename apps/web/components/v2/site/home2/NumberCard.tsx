import { Mark } from "@/components/v2/Mark";
import type { SiteT } from "@/i18n/site";

const Tick = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M20 6 9 17l-5-5" />
  </svg>
);

/**
 * "Your own business number" (landing v2 part B.8): the glass number card of a sample business. With SITE_KYC_COPY=1 (once Exotel confirms the KYC is done online) the title says "KYC done online" and the card's three KYC steps light up
 * in turn while the bar fills and the number comes into focus (CSS only); off, the section says "Your own business number" and the card shows the number alone. Server markup, no script.
 */
export function NumberSection({ t, kyc }: { t: SiteT; kyc: boolean }) {
  return (
    <section id="number" aria-labelledby="number-title" className="relative px-4 pb-0 pt-16 lg:px-8 lg:pb-10 lg:pt-28" data-kyc={kyc ? "on" : "off"}>
      <div className="mx-auto grid grid-cols-[minmax(0,1fr)] max-w-[1240px] items-center gap-8 lg:grid-cols-2 lg:gap-16">
        <div className="flex flex-col gap-5">
          <h2 id="number-title" className="m-0 font-display text-[34px] font-extrabold leading-[1.04] tracking-[-0.04em] lg:text-[56px] lg:leading-[1.02]">
            {kyc ? t("h2.num.title.kyc") : t("h2.num.title")}
          </h2>
          <p className="m-0 text-base leading-relaxed text-muted lg:text-lg">
            {t("h2.num.sub")}
            {kyc ? <> {t("h2.num.kyc.how")}</> : null}
          </p>
          <p className="m-0 text-[15px] text-muted">{t("h2.num.private")}</p>
        </div>
        <div className="relative">
          <span aria-hidden="true" className="absolute -right-10 -top-16 block size-[420px] rounded-full bg-[radial-gradient(circle,rgba(255,119,60,.26),rgba(236,72,110,.08)_45%,rgba(255,119,60,0)_70%)]" />
          <div className="h2-glass relative flex flex-col gap-7 rounded-[26px] p-[22px] lg:rounded-[32px] lg:p-9" data-part="number-card">
            <div className="flex items-center justify-between gap-3">
              <span className="inline-flex items-center gap-2.5 font-bold">
                <Mark px={22} />
                {t("h2.num.card")}
              </span>
              <span className="rounded-full bg-brand-bg px-3 py-1.5 text-[13px] font-bold text-brand-text">Padma Silks</span>
            </div>
            <p className={`m-0 font-display text-[34px] font-extrabold tabular-nums tracking-[-0.02em] lg:text-[52px] ${kyc ? "h2-knum" : ""}`} aria-label={t("h2.num.card")}>
              +91 •• •••• ••••
            </p>
            {kyc ? (
              <>
                <div className="h-1.5 overflow-hidden rounded-full bg-surface-2">
                  <div className="h2-kbar" />
                </div>
                <ol className="m-0 grid list-none grid-cols-3 gap-3 p-0">
                  {[1, 2, 3].map((i) => (
                    <li key={i} className="flex flex-col gap-2.5">
                      <span className={`h2-kdot h2-kdot-${i}`}>
                        <Tick />
                      </span>
                      <span className="text-[13px] font-extrabold lg:text-base">{t(`h2.num.step.${i}` as "h2.num.step.1")}</span>
                      <span className="text-[13px] text-muted">{t(`h2.num.step.${i}.d` as "h2.num.step.1.d")}</span>
                    </li>
                  ))}
                </ol>
              </>
            ) : null}
          </div>
          <p className="relative m-0 mt-3 text-sm text-muted">{t("h2.num.example")}</p>
        </div>
      </div>
    </section>
  );
}
