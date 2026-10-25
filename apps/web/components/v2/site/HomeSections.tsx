import { ArrowRight } from "lucide-react";
import Link from "next/link";

import { Orb } from "@/components/v2/Orb";
import { HeroDemo, type DemoSample } from "@/components/v2/site/HeroDemo";
import { NaturalCalls } from "@/components/v2/site/NaturalCalls";
import { PlansPreview, type PlanTab } from "@/components/v2/site/PlansPreview";
import { Workforce, type WorkerCard } from "@/components/v2/site/Workforce";
import { EARLY, WORKERS } from "@/components/v2/app/mark/workers";
import { btnPrimary, container } from "@/components/v2/site/ui";
import type { SiteT } from "@/i18n/site";
import type { Lang } from "@/i18n/lang";
import { CATALOGUE } from "@/lib/plan/catalogue";
import { planGroups } from "@/lib/site/home-plans";
import { SITE_PACKS, say, textIn } from "@/lib/site/packs";
import { sitePath } from "@/lib/site/paths";

const kicker = "text-sm font-extrabold uppercase tracking-[0.12em]";
const SAMPLE_LANGS = ["te", "hi", "kn", "en"] as const;
const DEMOS = [1, 2, 3, 4] as const;
const outline = "inline-flex min-h-14 items-center justify-center rounded-lg border-[1.5px] border-edge px-5 text-base font-bold text-ink hover:bg-surface-2";

/** The four example conversations of the hero (each in its own language), drawn by the client component HeroDemo. */
export function HeroExample({ t }: { t: SiteT }) {
  const samples: DemoSample[] = DEMOS.map((n) => ({
    code: (["te", "hi", "kn", "en"] as const)[n - 1],
    label: `${t(`hm.demo.${n}.biz`)} · ${t(`langs.sample.${(["te", "hi", "kn", "en"] as const)[n - 1]}.label`)}`,
    shop: t(`langs.sample.demo.${n}.shop`),
    initials: t(`langs.sample.demo.${n}.shop`).split(/\s+/).slice(0, 2).map((w) => w[0]).join(""),
    caller: n === 3 ? t("hm.demo.3.caller") : t(`langs.sample.demo.${n}.caller` as "langs.sample.demo.1.caller"),
    info: t(`hm.demo.${n}.info`),
    result: t(`hm.demo.${n}.result`),
    msgs: ([1, 2, 3, 4] as const).map((m) => t(`langs.sample.demo.${n}.m${m}` as "langs.sample.demo.1.m1")),
  }));
  return <HeroDemo samples={samples} words={{ tabs: t("hm.demo.tabs"), assist: t("hm.demo.assist"), calling: t("hm.demo.calling"), note: t("hm.demo.note"), pause: t("hm.wf.pause"), play: t("hm.wf.play") }} />;
}

/** The six AI workers on the dark band, in the order of the workflow (find leads, research, AI calls, WhatsApp, outcome, follow-up). */
export function WorkforceSection({ t }: { t: SiteT }) {
  const workers: WorkerCard[] = WORKERS.map((n) => ({ n, name: t(`hm.w.${n}.n`), desc: t(`hm.w.${n}.d`), act: t(`hm.w.${n}.a`), early: EARLY.includes(n) }));
  return (
    <section id="workforce" aria-labelledby="workforce-h" className="scroll-mt-20 bg-night text-on-night">
      <div className={`${container} flex flex-col gap-10 py-14 sm:py-[72px]`}>
        <div className="flex max-w-3xl flex-col gap-3">
          <p className={`${kicker} text-brand`}>{t("hm.wf.eyebrow")}</p>
          <h2 id="workforce-h" className="font-display text-3xl font-extrabold leading-[1.08] tracking-tight [text-wrap:balance] sm:text-4xl lg:text-[44px]">
            {t("hm.wf.title")}
          </h2>
          <p className="text-lg text-night-muted">{t("hm.wf.sub")}</p>
        </div>
        <Workforce workers={workers} words={{ live: t("hm.wf.live"), list: t("hm.wf.list"), pause: t("hm.wf.pause"), play: t("hm.wf.play"), done: t("hm.wf.done"), next: t("hm.wf.next"), early: t("hm.wf.early") }} />
        <p className="text-base font-semibold text-night-muted" data-part="loop">
          {t("hm.loop")}
        </p>
      </div>
    </section>
  );
}

