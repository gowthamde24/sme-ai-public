import Link from "next/link";

import { HeroCall } from "@/components/v2/site/HeroCall";
import { Rich } from "@/components/v2/site/Rich";
import { bodyHome, btnPrimary, h1Home, h2Home, h3Industry, h3Row, pillHome, wrapHome } from "@/components/v2/site/ui";
import { Orb } from "@/components/v2/Orb";
import { VijayaOrb } from "@/components/v2/LazyVijayaOrb";
import { fill } from "@/i18n/fill";
import type { SiteT } from "@/i18n/site";
import type { Lang } from "@/i18n/lang";
import { CATALOGUE } from "@/lib/plan/catalogue";
import { CALL_STORIES, DAY_BLOCKS, FAQ_ITEMS, FIND_SOURCES, GREETINGS, HAVE_SOURCES, IND_POINTS, PLAN_LD_FEATURES, PLAN_WF_FEATURES, PROMISES, SPEED_ROWS } from "@/lib/site/home-v3";
import { startEntry } from "@/lib/site/entry";
import { deepCardKeys, leadDeskPlanName, LD_CHIPS } from "@/lib/site/lead-desk";
import { SITE_PACKS } from "@/lib/site/packs";
import { websiteOnly } from "@/lib/site/mode";
import { sitePath } from "@/lib/site/paths";
import { waitlistMode } from "@/lib/waitlist/mode";

const section = "scroll-mt-20 py-[84px] sm:py-[120px]";
const outline = "inline-flex min-h-14 items-center justify-center rounded-full border-[1.5px] border-ink px-6 text-base font-semibold text-ink hover:bg-surface-2 max-sm:w-full";
const slate = "text-muted";
const uiCard = "mt-3.5 max-w-[460px] rounded-[18px] border border-line bg-surface px-4 py-3.5 text-[15px]";
const uiWho = "mb-1 text-[12.5px] font-semibold text-muted";

/** The hero: the headline in three lines, what it is, two buttons, and the one moving thing of the page: Vijaya's wave orb over an example call (HeroCall). */
export function HomeHero({ t, lang, hasForm }: { t: SiteT; lang: Lang; hasForm: boolean }) {
  const start = startEntry(t, lang, t("hero.cta"), { hasForm });
  const story = CALL_STORIES[0];
  const lines = story.lines.map((l) => ({ ...l, te: fill(l.te), en: fill(l.en) }));
  return (
    <section aria-labelledby="h1" className="bg-surface pb-[84px] pt-10 sm:pb-[120px]">
      <div className={`${wrapHome} grid items-center gap-10 lg:grid-cols-[minmax(0,1.22fr)_minmax(0,0.78fr)]`}>
        <div>
          <h1 id="h1" className={h1Home}>
            <span className="block">{t("v3.h1.1")}</span>
            <span className="block">{t("v3.h1.2")}</span>
            <span className="block">{t("v3.h1.3")}</span>
          </h1>
          <p className={`mt-7 max-w-[31em] text-lg leading-relaxed sm:text-xl ${slate}`}>{t("v3.hero.sub")}</p>
          <div className="mt-9 flex flex-wrap gap-3">
            <Link href={start.href} className={`${btnPrimary} rounded-full font-bold max-sm:w-full`}>
              {start.label}
            </Link>
            <Link href="#day" className={outline}>
              {t("v3.hero.secondary")}
            </Link>
          </div>
          <p className={`mt-5 text-[14.5px] ${slate}`} data-part="trial-note">
            {websiteOnly() ? t("demo.note") : t("v3.hero.fine")}
          </p>
        </div>
        <div aria-label={t("v3.call.label")} role="group" className="relative grid min-h-[560px] place-items-center max-lg:min-h-0 max-lg:pt-5">
          <span aria-hidden="true" data-part="hero-orb" className="absolute right-[4%] top-0 aspect-square w-[min(400px,78%)] rounded-full bg-[radial-gradient(circle_at_80%_70%,#4a1a0c,#24100b_55%,#120807)] shadow-[0_40px_90px_-20px_rgba(255,106,43,0.55)] max-lg:static max-lg:w-[min(320px,70%)]">
            <VijayaOrb state="speaking" />
          </span>
          <HeroCall
            lines={lines}
            seconds={story.seconds}
            words={{ label: t("v3.call.label"), name: t("v3.call.who"), business: t("v3.call.biz"), speaking: t("v3.call.speaking"), result: t("v3.call.result"), note: t("hm.demo.note") }}
          />
        </div>
      </div>
    </section>
  );
}

