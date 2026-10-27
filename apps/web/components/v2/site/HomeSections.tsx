import { ArrowRight } from "lucide-react";
import Link from "next/link";

import { Orb } from "@/components/v2/Orb";
import { HeroDemo, type DemoSample } from "@/components/v2/site/HeroDemo";
import { LeadDeskSteps } from "@/components/v2/site/LeadDeskSteps";
import { btnPrimary, container } from "@/components/v2/site/ui";
import type { SiteT } from "@/i18n/site";
import type { Lang } from "@/i18n/lang";
import { CATALOGUE } from "@/lib/plan/catalogue";
import { planGroups } from "@/lib/site/home-plans";
import { LD_CHIPS, LD_SOURCES, deepCardKeys, leadDeskPlanName } from "@/lib/site/lead-desk";
import { SITE_PACKS, say, textIn } from "@/lib/site/packs";
import { startEntry } from "@/lib/site/entry";
import { isServed } from "@/lib/site/mode";
import { sitePath } from "@/lib/site/paths";
import { waitlistMode } from "@/lib/waitlist/mode";

const kicker = "text-sm font-extrabold uppercase tracking-[0.12em]";
const h2 = "font-display text-3xl font-extrabold leading-[1.08] tracking-tight [text-wrap:balance] sm:text-4xl lg:text-[44px]";
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

/** How it works: the six steps of Lead Desk, then the one honest line about whom we call and when. */
export function HowSection({ t }: { t: SiteT }) {
  return (
    <section id="how" aria-labelledby="how-h" className={`${container} flex scroll-mt-20 flex-col gap-10 py-14 sm:py-[72px]`}>
      <div className="flex max-w-3xl flex-col gap-3">
        <p className={`${kicker} text-brand-text`}>{t("ld.steps.eyebrow")}</p>
        <h2 id="how-h" className={h2}>
          {t("ld.steps.title")}
        </h2>
        <p className="text-base text-muted">{t("ld.steps.sub")}</p>
      </div>
      <LeadDeskSteps t={t} />
      <p className="rounded-2xl border border-brand-edge bg-brand-bg px-5 py-4 text-base font-semibold text-ink" data-part="calling-rules">
        {t("ld.rules")}
      </p>
    </section>
  );
}

