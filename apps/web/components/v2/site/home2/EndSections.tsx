import Link from "next/link";

import { AssistantOrb } from "@/components/v2/LazyAssistantOrb";
import { WaitlistForm } from "@/components/v2/site/LazyIslands";
import { hasWaitlist, waitlistWords, type WaitlistAction } from "@/components/v2/site/WaitlistSection";
import type { SiteT } from "@/i18n/site";
import type { Lang } from "@/i18n/lang";
import { turnstileSiteKey } from "@/lib/security/turnstile";
import { siteTrialCopy } from "@/lib/screens/flag";
import { websiteOnly } from "@/lib/site/mode";
import { SITE_PACKS, textIn } from "@/lib/site/packs";
import { WAITLIST_LANGS, WAITLIST_LANG_NAMES } from "@/lib/waitlist/types";

import { WithWhatsapp } from "./WithWhatsapp";

type K = Parameters<SiteT>[0];
const k = (s: string) => s as K;
const h2 = "m-0 font-display text-[34px] font-extrabold leading-[1.04] tracking-[-0.04em] lg:text-[56px] lg:leading-[1.02]";
const Check = ({ on = true }: { on?: boolean }) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={on ? "#ff773c" : "#c9c4bc"} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="shrink-0">
    <path d={on ? "M20 6 9 17l-5-5" : "M6 12h12"} />
  </svg>
);

/**
 * Plans (landing v2 part B.10): one glass slab split by a line of light. AI Workforce (everything) and Lead Desk (the enquiries you already get), where the Lead Finder is crossed out. "Price at launch" on both: no amount. The trial
 * button follows website mode like every other (lib/site/entry.ts).
 */
export function PlansSlab({ t, start }: { t: SiteT; start: { href: string; label: string } }) {
  // the trial's length and GST wait for the lawyer's review and the GST registration (owner, 6 Nov 2026)
  const later = siteTrialCopy();
  const features = [1, 2, 3, 4, 5, 6].map((i) => t(k(`h2.plans.f.${i}`)));
  const plan = (name: string, sub: string, orb: boolean, inLeadDesk: boolean, primary: boolean) => (
    <div className="flex flex-col gap-[22px] p-6 lg:px-12 lg:py-11" data-plan={orb ? "workforce" : "leaddesk"}>
      <div className="flex min-h-16 items-center gap-4">
        {orb ? (
          <span className="h2-orbwrap block size-11 shrink-0 overflow-hidden lg:size-16">
            <AssistantOrb state="idle" />
          </span>
        ) : null}
        <div>
          <h3 className="m-0 font-display text-[26px] font-extrabold tracking-[-0.03em] lg:text-[34px]">{name}</h3>
          <p className={`m-0 mt-0.5 text-[15px] font-bold ${orb ? "text-brand-text" : "text-muted"}`}>{sub}</p>
        </div>
      </div>
      <ul className="m-0 flex list-none flex-col gap-3 p-0 text-base">
        {features.map((f, i) => {
          const on = !inLeadDesk || i !== 1;
          return (
            <li key={i} className={`flex items-center gap-3 ${on ? "" : "text-muted line-through"}`} data-feature={i + 1} data-off={on ? undefined : ""}>
              <Check on={on} />
              <span>{f}</span>
              {on ? null : <span className="sr-only">({t("h2.plans.not")})</span>}
            </li>
          );
        })}
      </ul>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-4">
        <p className="m-0 font-display text-[22px] font-bold" data-part="plan-cost">
          {t("h2.plans.price")}
        </p>
        <Link href={start.href} className={primary ? "inline-flex min-h-12 items-center rounded-full bg-[#ff773c] px-6 font-extrabold text-[#1e1e24] shadow-[0_10px_24px_-10px_rgba(255,119,60,.8)]" : "inline-flex min-h-12 items-center rounded-full bg-surface px-6 font-extrabold text-ink shadow-[inset_0_0_0_1.5px_var(--v2-border)]"}>
          {start.label}
        </Link>
      </div>
    </div>
  );
  return (
    <section id="plans" aria-labelledby="plans-title" className="px-4 pb-10 pt-16 lg:px-8 lg:pt-28">
      <div className="mx-auto flex max-w-[1240px] flex-col gap-6 lg:gap-9">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between lg:gap-10">
          <h2 id="plans-title" className={h2}>
            {later ? t("h2.later.plans.title") : t("h2.plans.title")}
          </h2>
          <p className="m-0 max-w-[380px] text-[15px] leading-relaxed text-muted">{later ? t("h2.later.plans.sub") : t("h2.plans.sub")}</p>
        </div>
        <div className="relative">
          <span aria-hidden="true" className="absolute left-[6%] top-[-60px] block size-[520px] rounded-full bg-[radial-gradient(circle,rgba(255,119,60,.28),rgba(236,72,110,.10)_45%,rgba(255,119,60,0)_70%)] blur-[10px]" />
          <div className="h2-glass relative grid rounded-[28px] lg:grid-cols-[minmax(0,1fr)_1px_minmax(0,1fr)] lg:rounded-[36px]">
            {plan(t("h2.plans.ws"), t("h2.plans.ws.sub"), true, false, true)}
            <span aria-hidden="true" className="block h-px bg-[linear-gradient(90deg,transparent,rgba(255,119,60,.55),rgba(236,72,110,.4),transparent)] lg:h-auto lg:w-px lg:bg-[linear-gradient(transparent,rgba(255,119,60,.55),rgba(236,72,110,.4),transparent)]" />
            {plan(t("h2.plans.ld"), t("h2.plans.ld.sub"), false, true, false)}
          </div>
        </div>
      </div>
    </section>
  );
}

