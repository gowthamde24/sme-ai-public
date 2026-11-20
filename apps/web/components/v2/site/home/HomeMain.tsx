import { ArrowRight, Check, Clock, Languages, MessageCircle, Moon, Phone, PhoneCall as PhoneCallIcon, ShieldCheck, Zap } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { AssistantOrb } from "@/components/v2/LazyAssistantOrb";
import { HeroStage, LeakCalc, RadarFinder, WaitlistForm } from "@/components/v2/site/LazyIslands";
import { publicPlanLines } from "@/components/v2/site/PublicPlans";
import { hasWaitlist, waitlistWords, type WaitlistAction } from "@/components/v2/site/WaitlistSection";
import { teluguFontVariable } from "@/design/fonts";
import type { SiteLang } from "@/i18n/lang";
import type { SiteKey, SiteT } from "@/i18n/site";
import { SITE_LANGUAGE_NAMES } from "@/i18n/site-lang";
import { websiteOnly } from "@/lib/site/mode";
import { SITE_PACKS, textIn } from "@/lib/site/packs";
import { PUBLIC_PLANS, planVars, rupees, type PublicPlan } from "@/lib/site/plans";
import { turnstileSiteKey } from "@/lib/security/turnstile";
import { WAITLIST_LANGS, WAITLIST_LANG_NAMES } from "@/lib/waitlist/types";

import { AskBox } from "./AskBox";
import { ChatStack } from "./ChatStack";
import { FOUND_KEYS, STACK } from "./chat-stack";
import { FoundCard, StackProvider } from "./StackState";
import { WithWhatsapp } from "../home2/WithWhatsapp";

type Start = { href: string; label: string };
const k = (s: string) => s as SiteKey;
/** The words a client island needs, filled on the server (the site's dictionaries never reach the browser whole). */
const words = (t: SiteT, keys: readonly string[]): Record<string, string> => Object.fromEntries(keys.map((key) => [key, t(k(key))]));
const HERO_KEYS = [
  "h2.mode.picked",
  "h2.mode.listening",
  "h2.mode.wait",
  ...["te", "kn", "hi", "en"].map((c) => `h2.lang.${c}`),
  ...[1, 2, 3].flatMap((i) => [`h2.out.${i}.t`, `h2.out.${i}.d`]),
  ...[1, 2, 3, 4, 5, 6].flatMap((i) => [`h3.src.${i}.t`, `h3.src.${i}.d`]),
  "h2.hear",
  "h2.hear.on",
];
const FINDER_KEYS = [...["city", "near", "checked", "call", "ask", "skip", "list", "of", "empty"].map((x) => `h2.finder.${x}`), ...[1, 2, 3, 4].flatMap((i) => [`h2.finder.pin.${i}.what`, `h2.finder.pin.${i}.why`])];
const LEAK_KEYS = [...["enq", "miss", "buy", "avg", "in"].map((x) => `h2.leak.${x}`), ...["q", "sub", "s1", "s2", "s3", "s4", "warm", "cold", "with", "of", "note"].map((x) => `h3.leak.${x}`)];


/**
 * THE HOME PAGE (owner, 19 and 20 Nov 2026: "we don't need to mention each and every business"; "all the same in all layouts"; "keep the three animations"; "clean"). One page, one markup that reflows: every section is the same at 390, 430, 768,
 * 980, 1280 and 1440 px (columns stack, sizes follow clamp(), the spacing rhythm scales; the drawings are scaled whole, never swapped for a phone version; design/home3.css). Top to bottom: the hero (what the product is, three pills, the call
 * to action, and the stage: enquiries flying in from the platforms into the orb), "What should your assistant do?", the demo (one phone: the Telugu call's WhatsApp, three steps, what it found out), how many enquiries are reached in time
 * (the counter), the Lead Finder radar, what is built in, the plans, the final call to action. No business type is named or linked: the variety is in the examples.
 */
export function HomeMain({ t, lang, start, hasForm, waitlist }: { t: SiteT; lang: SiteLang; start: Start; hasForm: boolean; waitlist?: WaitlistAction }) {
  const cta: Start = { href: start.href, label: t("h3.cta") };
  return (
    <div className={`h3 ${teluguFontVariable}`} data-part="home3">
      <Hero t={t} cta={cta} />
      <Ask t={t} cta={cta} />
      <How t={t} />
      <section id="calc" aria-labelledby="calc-title" className="h3-sec">
        <div className="h3-wrap">
          <LeakCalc w={words(t, LEAK_KEYS)} />
        </div>
      </section>
      <section id="finder" aria-labelledby="finder-title" className="h3-sec">
        <div className="h3-wrap">
          <header className="h3-head">
            <h2 id="finder-title" className="h3-h2">
              {t("h3.radar.t")}
            </h2>
            <p className="h3-lead">{t("h3.radar.sub")}</p>
          </header>
          <RadarFinder w={words(t, FINDER_KEYS)} />
          <p className="h3-small h3-note">{t("h2.finder.note")}</p>
        </div>
      </section>
      <Built t={t} />
      <Plans t={t} cta={cta} />
      <Final t={t} lang={lang} cta={cta} hasForm={hasForm} waitlist={waitlist} />
    </div>
  );
}