/** Where leads already come from: plain text chips. No logo of any other company. */
export function SourcesSection({ t }: { t: SiteT }) {
  return (
    <section id="sources" aria-labelledby="sources-h" className="scroll-mt-20 border-y border-line bg-surface-2">
      <div className={`${container} flex flex-col gap-8 py-14 sm:py-[72px]`}>
        <div className="flex max-w-3xl flex-col gap-3">
          <p className={`${kicker} text-brand-text`}>{t("ld.src.eyebrow")}</p>
          <h2 id="sources-h" className={h2}>
            {t("ld.src.title")}
          </h2>
          <p className="text-base text-muted">{t("ld.src.sub")}</p>
        </div>
        <ul aria-label={t("ld.src.list")} className="flex flex-wrap gap-3" data-part="sources">
          {LD_SOURCES.map((id) => (
            <li key={id} className="rounded-full border border-edge bg-surface px-5 py-3 text-base font-bold text-ink">
              {t(`ld.src.${id}`)}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

/** Made for your business: a deep card for each business type that has a page (its link kept), then a row of the other businesses Lead Desk is used for, as chips. */
export function BuiltFor({ t, lang }: { t: SiteT; lang: Lang }) {
  return (
    <section id="business" aria-labelledby="business-h" className="scroll-mt-20 bg-night text-on-night">
      <div className={`${container} flex flex-col gap-10 py-14 sm:py-[72px]`}>
        <div className="flex max-w-3xl flex-col gap-3">
          <p className={`${kicker} text-brand`}>{t("ld.biz.eyebrow")}</p>
          <h2 id="business-h" className={h2}>
            {t("ld.biz.title")}
          </h2>
          <p className="text-lg text-night-muted">{t("ld.biz.sub")}</p>
        </div>
        <ul className="grid gap-4 md:grid-cols-3" data-part="pack-cards">
          {SITE_PACKS.map((p) => {
            const keys = deepCardKeys(p.id);
            const card = p.home_card;
            const title = keys ? t(keys.title) : card ? textIn(card.title, lang) : textIn(p.names, lang);
            const line = keys ? t(keys.line) : card ? textIn(card.line, lang) : say(p.hero.eyebrow, lang);
            return (
              <li key={p.slug}>
                <Link href={sitePath(lang, { kind: "pack", slug: p.slug })} data-pack-card={p.slug} data-accent={p.accent} className="flex h-full flex-col gap-1.5 rounded-[22px] border border-line bg-pack-bg px-6 py-6 text-ink hover:border-edge">
                  <span className="text-xs font-bold uppercase tracking-wide text-pack-text">{t("ld.deep.tag")}</span>
                  <strong className="font-display text-2xl leading-snug">{title}</strong>
                  <span className="text-base">{line}</span>
                  <span className="mt-auto inline-flex min-h-11 items-center gap-1 pt-2 text-sm font-extrabold text-pack-text">
                    {t("packs.see", { name: title })}
                    <ArrowRight className="size-4" aria-hidden="true" />
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
        <div className="flex flex-col gap-4 rounded-[22px] border border-dashed border-night-line p-6 sm:p-7" data-part="industries">
          <strong className="font-display text-xl">{t("ld.chips.t")}</strong>
          <ul aria-label={t("ld.chips.t")} className="flex flex-wrap gap-2.5">
            {LD_CHIPS.map((n) => (
              <li key={n} className="rounded-full border border-night-line bg-night-2 px-3.5 py-2 text-sm font-semibold text-night-muted">
                {t(`ld.chip.${n}`)}
              </li>
            ))}
          </ul>
          <Link href={sitePath(lang, { kind: "page", page: "contact" })} className="inline-flex min-h-12 w-fit items-center justify-center rounded-xl bg-bg px-5 text-[15px] font-semibold text-ink hover:bg-surface-2">
            {t("hm.soon.cta")}
          </Link>
        </div>
      </div>
    </section>
  );
}

type PlanCardData = { id: string; name: string; features: string[] };

function PlanCards({ plans, price, cta, kind }: { plans: readonly PlanCardData[]; price: string; cta: { href: string; label: string }; kind: string }) {
  return (
    <div className="grid gap-5 lg:grid-cols-3" data-part="plans" data-plan-kind={kind}>
      {plans.map((p) => (
        <article key={p.id} data-plan-card="" className="flex flex-col gap-5 rounded-[22px] border border-line bg-surface p-7">
          <h4 className="font-display text-2xl font-bold">{p.name}</h4>
          <strong className="font-display text-2xl font-extrabold">{price}</strong>
          <ul className="flex flex-col gap-2.5 text-[15px] leading-relaxed text-muted">
            {p.features.map((f) => (
              <li key={f} className="flex gap-2.5">
                <span aria-hidden="true" className="font-bold text-brand-text">
                  ✓
                </span>
                {f}
              </li>
            ))}
          </ul>
          <span className="flex-1" />
          <Link href={cta.href} className="inline-flex min-h-12 items-center justify-center rounded-xl border border-edge bg-surface px-4 text-[15px] font-semibold text-ink hover:bg-surface-2">
            {cta.label}
          </Link>
        </article>
      ))}
    </div>
  );
}

/** The plans, from the plans data, in the two kinds: Lead Desk plans (the calls plans) and Workforce plans (Lead Desk + industry pack + lead finding + research). No price: "Price at launch". No plan is marked "most popular". */
export function PlansSection({ t, lang }: { t: SiteT; lang: Lang }) {
  const groups = planGroups(CATALOGUE, (key, vars) => t(key as "hm.pl.f.ai", vars as Record<string, string>));
  const start = startEntry(t, lang, t("hm.pl.cta.main"), { hasForm: waitlistMode() !== "off" });
  const kinds = [
    { kind: "calls" as const, title: t("ld.plans.ld.t"), text: t("ld.plans.ld.d"), note: null },
    { kind: "main" as const, title: t("ld.plans.wf.t"), text: t("ld.plans.wf.d"), note: t("ld.plans.wf.note") },
  ];
  return (
    <section id="pricing" aria-labelledby="pricing-h" className="scroll-mt-20 border-t border-line bg-surface-2">
      <div className={`${container} flex flex-col gap-10 py-14 sm:py-[72px]`}>
        <div className="flex max-w-3xl flex-col gap-3">
          <p className={`${kicker} text-brand-text`}>{t("hm.pl.eyebrow")}</p>
          <h2 id="pricing-h" className={h2}>
            {t("ld.plans.title")}
          </h2>
          <p className="text-base leading-relaxed text-muted">{t("hm.pl.sub")}</p>
        </div>
        {kinds.map((k) => {
          const group = groups.find((g) => g.kind === k.kind);
          if (!group) return null;
          return (
            <div key={k.kind} className="flex flex-col gap-5" data-plan-group={k.kind}>
              <div className="flex max-w-3xl flex-col gap-1">
                <h3 className="font-display text-2xl font-bold">{k.title}</h3>
                <p className="text-base text-muted">{k.text}</p>
              </div>
              <PlanCards plans={group.plans.map((p) => ({ ...p, name: leadDeskPlanName(p.id, p.name) }))} price={t("hm.pl.price")} cta={start} kind={k.kind} />
              {k.note ? <p className="text-sm text-muted">{k.note}</p> : null}
            </div>
          );
        })}
        <ul className="flex flex-wrap gap-x-7 gap-y-2 text-sm text-muted" data-part="trust">
          {([1, 2, 3] as const).map((n) => (
            <li key={n}>✓ {t(`hm.pl.t${n}`)}</li>
          ))}
        </ul>
      </div>
    </section>
  );
}

/** Trust: four promises in plain words, that the owner stays in control, and the one line about whom we call and when. Links to the security page only where that page is served. */
export function TrustBand({ t, lang }: { t: SiteT; lang: Lang }) {
  return (
    <section id="trust" aria-labelledby="trust-h" className="scroll-mt-20 border-b border-line">
      <div className={`${container} flex flex-col gap-8 py-14 sm:py-[72px]`}>
        <h2 id="trust-h" className={h2}>
          {t("ld.trust.title")}
        </h2>
        <ul className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4" data-part="trust-band">
          {([1, 2, 3, 4] as const).map((n) => (
            <li key={n} className="flex flex-col gap-1.5">
              <strong className="text-[17px]">{t(`home.trust.${n}`)}</strong>
              <span className="text-[15px] leading-normal text-muted">{t(`hm.trust.${n}.d`)}</span>
            </li>
          ))}
        </ul>
        <p className="text-base leading-normal" data-part="control">
          <strong>{t("hm.ctl.t")}</strong> <span className="text-muted">{t("hm.ctl.d")}</span>
        </p>
        <p className="text-base leading-normal text-muted" data-part="trust-rules">
          {t("ld.rules")}
        </p>
        {isServed({ kind: "page", page: "security" }) ? (
          <Link href={sitePath(lang, { kind: "page", page: "security" })} className="inline-flex min-h-11 w-fit items-center text-base font-semibold text-brand-text hover:underline">
            {t("trust.more")}
          </Link>
        ) : null}
      </div>
    </section>
  );
}

/** The last call to action, with the AI circle above it. */
export function FinalCta({ t, lang }: { t: SiteT; lang: Lang }) {
  const start = startEntry(t, lang, t("cta.start"), { hasForm: waitlistMode() !== "off" });
  return (
    <section id="start" aria-labelledby="start-h" className={`${container} flex scroll-mt-20 flex-col items-center gap-5 py-16 text-center sm:py-24`}>
      <Orb px={72} state="think" halo />
      <h2 id="start-h" className="mt-3 max-w-[16em] font-display text-4xl font-extrabold leading-[1.06] tracking-tight [text-wrap:balance] sm:text-5xl">
        {t("cta.title")}
      </h2>
      <p className="max-w-[34em] text-[17px] leading-relaxed text-muted">{t("cta.sub")}</p>
      <div className="flex flex-wrap justify-center gap-3">
        <Link href={start.href} className={`${btnPrimary} font-extrabold`}>
          {start.label}
        </Link>
        <Link href={sitePath(lang, { kind: "page", page: "contact" })} className={outline}>
          {t("cta.contact")}
        </Link>
      </div>
    </section>
  );
}
