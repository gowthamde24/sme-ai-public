import { ArrowRight, Check, Clock, PhoneCall, Repeat } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { HowSteps } from "@/components/v2/site/HowSteps";
import { TeamLead, sixSteps } from "@/components/v2/site/steps";
import { LanguageChats, type SampleChat } from "@/components/v2/site/LanguageChats";
import { btnPrimary, container } from "@/components/v2/site/ui";
import type { SiteT } from "@/i18n/site";
import type { Lang } from "@/i18n/lang";
import { SITE_PACKS, say, textIn } from "@/lib/site/packs";
import { sitePath } from "@/lib/site/paths";

const kicker = "text-sm font-extrabold uppercase tracking-[0.12em]";
const CHAT_LANGS = ["te", "hi", "kn", "en"] as const;
const outline = "inline-flex min-h-14 items-center justify-center rounded-lg border-[1.5px] border-edge px-5 text-base font-bold text-ink hover:bg-surface-2";

/** "Currently built for": three plain cards, one for each business type that has a public page (their words are the pack's `home_card`), each a link to that page. No pictures. */
export function BuiltFor({ t, lang }: { t: SiteT; lang: Lang }) {
  return (
    <section id="business" aria-labelledby="business-h" className="scroll-mt-20 border-y border-line bg-surface">
      <div className={`${container} flex flex-col gap-4 py-7`}>
        <h2 id="business-h" className={`${kicker} text-muted`}>
          {t("home.biz.title")}
        </h2>
        <ul className="grid gap-3.5 md:grid-cols-3" data-part="pack-cards">
          {SITE_PACKS.map((p) => {
            const card = p.home_card;
            return (
              <li key={p.slug}>
                <Link href={sitePath(lang, { kind: "pack", slug: p.slug })} data-pack-card={p.slug} data-accent={p.accent} className="flex h-full flex-col gap-1 rounded-2xl border border-line bg-pack-bg px-5 py-[18px] text-ink hover:border-edge">
                  <strong className="text-xl leading-snug">{card ? textIn(card.title, lang) : textIn(p.names, lang)}</strong>
                  <span className="text-base">{card ? textIn(card.line, lang) : say(p.hero.eyebrow, lang)}</span>
                  <span className="mt-auto inline-flex min-h-11 items-center gap-1 pt-1 text-sm font-extrabold text-pack-text">
                    {card ? textIn(card.link, lang) : t("packs.see", { name: textIn(p.names, lang) })}
                    <ArrowRight className="size-4" aria-hidden="true" />
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}

/** Agent OWL as the team lead, the six steps (one helper owl each, what the owner does as "You: ..."), animated by the client component, and the loop back to step 1. */
export function HowSection({ t }: { t: SiteT }) {
  return (
    <section id="how" aria-labelledby="how-h" className={`${container} flex scroll-mt-20 flex-col gap-7 py-14 sm:py-[72px]`}>
      <div className="flex max-w-3xl flex-col gap-2.5">
        <p className={`${kicker} text-brand-text`}>{t("home.how.eyebrow")}</p>
        <h2 id="how-h" className="font-display text-3xl font-extrabold leading-[1.08] tracking-tight sm:text-4xl lg:text-[44px]">
          {t("home.how.title")}
        </h2>
      </div>
      <TeamLead t={t} />
      <HowSteps steps={sixSteps(t)} words={{ list: t("home.how.list"), pause: t("home.how.pause"), play: t("home.how.play") }} />
      <p data-part="loop" className="flex items-center gap-2.5 text-base font-semibold text-ink">
        <Repeat className="size-5 shrink-0 text-brand-text" aria-hidden="true" />
        {t("home.how.loop")}
      </p>
    </section>
  );
}

/** The dark band: the language tabs and the sliding sample chats (the chats are language-neutral strings, each in its own language). */
export function LanguagesSection({ t }: { t: SiteT }) {
  const chats: SampleChat[] = CHAT_LANGS.map((code) => ({
    code,
    label: t(`langs.sample.${code}.label`),
    shop: t(`langs.sample.${code}.shop`),
    q: t(`langs.sample.${code}.q`),
    a: t(`langs.sample.${code}.a`),
    tag: t(`langs.sample.${code}.tag`),
    q2: t(`langs.sample.${code}.q2`),
  }));
  return (
    <section id="languages" aria-labelledby="languages-h" className="scroll-mt-20 bg-night text-on-night">
      <div className={`${container} flex flex-wrap items-center gap-10 py-14 sm:py-[72px]`}>
        <LanguageChats
          chats={chats}
          words={{ tabs: t("home.lang.tabs"), panel: t("home.lang.panel"), online: t("home.lang.online"), note: t("home.lang.note"), pause: t("home.lang.pause"), play: t("home.lang.play") }}
        >
          <p className={`${kicker} text-brand`}>{t("home.lang.eyebrow")}</p>
          <h2 id="languages-h" className="font-display text-3xl font-extrabold leading-[1.08] tracking-tight sm:text-4xl lg:text-[44px]">
            {t("home.lang.title")}
          </h2>
          <p className="text-lg text-night-muted">{t("home.lang.sub")}</p>
        </LanguageChats>
      </div>
    </section>
  );
}

function Badge({ tone, children }: { tone: "ok" | "soon"; children: ReactNode }) {
  return <span className={`inline-flex items-center gap-1 self-start rounded-full px-2.5 py-1 text-xs font-extrabold uppercase ${tone === "ok" ? "bg-green-bg text-green-text" : "bg-brand-bg text-brand-text"}`}>{children}</span>;
}

/** Calls and voice: what is available now (missed calls caught, calls in one tap) and what is coming (voice reminders, agent calls). */
export function CallsSection({ t }: { t: SiteT }) {
  return (
    <section aria-labelledby="calls-h" className={`${container} flex flex-col gap-6 pb-6 pt-14 sm:pt-[72px]`}>
      <div className="flex max-w-3xl flex-col gap-2.5">
        <p className={`${kicker} text-brand-text`}>{t("home.calls.eyebrow")}</p>
        <h2 id="calls-h" className="font-display text-3xl font-extrabold leading-[1.1] tracking-tight sm:text-[42px]">
          {t("home.calls.title")}
        </h2>
      </div>
      <ul className="grid gap-4 md:grid-cols-3" data-part="calls">
        {([1, 2, 3] as const).map((n) => (
          <li key={n} data-calls={n} className="flex flex-col gap-2 rounded-[20px] border border-line bg-surface p-[22px]">
            <Badge tone={n === 1 ? "ok" : "soon"}>
              {n === 1 ? <PhoneCall className="size-3.5" aria-hidden="true" /> : <Clock className="size-3.5" aria-hidden="true" />}
              {n === 1 ? t("home.calls.available") : t("home.calls.soon")}
            </Badge>
            <h3 className="text-xl font-semibold leading-snug">{t(`home.calls.${n}.t`)}</h3>
            <p className="text-base text-muted">{t(`home.calls.${n}.d`)}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The pricing box: the trial, the four promises, and the two buttons. No amount appears: the plans and their prices are announced later. */
export function PricingBox({ t, lang }: { t: SiteT; lang: Lang }) {
  return (
    <section id="pricing" aria-labelledby="pricing-h" className={`${container} scroll-mt-20 pb-14 pt-12 sm:pb-[72px]`}>
      <div className="flex flex-wrap items-center gap-6 rounded-[28px] bg-brand-bg p-6 sm:p-8">
        <div className="flex min-w-0 flex-[1_1_460px] flex-col gap-2.5">
          <h2 id="pricing-h" className="font-display text-3xl font-extrabold tracking-tight sm:text-4xl">
            {t("home.price.title")}
          </h2>
          <p className="text-lg text-ink">{t("home.price.text")}</p>
          <ul className="flex flex-wrap gap-x-[18px] gap-y-1.5 text-sm font-bold text-ink" data-part="trust">
            {([1, 2, 3, 4] as const).map((n) => (
              <li key={n} className="inline-flex items-center gap-1.5">
                <Check className="size-4 text-green-text" aria-hidden="true" />
                {t(`home.trust.${n}`)}
              </li>
            ))}
          </ul>
        </div>
        <div className="flex flex-wrap gap-3">
          <Link href="/signup" className={`${btnPrimary} font-extrabold`}>
            {t("cta.start")}
          </Link>
          <Link href={sitePath(lang, { kind: "page", page: "pricing" })} className={`${outline} bg-surface`}>
            {t("home.price.plans")}
          </Link>
        </div>
      </div>
    </section>
  );
}

/** The last call to action, in the second dark band: start the trial, or talk to us. */
export function FinalCta({ t, lang }: { t: SiteT; lang: Lang }) {
  return (
    <section id="start" aria-labelledby="start-h" className="scroll-mt-20 bg-night text-on-night">
      <div className={`${container} flex flex-col gap-4 py-14 sm:py-16`}>
        <h2 id="start-h" className="max-w-3xl font-display text-4xl font-extrabold leading-[1.04] tracking-tight sm:text-5xl">
          {t("cta.title")}
        </h2>
        <div className="flex flex-wrap gap-3">
          <Link href="/signup" className={`${btnPrimary} font-extrabold`}>
            {t("cta.start")}
          </Link>
          <Link href={sitePath(lang, { kind: "page", page: "contact" })} className="inline-flex min-h-14 items-center justify-center rounded-lg border-[1.5px] border-night-line px-5 text-base font-bold text-on-night hover:bg-night-2">
            {t("cta.contact")}
          </Link>
        </div>
      </div>
    </section>
  );
}