/** Questions (landing v2 part B.11): an open list with hairline dividers, native disclosures (no script). The business-number answer names the KYC only with SITE_KYC_COPY=1. */
export function FaqList({ t, kyc }: { t: SiteT; kyc: boolean }) {
  return (
    <section id="faq" aria-labelledby="faq-title" className="px-4 pb-10 pt-16 lg:px-8 lg:pt-28">
      <div className="mx-auto grid max-w-[1240px] items-start gap-6 lg:grid-cols-[minmax(0,0.75fr)_minmax(0,1.25fr)] lg:gap-16">
        <h2 id="faq-title" className={`${h2} lg:sticky lg:top-[110px]`}>
          {t("h2.faq.title")}
        </h2>
        <div className="border-t border-line">
          {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => (
            <details key={i} className="h2-faq group border-b border-line" data-faq={i}>
              <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-6 py-5 lg:py-[26px] [&::-webkit-details-marker]:hidden">
                <span className="font-display text-xl font-bold tracking-[-0.02em] lg:text-2xl">{t(k(`h2.faq.${i}.q`))}</span>
                <span aria-hidden="true" className="flex size-10 shrink-0 items-center justify-center rounded-full bg-surface shadow-[inset_0_0_0_1.5px_var(--v2-border)] transition-transform duration-200 group-open:rotate-45 group-open:bg-[#ff773c]">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
                    <path d="M12 5v14M5 12h14" />
                  </svg>
                </span>
              </summary>
              <p className="m-0 mb-[26px] max-w-[640px] text-base leading-relaxed text-muted lg:text-[17px]">
                {t(k(`h2.faq.${i}.a`))}
                {i === 7 && kyc ? <> {t("h2.faq.7.kyc")}</> : null}
              </p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

/**
 * The finale (landing v2 part B.12): the orb with its rings and one glass command bar (name, mobile, business, city) on the existing joinWaitlist action, with its checks, its bot trap, the Turnstile check when it is on and the privacy
 * notice; no marketing box (the page promises no marketing messages). Without the waitlist (WAITLIST off) the bar is not drawn and the trial button stands in. The section is `#demo`, where every "Get early access" leads.
 */
export function Finale({ t, lang, action, start }: { t: SiteT; lang: Lang; action: WaitlistAction | undefined; start: { href: string; label: string } }) {
  const form = hasWaitlist(action);
  // website mode (job DQ): the site's one button is "Book a demo"; with the app open, "Get early access"
  const words = { ...waitlistWords(t), name: t("h2.join.name"), contact: t("h2.join.phone"), type: t("h2.join.biz"), city: t("h2.join.city"), submit: websiteOnly() ? t("demo.cta") : t("h2.nav.early"), thanksTitle: t("h2.join.thanks"), thanksBody: t("h2.join.once") };
  return (
    <section id={form ? "demo" : "join"} aria-labelledby="join-title" className="relative overflow-hidden px-4 pb-12 pt-[72px] lg:px-8 lg:pb-20 lg:pt-[120px]">
      <span aria-hidden="true" className="absolute left-1/2 top-[90px] block size-[1100px] -translate-x-1/2 rounded-full bg-[radial-gradient(circle,rgba(255,140,90,.22),rgba(236,72,110,.06)_42%,rgba(255,140,90,0)_66%)]" />
      <div className="relative mx-auto flex max-w-[980px] flex-col items-center gap-7 text-center">
        <div className="relative size-[200px] lg:size-[300px]">
          <span aria-hidden="true" className="h2-ring absolute inset-0 rounded-full" />
          <span aria-hidden="true" className="h2-ring h2-ring-2 absolute inset-0 rounded-full" />
          <span aria-hidden="true" className="h2-ring h2-ring-3 absolute inset-0 rounded-full" />
          <span className="h2-orbwrap relative block size-full overflow-hidden">
            <AssistantOrb state="idle" />
          </span>
        </div>
        <h2 id="join-title" className="m-0 font-display text-[40px] font-extrabold leading-none tracking-[-0.045em] lg:text-[72px]">
          {t("h2.join.title")}
        </h2>
        <p className="m-0 max-w-[620px] text-base leading-relaxed text-muted lg:text-lg">
          <WithWhatsapp text={t("h2.join.sub")} />
        </p>
        {form ? (
          <WaitlistForm
            variant="bar"
            lang={lang}
            types={SITE_PACKS.map((p) => ({ slug: p.slug, name: textIn(p.names, lang) })).concat([{ slug: "other", name: t("contact.type.other") }])}
            langs={WAITLIST_LANGS.map((code) => ({ code, name: WAITLIST_LANG_NAMES[code] }))}
            words={words}
            turnstile={turnstileSiteKey()}
            action={action}
            privacyHref="/privacy"
            idPrefix="join"
          />
        ) : (
          <Link href={start.href} className="inline-flex min-h-[60px] items-center rounded-full bg-[#ff773c] px-[30px] text-[17px] font-extrabold text-[#1e1e24]">
            {start.label}
          </Link>
        )}
        <p className="m-0 text-[13px] text-muted">{t("h2.join.once")}</p>
      </div>
    </section>
  );
}