function Pill({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <li className="h3-pill">
      <span className="h3-pill-ico" aria-hidden="true">
        {icon}
      </span>
      {children}
    </li>
  );
}

function Hero({ t, cta }: { t: SiteT; cta: Start }) {
  const lines = t("h3.hero.t").split(". ").map((x, i, a) => (i < a.length - 1 ? `${x}.` : x));
  return (
    <section id="top-hero" aria-labelledby="h1" className="h3-sec h3-hero">
      <div className="h3-wrap h3-hero-text">
        <h1 id="h1" className="h3-h1">
          {lines.map((x, i) => (
            <span key={i} className="h3-line">
              {x}{" "}
            </span>
          ))}
        </h1>
        <p className="h3-lead h3-hero-p">{t("h3.hero.p")}</p>
        <ul className="h3-pills" aria-label={t("h3.hero.t")}>
          <Pill icon={<Zap size={16} strokeWidth={2.2} />}>{t("h3.pill.1")}</Pill>
          <Pill icon={<Clock size={16} strokeWidth={2.2} />}>{t("h3.pill.2")}</Pill>
          <Pill icon={<MessageCircle size={16} strokeWidth={2.2} />}>{t("h3.pill.3")}</Pill>
        </ul>
        <div className="h3-cta-row">
          <Link href={cta.href} className="h3-btn h3-btn-main" data-part="hero-cta">
            {cta.label}
            <ArrowRight size={18} strokeWidth={2.2} aria-hidden="true" />
          </Link>
          <Link href="#how" className="h3-btn h3-btn-line" data-part="hear-call">
            <PhoneCallIcon size={17} strokeWidth={2.2} aria-hidden="true" />
            {t("h2.hero.hear")}
          </Link>
        </div>
        {websiteOnly() ? (
          <p className="h3-small" data-part="trial-note">
            {t("demo.note")}
          </p>
        ) : null}
      </div>
      <div className="h3-wrap h3-stage-wrap">
        <HeroStage w={words(t, HERO_KEYS)} />
      </div>
    </section>
  );
}

function Ask({ t, cta }: { t: SiteT; cta: Start }) {
  return (
    <section id="ask" aria-labelledby="ask-title" className="h3-sec">
      <div className="h3-wrap h3-narrow">
        <header className="h3-head h3-head-center">
          <h2 id="ask-title" className="h3-h2">
            {t("h3.ask.title")}
          </h2>
          <p className="h3-lead">{t("h3.ask.sub")}</p>
        </header>
        <AskBox
          href={cta.href}
          words={{ label: t("h3.ask.label"), placeholder: t("h3.ask.ph"), go: t("h3.ask.go"), note: t("h3.ask.note") }}
          chips={[1, 2, 3, 4, 5].map((i) => t(k(`h3.ask.chip.${i}`)))}
        />
      </div>
    </section>
  );
}

function How({ t }: { t: SiteT }) {
  const found = [1, 2, 3] as const;
  return (
    <section id="how" aria-labelledby="how-title" className="h3-sec">
      <div className="h3-wrap">
        <header className="h3-head">
          <h2 id="how-title" className="h3-h2">
            {t("h3.how.title")}
          </h2>
          <p className="h3-lead">{t("h3.how.sub")}</p>
        </header>
        <StackProvider chats={STACK}>
        <div className="h3-how-grid">
          <div className="h3-how-phone" data-part="how-phone">
            <ChatStack chats={[...STACK]} chips={STACK.map((c) => SITE_LANGUAGE_NAMES[c.code].native)} captions={[1, 2, 3, 4].map((i) => t(k(`h3.stack.${i}`)))} sub={t("h3.phone.biz")} placeholder={t("h3.phone.msg")} />
          </div>
          <ol className="h3-steps" data-part="steps">
            {found.map((n) => (
              <li key={n} className="h3-step" data-step={n}>
                <span className="h3-step-n" aria-hidden="true">
                  {n}
                </span>
                <div>
                  <h3 className="h3-h3">{t(k(`h3.how.${n}.t`))}</h3>
                  <p className="h3-step-d">{t(k(`h3.how.${n}.d`))}</p>
                  {n === 3 ? (
                    <FoundCard heading={t("h3.how.f.h")} sets={FOUND_KEYS.map((rows) => rows.map(([l, v]) => ({ l: t(k(l)), v: t(k(v)) })))} />
                  ) : null}
                </div>
              </li>
            ))}
          </ol>
        </div>
        </StackProvider>
      </div>
    </section>
  );
}