/** Leads we find for you, and leads you already get: two short columns of text chips. No logo of any other company. */
export function SourcesBand({ t }: { t: SiteT }) {
  return (
    <section id="sources" aria-label={t("ld.src.list")} className="scroll-mt-20 border-y border-line bg-surface py-14">
      <div className={`${wrapHome} grid gap-10 md:grid-cols-2`}>
        <div data-part="find">
          <h3 className="text-xl font-bold">{t("v3.src.find.t")}</h3>
          <p className={`mt-1.5 text-[15.5px] ${slate}`}>{t("v3.src.find.d")}</p>
          <ul className="mt-4 flex flex-wrap gap-2">
            {FIND_SOURCES.map((n) => (
              <li key={n} className={`${pillHome} !border-transparent !bg-amber-bg`}>
                {t(`v3.src.find.${n}`)}
              </li>
            ))}
          </ul>
        </div>
        <div data-part="have">
          <h3 className="text-xl font-bold">{t("v3.src.have.t")}</h3>
          <p className={`mt-1.5 text-[15.5px] ${slate}`}>{t("v3.src.have.d")}</p>
          <ul className="mt-4 flex flex-wrap gap-2" data-part="sources">
            {HAVE_SOURCES.map((s) => (
              <li key={s.id} className={pillHome}>
                {t(s.key)}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

const CARD_LOOK = { found: "border-transparent bg-amber-bg", wa: "border-transparent bg-green-bg", plain: "" } as const;

/** "A day with {brand}": six moments, a time on the left and what happens, with a small example under some of them. Plain markup; nothing moves. */
export function DaySection({ t }: { t: SiteT }) {
  return (
    <section id="day" aria-labelledby="day-h" className={`${section} bg-surface-2`}>
      <div className={`${wrapHome} grid gap-12 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] lg:gap-16`}>
        <div className="lg:sticky lg:top-28 lg:self-start">
          <h2 id="day-h" className={h2Home}>
            {t("v3.day.t")}
          </h2>
          <p className={`mt-5 max-w-[36em] text-[19px] ${slate}`}>{t("v3.day.d")}</p>
        </div>
        <ol className="relative m-0 list-none p-0 before:absolute before:bottom-2 before:left-[70px] before:top-2 before:w-0.5 before:bg-line sm:before:left-[92px]" data-part="day">
          {DAY_BLOCKS.map((b) => (
            <li key={b.n} className="relative grid grid-cols-[70px_minmax(0,1fr)] gap-x-[26px] pb-11 last:pb-0 sm:grid-cols-[92px_minmax(0,1fr)] sm:gap-x-9 after:absolute after:left-16 after:top-[9px] after:size-3.5 after:rounded-full after:border-[3px] after:border-brand-text after:bg-surface-2 sm:after:left-[86px]">
              <time className="pr-4 text-right font-display text-lg font-bold leading-tight tabular-nums sm:pr-[22px] sm:text-[22px]">
                {t(`v3.day.${b.n}.time`)}
                {b.small ? <small className={`block font-sans text-[13px] font-medium ${slate}`}>{t(`v3.day.${b.n}.small` as "v3.day.1.small")}</small> : null}
              </time>
              <div>
                <h3 className="text-2xl font-bold tracking-[-0.01em]">{t(`v3.day.${b.n}.t`)}</h3>
                <p className={`mt-1.5 ${slate}`}>
                  <Rich text={t(`v3.day.${b.n}.d`)} />
                </p>
                {b.card ? (
                  <div className={`${uiCard} ${CARD_LOOK[b.card]}`}>
                    <div className={uiWho}>{t(`v3.day.${b.n}.who` as "v3.day.1.who")}</div>
                    <Rich text={t(`v3.day.${b.n}.ui` as "v3.day.1.ui")} className="font-bold text-green-text" />
                  </div>
                ) : null}
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

function Row({ n, t, children }: { n: 1 | 2 | 3 | 4 | 5; t: SiteT; children: React.ReactNode }) {
  return (
    <div data-row={n} className="grid items-center gap-7 border-t border-line py-14 lg:grid-cols-2 lg:gap-14">
      <div>
        <h3 className={h3Row}>{t(`v3.row.${n}.t`)}</h3>
        <p className={`mt-3.5 max-w-[32em] ${slate}`}>{t(`v3.row.${n}.d`)}</p>
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

const planBox = "flex flex-col gap-3 rounded-[22px] border border-line bg-surface p-5 shadow-[0_18px_40px_-24px_rgba(23,22,28,0.25)]";

/** Lead Desk as five editorial rows: approve all, tell the assistant, languages, your opening line, speed by source. Each has a small picture of the real thing. */
export function LeadDeskRows({ t }: { t: SiteT }) {
  return (
    <section id="leaddesk" aria-labelledby="leaddesk-h" className={`${section} bg-surface`}>
      <div className={wrapHome}>
        <h2 id="leaddesk-h" className={h2Home}>
          {t("v3.lead.t")}
        </h2>
        <p className={`mt-5 max-w-[36em] text-[19px] ${slate}`}>{t("v3.lead.d")}</p>
        <div className="mt-[72px] flex flex-col">
          <Row n={1} t={t}>
            <div className={planBox} aria-label={t("v3.plan.aria")} role="group">
              <dl className="m-0 grid grid-cols-[auto_minmax(0,1fr)] gap-x-[18px] gap-y-2 text-[15px]">
                {(["leads", "goal", "q", "hours"] as const).map((k) => (
                  <div key={k} className="contents">
                    <dt className={slate}>{t(`v3.plan.${k}`)}</dt>
                    <dd className="m-0 font-semibold">{t(`v3.plan.${k}.v` as "v3.plan.leads.v")}</dd>
                  </div>
                ))}
              </dl>
              <div aria-hidden="true" className="mt-1.5 grid h-12 place-items-center rounded-full bg-brand font-bold text-on-brand">
                {t("v3.plan.go")}
              </div>
            </div>
          </Row>
          <Row n={2} t={t}>
            <div className="flex flex-col gap-2.5">
              <p className="m-0 max-w-[88%] self-end rounded-[18px] rounded-br-md bg-ink px-4 py-3 text-[15.5px] text-bg">{t("v3.chat.me")}</p>
              <div className="flex items-start gap-3">
                <Orb px={36} state="ambient" />
                <p className="m-0 rounded-[18px] rounded-bl-md bg-surface-2 px-4 py-3 text-[15.5px]">{t("v3.chat.her")}</p>
              </div>
            </div>
          </Row>
          <Row n={3} t={t}>
            <ul aria-label={t("v3.greets.aria")} className="m-0 grid list-none grid-cols-2 gap-2.5 p-0 sm:grid-cols-3">
              {GREETINGS.map((g) => (
                <li key={g.code} className="rounded-2xl border border-line bg-surface p-3.5">
                  <b lang={g.code} className="block text-[22px] font-medium">
                    {g.word}
                  </b>
                  <span className={`text-[13px] ${slate}`}>{t(`v3.lang.${g.code}`)}</span>
                </li>
              ))}
            </ul>
          </Row>
          <Row n={4} t={t}>
            <p className="m-0 rounded-[18px] border-[1.5px] border-dashed border-line bg-surface p-[18px] text-[17px]" data-part="opening-example">
              {t("v3.opening")
                .split(/(\{\w+\})/)
                .map((part, i) => (/^\{\w+\}$/.test(part) ? <em key={i} className="font-semibold not-italic text-brand-text">{part}</em> : part))}
            </p>
          </Row>
          <Row n={5} t={t}>
            <dl className={`${planBox} m-0 grid grid-cols-[auto_minmax(0,1fr)] gap-x-[18px] gap-y-2 text-[15px] max-sm:gap-y-0.5`}>
              {SPEED_ROWS.map((n) => (
                <div key={n} className="contents">
                  <dt className={slate}>{t(`v3.speed.${n}.k`)}</dt>
                  <dd className="m-0 font-semibold">{t(`v3.speed.${n}.v`)}</dd>
                </div>
              ))}
            </dl>
          </Row>
        </div>
      </div>
    </section>
  );
}

/** The three industries that have pages of their own, as columns (a name, who it is for, four things), each linking to its page; then the other businesses as chips. */
export function IndustriesSection({ t, lang }: { t: SiteT; lang: Lang }) {
  return (
    <section id="industries" aria-labelledby="industries-h" className={`${section} bg-surface-2`}>
      <div className={wrapHome}>
        <h2 id="industries-h" className={h2Home}>
          {t("v3.ind.t")}
        </h2>
        <p className={`mt-5 max-w-[36em] text-[19px] ${slate}`}>{t("v3.ind.d")}</p>
        <ul className="m-0 mt-16 grid list-none gap-0 border-t border-line p-0 lg:grid-cols-3" data-part="pack-cards">
          {SITE_PACKS.filter((p) => deepCardKeys(p.id) !== null).map((p) => (
            <li key={p.slug} className="border-b border-line py-8 lg:border-b-0 lg:border-r lg:py-9 lg:pl-8 lg:pr-8 lg:first:pl-0 lg:last:border-r-0">
              <article>
                <h3 className={h3Industry}>
                  <Link href={sitePath(lang, { kind: "pack", slug: p.slug })} data-pack-card={p.slug} data-accent={p.accent} className="rounded-md hover:underline">
                    {t(`ld.deep.${p.id}.t` as "ld.deep.textiles.t")}
                  </Link>
                </h3>
                <p className={`mt-2.5 text-[15px] ${slate}`}>{t(`v3.ind.${p.id}.for` as "v3.ind.textiles.for")}</p>
                <ul className="m-0 mt-5 flex list-none flex-col gap-2.5 p-0">
                  {IND_POINTS.map((n) => (
                    <li key={n} className="relative pl-[18px] before:absolute before:left-0 before:top-[11px] before:h-0.5 before:w-2 before:bg-brand-text">
                      {t(`v3.ind.${p.id}.${n}` as "v3.ind.textiles.1")}
                    </li>
                  ))}
                </ul>
              </article>
            </li>
          ))}
        </ul>
        <div className="mt-12 grid gap-10 border-t border-line pt-8 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]" data-part="industries">
          <h3 className="text-[22px] font-bold">{t("v3.others.t")}</h3>
          <div>
            <p className={slate}>{t("v3.others.d")}</p>
            <ul aria-label={t("ld.chips.t")} className="m-0 mt-4 flex list-none flex-wrap gap-2 p-0">
              {LD_CHIPS.map((n) => (
                <li key={n} className={pillHome}>
                  {t(`ld.chip.${n}`)}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}

function PlanCard({ dark, title, who, tiers, features, price }: { dark?: boolean; title: string; who: string; tiers: string; features: readonly string[]; price: string }) {
  return (
    <article data-plan-card="" className={`flex flex-col gap-[18px] rounded-[28px] border p-7 sm:p-9 ${dark ? "border-transparent bg-night text-on-night" : "border-line bg-surface"}`}>
      <h3 className="font-display text-4xl font-extrabold tracking-[-0.025em]">{title}</h3>
      <p className={dark ? "text-night-muted" : slate}>{who}</p>
      <p className="text-[15px] font-semibold">{tiers}</p>
      <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
        {features.map((f) => (
          <li key={f} className={`relative pl-[26px] before:absolute before:left-0 before:top-2 before:h-[7px] before:w-3 before:-rotate-45 before:border-b-2 before:border-l-2 ${dark ? "text-night-muted before:border-[#7be0a9]" : "text-muted before:border-green-text"}`}>
            {f}
          </li>
        ))}
      </ul>
      <p className="mt-auto font-semibold">{price}</p>
    </article>
  );
}

const joinNames = (names: string[], and: string): string => (names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} ${and} ${names[names.length - 1]}`);

/** Two ways to start: Lead Desk, and the AI workforce. The tiers' names come from the plans data; no price (it says "Price at launch"), no plan is marked "most popular". */
export function PlansBand({ t }: { t: SiteT }) {
  const names = (kind: "calls" | "main") => CATALOGUE.plans.filter((p) => p.kind === kind).map((p) => leadDeskPlanName(p.id, p.name));
  const or = t("v3.plans.or");
  return (
    <section id="plans" aria-labelledby="plans-h" className={`${section} bg-surface`}>
      <div className={wrapHome}>
        <h2 id="plans-h" className={h2Home}>
          {t("v3.plans.t")}
        </h2>
        <p className={`mt-5 max-w-[36em] text-[19px] ${slate}`}>{t("v3.plans.d")}</p>
        <div className="mt-16 grid gap-6 lg:grid-cols-2" data-part="plans">
          <PlanCard title={t("v3.plan.ld.t")} who={t("v3.plan.ld.who")} tiers={joinNames(names("calls"), or)} features={PLAN_LD_FEATURES.map((n) => t(`v3.plan.ld.${n}`))} price={t("hm.pl.price")} />
          <PlanCard dark title={t("v3.plan.wf.t")} who={t("v3.plan.wf.who")} tiers={joinNames(names("main"), or)} features={PLAN_WF_FEATURES.map((n) => t(`v3.plan.wf.${n}`))} price={t("hm.pl.price")} />
        </div>
        <p className={`mt-7 max-w-[52em] text-[15.5px] ${slate}`}>{t("v3.plans.small")}</p>
      </div>
    </section>
  );
}

/** Four promises in plain words. */
export function PromisesBand({ t }: { t: SiteT }) {
  return (
    <section id="trust" aria-label={t("ld.trust.title")} className="scroll-mt-20 border-t border-line bg-surface py-[84px] sm:py-[120px]">
      <ul className={`${wrapHome} m-0 grid list-none gap-10 p-0 sm:grid-cols-2 lg:grid-cols-4`} data-part="trust-band">
        {PROMISES.map((n) => (
          <li key={n}>
            <h3 className="text-[19px] font-bold">{t(`v3.pro.${n}.t`)}</h3>
            <p className={`mt-2 text-[15.5px] ${slate}`}>{t(`v3.pro.${n}.d`)}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Questions owners ask: native disclosures, no script. */
export function FaqBand({ t }: { t: SiteT }) {
  return (
    <section id="faq" aria-labelledby="faq-h" className={`${section} bg-surface-2`}>
      <div className={wrapHome}>
        <h2 id="faq-h" className={h2Home}>
          {t("v3.faq.t")}
        </h2>
        <div className="mt-12 max-w-[860px] border-t border-line">
          {FAQ_ITEMS.map((n) => (
            <details key={n} className="group border-b border-line">
              <summary className="flex min-h-14 cursor-pointer list-none justify-between gap-5 py-6 text-[19px] font-semibold [&::-webkit-details-marker]:hidden">
                {t(`v3.faq.${n}.q`)}
                <span aria-hidden="true" className="mt-1.5 size-3.5 shrink-0 rotate-45 border-b-2 border-r-2 border-brand-text transition-transform duration-200 group-open:-rotate-[135deg]" />
              </summary>
              <p className={`max-w-[44em] pb-6 ${slate}`}>{t(`v3.faq.${n}.a`)}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

/** The closing band: Vijaya's orb, the last line, one button. */
export function CloseBand({ t, lang }: { t: SiteT; lang: Lang }) {
  const start = startEntry(t, lang, t("cta.start"), { hasForm: waitlistMode() !== "off" });
  return (
    <section id="start" aria-labelledby="start-h" className="scroll-mt-20 bg-surface py-[84px] sm:py-[120px]">
      <div className={wrapHome}>
        <div className="grid items-center gap-9 rounded-[36px] bg-night p-7 text-on-night sm:p-12 lg:grid-cols-[auto_minmax(0,1fr)_auto] lg:gap-12 lg:p-[72px]">
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