/** How you start: three steps, the trial's start day, and the promise that the owner stays in control. */
export function HowSection({ t }: { t: SiteT }) {
  return (
    <section id="how" aria-labelledby="how-h" className={`${container} flex scroll-mt-20 flex-col gap-10 py-14 sm:py-[72px]`}>
      <div className="flex max-w-3xl flex-col gap-3">
        <p className={`${kicker} text-brand-text`}>{t("hm.start.eyebrow")}</p>
        <h2 id="how-h" className="font-display text-3xl font-extrabold leading-[1.08] tracking-tight [text-wrap:balance] sm:text-4xl lg:text-[44px]">
          {t("hm.start.title")}
        </h2>
        <p className="text-base text-muted">{t("hm.start.sub")}</p>
      </div>
      <ol className="grid gap-5 md:grid-cols-3" data-part="start-steps">
        {([1, 2, 3] as const).map((n) => (
          <li key={n} className="flex flex-col gap-2.5 rounded-[20px] border border-line bg-surface p-7">
            <span className="flex size-10 items-center justify-center rounded-xl bg-brand-bg font-display text-lg font-extrabold text-brand-text">{n}</span>
            <strong className="font-display text-xl font-bold leading-tight">{t(`hm.start.${n}.t`)}</strong>
            <span className="text-[15px] leading-relaxed text-muted">{t(`hm.start.${n}.d`)}</span>
          </li>
        ))}
      </ol>
      <p className="rounded-2xl border border-brand-edge bg-brand-bg px-5 py-4 text-base font-semibold text-ink" data-part="trial-start">
        {t("hm.start.trial")}
      </p>
      <div className="flex flex-wrap items-center gap-4 rounded-2xl border border-line bg-bg px-6 py-5">
        <p className="flex-1 basis-[400px] text-base leading-normal">
          <strong>{t("hm.ctl.t")}</strong> <span className="text-muted">{t("hm.ctl.d")}</span>
        </p>
      </div>
    </section>
  );
}