function Built({ t }: { t: SiteT }) {
  const icons = [<Phone key="1" size={22} strokeWidth={2.2} />, <ShieldCheck key="2" size={22} strokeWidth={2.2} />, <Moon key="3" size={22} strokeWidth={2.2} />, <Languages key="4" size={22} strokeWidth={2.2} />];
  return (
    <section id="built" aria-labelledby="built-title" className="h3-sec">
      <div className="h3-wrap">
        <header className="h3-head">
          <h2 id="built-title" className="h3-h2">
            {t("h3.built.title")}
          </h2>
        </header>
        <ul className="h3-grid h3-grid-4" data-part="built-in">
          {icons.map((ico, i) => (
            <li key={i} className="h3-card" data-built={i + 1}>
              <span className="h3-ico" aria-hidden="true">
                {ico}
              </span>
              <h3 className="h3-h3">{t(k(`h3.built.${i + 1}.t`))}</h3>
              <p className="h3-card-d">{t(k(`h3.built.${i + 1}.d`))}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function PlanCard({ plan, t, cta }: { plan: PublicPlan; t: SiteT; cta: Start }) {
  return (
    <li className={`h3-card h3-plan ${plan.recommended ? "h3-plan-rec" : ""}`} data-plan={plan.id}>
      <div className="h3-plan-top">
        <h3 className="h3-h3">{plan.name}</h3>
        {plan.recommended ? <span className="h3-rec">{t("pp.pop")}</span> : null}
      </div>
      <p className="h3-price" data-part="plan-cost">
        {rupees(plan.monthly)} <span>{t("pp.mo")}</span>
      </p>
      <p className="h3-small">{t("pp.gst")}</p>
      <ul className="h3-plan-lines">
        {publicPlanLines(plan, t).map((line) => (
          <li key={line}>
            <Check size={16} strokeWidth={2.6} aria-hidden="true" />
            {line}
          </li>
        ))}
      </ul>
      <Link href={cta.href} className={`h3-btn ${plan.recommended ? "h3-btn-main" : "h3-btn-line"}`}>
        {cta.label}
      </Link>
    </li>
  );
}

function Plans({ t, cta }: { t: SiteT; cta: Start }) {
  return (
    <section id="plans" aria-labelledby="plans-title" className="h3-sec">
      <div className="h3-wrap">
        <header className="h3-head">
          <h2 id="plans-title" className="h3-h2">
            {t("h2.plans.title")}
          </h2>
          <p className="h3-lead">{t("h2.plans.sub")}</p>
        </header>
        <ul className="h3-grid h3-grid-3" data-part="plans">
          {PUBLIC_PLANS.map((p) => (
            <PlanCard key={p.id} plan={p} t={t} cta={cta} />
          ))}
        </ul>
        <p className="h3-plans-free" data-part="plans-free">
          {t("h3.plans.free")}
        </p>
        <p className="h3-plans-foot">
          <span>{t("pp.sh.2", planVars())}</span>
          <Link href="/pricing" className="h3-link" data-part="plans-more">
            {t("h3.plans.more")}
            <ArrowRight size={16} strokeWidth={2.4} aria-hidden="true" />
          </Link>
        </p>
      </div>
    </section>
  );
}

/** The final call to action: the orb with its rings, the line, and the early-access bar (name, phone, type of business, city) on the existing joinWaitlist action; without the waitlist, the button stands in. The section is `#demo`, where every "early access" leads. */
function Final({ t, lang, cta, hasForm, waitlist }: { t: SiteT; lang: SiteLang; cta: Start; hasForm: boolean; waitlist?: WaitlistAction }) {
  const form = hasForm && hasWaitlist(waitlist);
  const formWords = { ...waitlistWords(t), name: t("h2.join.name"), contact: t("h2.join.phone"), type: t("h2.join.biz"), city: t("h2.join.city"), submit: t("demo.submit"), thanksTitle: t("h2.join.thanks"), thanksBody: t("h2.join.once") };
  return (
    <section id={form ? "demo" : "join"} aria-labelledby="join-title" className="h3-sec h3-final">
      <div className="h3-wrap h3-narrow h3-final-in">
        <div className="h3-orb">
          <span className="h2-orbwrap relative block size-full overflow-hidden">
            <AssistantOrb state="idle" />
          </span>
        </div>
        <h2 id="join-title" className="h3-h2 h3-center">
          {t("h3.final.t")}
        </h2>
        <p className="h3-lead h3-center">
          <WithWhatsapp text={t("h2.join.sub")} />
        </p>
        {form ? (
          <WaitlistForm
            variant="bar"
            lang={lang}
            types={SITE_PACKS.map((p) => ({ slug: p.slug, name: textIn(p.names, lang) })).concat([{ slug: "other", name: t("contact.type.other") }])}
            langs={WAITLIST_LANGS.map((code) => ({ code, name: WAITLIST_LANG_NAMES[code] }))}
            words={formWords}
            turnstile={turnstileSiteKey()}
            action={waitlist}
            privacyHref="/privacy"
            idPrefix="join"
          />
        ) : (
          <Link href={cta.href} className="h3-btn h3-btn-main h3-btn-big">
            {cta.label}
          </Link>
        )}
        {form ? null : <p className="h3-small h3-center">{t("h2.join.once")}</p>}
      </div>
    </section>
  );
}