/** "Built for": a card for each business type that has a public page (the pack's own `home_card`), and the businesses that come later. */
export function BuiltFor({ t, lang }: { t: SiteT; lang: Lang }) {
  return (
    <section id="business" aria-labelledby="business-h" className="scroll-mt-20 bg-night text-on-night">
      <div className={`${container} flex flex-col gap-10 py-14 sm:py-[72px]`}>
        <div className="flex max-w-3xl flex-col gap-3">
          <p className={`${kicker} text-brand`}>{t("hm.biz.eyebrow")}</p>
          <h2 id="business-h" className="font-display text-3xl font-extrabold leading-[1.08] tracking-tight [text-wrap:balance] sm:text-4xl lg:text-[44px]">
            {t("hm.biz.title")}
          </h2>
          <p className="text-lg text-night-muted">{t("hm.biz.sub")}</p>
        </div>
        <ul className="grid gap-4 md:grid-cols-3" data-part="pack-cards">
          {SITE_PACKS.map((p) => {
            const card = p.home_card;
            return (
              <li key={p.slug}>
                <Link href={sitePath(lang, { kind: "pack", slug: p.slug })} data-pack-card={p.slug} data-accent={p.accent} className="flex h-full flex-col gap-1.5 rounded-[22px] border border-line bg-pack-bg px-6 py-6 text-ink hover:border-edge">
                  <span className="text-xs font-bold uppercase tracking-wide text-pack-text">{textIn(p.names, lang)}</span>
                  <strong className="font-display text-2xl leading-snug">{card ? textIn(card.title, lang) : textIn(p.names, lang)}</strong>
                  <span className="text-base">{card ? textIn(card.line, lang) : say(p.hero.eyebrow, lang)}</span>
                  <span className="mt-auto inline-flex min-h-11 items-center gap-1 pt-2 text-sm font-extrabold text-pack-text">
                    {card ? textIn(card.link, lang) : t("packs.see", { name: textIn(p.names, lang) })}
                    <ArrowRight className="size-4" aria-hidden="true" />
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
        <div className="flex flex-col gap-5 rounded-[22px] border border-dashed border-night-line p-6 sm:p-7" data-part="soon">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex flex-col gap-1">
              <strong className="font-display text-xl">{t("hm.soon.t")}</strong>
              <span className="text-[15px] text-night-muted">{t("hm.soon.d")}</span>
            </div>
            <Link href={sitePath(lang, { kind: "page", page: "contact" })} className="inline-flex min-h-12 items-center justify-center rounded-xl bg-bg px-5 text-[15px] font-semibold text-ink hover:bg-surface-2">
              {t("hm.soon.cta")}
            </Link>
          </div>
          <ul aria-label={t("hm.soon.list")} className="flex flex-wrap gap-2.5">
            {([1, 2, 3, 4, 5, 6, 7, 8] as const).map((n) => (
              <li key={n} className="rounded-full border border-night-line bg-night-2 px-3.5 py-2 text-sm font-semibold text-night-muted">
                {t(`hm.soon.${n}`)}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

/** Natural AI calls (early access): language tabs and way-of-talking tabs with example lines; the numbered promises beside them. */
export function CallsSection({ t }: { t: SiteT }) {
  const lines = Object.fromEntries(SAMPLE_LANGS.map((l) => [l, Object.fromEntries((["warm", "resp", "quick"] as const).map((s) => [s, t(`langs.sample.voice.${l}.${s}` as "langs.sample.voice.te.warm")]))]));
  return (
    <section id="voice" aria-labelledby="voice-h" className={`${container} flex scroll-mt-20 flex-wrap items-center gap-12 py-14 sm:py-[72px]`}>
      <div className="flex min-w-0 flex-[1_1_400px] flex-col gap-5">
        <p className={`${kicker} text-brand-text`}>{t("hm.vc.eyebrow")}</p>
        <h2 id="voice-h" className="font-display text-3xl font-extrabold leading-[1.08] tracking-tight [text-wrap:balance] sm:text-4xl lg:text-[44px]">
          {t("hm.vc.title")}
        </h2>
        <p className="text-base leading-relaxed text-muted">{t("hm.vc.sub")}</p>
        <ul className="flex flex-col gap-3.5 text-[15px] leading-relaxed text-muted">
          {([1, 2, 3] as const).map((n) => (
            <li key={n} className="relative pl-[18px] before:absolute before:left-0 before:top-2.5 before:size-[7px] before:rounded-full before:bg-brand">
              <strong className="text-ink">{t(`hm.vc.${n}.t`)}</strong> {t(`hm.vc.${n}.d`)}
            </li>
          ))}
        </ul>
      </div>
      <NaturalCalls
        langs={SAMPLE_LANGS.map((l) => ({ code: l, label: t(`langs.sample.${l}.label`) }))}
        styles={(["warm", "resp", "quick"] as const).map((s) => ({ key: s, label: t(`hm.vc.${s}`) }))}
        lines={lines}
        words={{ langs: t("hm.vc.langs"), styles: t("hm.vc.styles"), who: t("hm.vc.who"), note: t("hm.vc.note") }}
      />
    </section>
  );
}

/** The plans, from the plans data: the full workforce and AI calling only. No price: "Price at launch". The AI calling plans lead to "early access", the others to the trial. */
export function PlansSection({ t, lang }: { t: SiteT; lang: Lang }) {
  const groups = planGroups(CATALOGUE, (key, vars) => t(key as "hm.pl.f.ai", vars as Record<string, string>));
  const contact = sitePath(lang, { kind: "page", page: "contact" });
  const tabs: PlanTab[] = groups.map((g) => ({ key: g.kind, label: t(g.kind === "main" ? "hm.pl.tab.main" : "hm.pl.tab.calls"), plans: g.plans.map((p) => ({ ...p, cta: t(g.kind === "main" ? "hm.pl.cta.main" : "hm.pl.cta.calls"), href: g.kind === "main" ? "/signup" : contact })) }));
  return (
    <section id="pricing" aria-labelledby="pricing-h" className="scroll-mt-20 border-t border-line bg-surface-2">
      <div className={`${container} flex flex-col gap-9 py-14 sm:py-[72px]`}>
        <div className="flex max-w-3xl flex-col gap-3">
          <p className={`${kicker} text-brand-text`}>{t("hm.pl.eyebrow")}</p>
          <h2 id="pricing-h" className="font-display text-3xl font-extrabold leading-[1.08] tracking-tight [text-wrap:balance] sm:text-4xl lg:text-[44px]">
            {t("hm.pl.title")}
          </h2>
          <p className="text-base leading-relaxed text-muted">{t("hm.pl.sub")}</p>
        </div>
        <PlansPreview tabs={tabs} label={t("hm.pl.tabs")} price={t("hm.pl.price")} />
        <ul className="flex flex-wrap gap-x-7 gap-y-2 text-sm text-muted" data-part="trust">
          {([1, 2, 3] as const).map((n) => (
            <li key={n}>✓ {t(`hm.pl.t${n}`)}</li>
          ))}
        </ul>
      </div>
    </section>
  );
}

/** Four promises in plain words. */
export function TrustBand({ t }: { t: SiteT }) {
  return (
    <section aria-label={t("trust.more")} className="border-y border-line bg-surface-2">
      <ul className={`${container} grid gap-6 py-12 sm:grid-cols-2 lg:grid-cols-4`} data-part="trust-band">
        {([1, 2, 3, 4] as const).map((n) => (
          <li key={n} className="flex flex-col gap-1.5">
            <strong className="text-[17px]">{t(`home.trust.${n}`)}</strong>
            <span className="text-[15px] leading-normal text-muted">{t(`hm.trust.${n}.d`)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The last call to action, with the AI circle above it. */
export function FinalCta({ t, lang }: { t: SiteT; lang: Lang }) {
  return (
    <section id="start" aria-labelledby="start-h" className={`${container} flex scroll-mt-20 flex-col items-center gap-5 py-16 text-center sm:py-24`}>
      <Orb px={72} state="think" halo />
      <h2 id="start-h" className="mt-3 max-w-[16em] font-display text-4xl font-extrabold leading-[1.06] tracking-tight [text-wrap:balance] sm:text-5xl">
        {t("cta.title")}
      </h2>
      <p className="max-w-[34em] text-[17px] leading-relaxed text-muted">{t("cta.sub")}</p>
      <div className="flex flex-wrap justify-center gap-3">
        <Link href="/signup" className={`${btnPrimary} font-extrabold`}>
          {t("cta.start")}
        </Link>
        <Link href={sitePath(lang, { kind: "page", page: "contact" })} className={outline}>
          {t("cta.contact")}
        </Link>
      </div>
    </section>
  );
}
