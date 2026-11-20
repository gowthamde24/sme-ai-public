import { ArrowRight, Check, ChevronDown, Languages, Moon, Phone, PhoneCall as PhoneCallIcon, ShieldCheck } from "lucide-react";
import Link from "next/link";

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
import { OrbGate } from "./OrbGate";
import { StickyCta } from "./StickyCta";
import { FoundCard, LangTabs, StackProvider } from "./StackState";
import { WithWhatsapp } from "../home2/WithWhatsapp";

type Start = { href: string; label: string };
const k = (s: string) => s as SiteKey;
/** The words a client island needs, filled on the server (the site's dictionaries never reach the browser whole). */
const words = (t: SiteT, keys: readonly string[]): Record<string, string> => Object.fromEntries(keys.map((key) => [key, t(k(key))]));
/** The words that pick a sample plan card when a visitor types (lower case; English and the three scripts' own words). */
const JOB_KEYS = [
  ["site visit", "property", "flat", "plot", "house", "సైట్", "साइट", "ಸೈಟ್"],
  ["admission", "enquir", "అడ్మిషన్", "एडमिशन", "ಅಡ್ಮಿಷನ್"],
  ["demo", "remind", "class", "డెమో", "डेमो", "ಡೆಮೊ"],
  ["test drive", "car", "bike", "టెస్ట్", "टेस्ट", "ಟೆಸ್ಟ್"],
  ["order", "ready", "pickup", "ఆర్డర్", "ऑर्डर", "ಆರ್ಡರ್"],
];
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
      <How t={t} />
      <Ask t={t} cta={cta} />
      <section id="calc" aria-labelledby="calc-title" className="h3-sec">
        <div className="h3-wrap">
          <LeakCalc w={words(t, LEAK_KEYS)} />
        </div>
      </section>
      <section id="lead-finder" aria-labelledby="finder-title" className="h3-sec">
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
      <Faq t={t} />
      <Final t={t} lang={lang} cta={cta} hasForm={hasForm} waitlist={waitlist} />
      <StickyCta href={cta.href} label={cta.label} />
    </div>
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
        <div className="h3-cta-row">
          <Link href={cta.href} className="h3-btn h3-btn-main h3-btn-block" data-part="hero-cta">
            {cta.label}
            <ArrowRight size={18} strokeWidth={2.2} aria-hidden="true" />
          </Link>
          <Link href="#how-it-works" className="h3-textlink" data-part="hear-call">
            <PhoneCallIcon size={17} strokeWidth={2.2} aria-hidden="true" />
            {t("h2.hero.hear")}
          </Link>
        </div>
        <p className="h3-hero-plain">{t("h3.hero.langs")}</p>
        {websiteOnly() ? (
          <p className="h3-small" data-part="trial-note">
            {t("demo.note")}
          </p>
        ) : null}
      </div>
      <div className="h3-wrap h3-stage-wrap">
        <div className="h3-stage-slot" data-part="hero-stage-slot">
          <OrbGate>
            <HeroStage w={words(t, HERO_KEYS)} />
          </OrbGate>
        </div>
      </div>
    </section>
  );
}

function Ask({ t, cta }: { t: SiteT; cta: Start }) {
  return (
    <section id="ask" aria-labelledby="ask-title" className="h3-sec">
      <div className="h3-wrap h3-narrow">
        <header className="h3-head h3-head-center">
          <p className="h3-eyebrow">{t("h3.eb.ask")}</p>
          <h2 id="ask-title" className="h3-h2">
            {t("h3.ask.title")}
          </h2>
        </header>
        <AskBox
          href={cta.href}
          words={{ label: t("h3.ask.label"), placeholder: t("h3.ask.ph"), go: t("h3.ask.go"), who: t("h3.plan.l.who"), says: t("h3.plan.l.says"), when: t("h3.plan.l.when"), cost: t("h3.plan.l.cost"), costValue: t("h3.plan.cost"), plan: t("h3.plan.t") }}
          jobs={[1, 2, 3, 4, 5].map((i) => ({ chip: t(k(`h3.ask.chip.${i}`)), who: t(k(`h3.job.${i}.who`)), says: t(k(`h3.job.${i}.says`)), when: t(k(`h3.job.${i}.when`)), keys: JOB_KEYS[i - 1] }))}
        />
      </div>
    </section>
  );
}

function How({ t }: { t: SiteT }) {
  return (
    <section id="how-it-works" aria-labelledby="how-title" className="h3-sec">
      <div className="h3-wrap">
        <header className="h3-head">
          <p className="h3-eyebrow">{t("h3.eb.how")}</p>
          <h2 id="how-title" className="h3-h2">
            {t("h3.how.title")}
          </h2>
        </header>
        <StackProvider chats={STACK}>
          <div className="h3-how-grid">
            <div className="h3-how-phone" data-part="how-phone">
              <LangTabs chips={STACK.map((c) => SITE_LANGUAGE_NAMES[c.code].native)} codes={STACK.map((c) => c.code)} label={t("h3.tabs.label")} />
              <ChatStack chats={STACK} captions={[1, 2, 3, 4].map((i) => t(k(`h3.stack.${i}`)))} sub={t("h3.phone.biz")} placeholder={t("h3.phone.msg")} />
            </div>
            <FoundCard heading={t("h3.how.f.h")} listening={t("h3.found.listen")} summary={t("h3.found.sum")} sets={FOUND_KEYS.map((rows) => rows.map(([l, v]) => ({ l: t(k(l)), v: t(k(v)) })))} />
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
    <section id="pricing" aria-labelledby="plans-title" className="h3-sec">
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
function Faq({ t }: { t: SiteT }) {
  return (
    <section id="faq" aria-labelledby="faq-title" className="h3-sec">
      <div className="h3-wrap h3-narrow">
        <header className="h3-head h3-head-center">
          <p className="h3-eyebrow">{t("h4.eb.faq")}</p>
          <h2 id="faq-title" className="h3-h2">
            {t("h4.faq.t")}
          </h2>
        </header>
        <div className="h3-faq" data-part="faq">
          {[1, 2, 3, 4, 5].map((i) => (
            <details key={i} className="h3-faq-item">
              <summary>
                {t(k(`h4.faq.${i}.q`))}
                <ChevronDown aria-hidden="true" size={20} strokeWidth={2.2} />
              </summary>
              <p>{t(k(`h4.faq.${i}.a`))}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

function Final({ t, lang, cta, hasForm, waitlist }: { t: SiteT; lang: SiteLang; cta: Start; hasForm: boolean; waitlist?: WaitlistAction }) {
  const form = hasForm && hasWaitlist(waitlist);
  const formWords = { ...waitlistWords(t), name: t("h2.join.name"), contact: t("h2.join.phone"), type: t("h2.join.biz"), city: t("h2.join.city"), submit: t("demo.submit"), thanksTitle: t("h2.join.thanks"), thanksBody: t("h2.join.once") };
  return (
    <section id={form ? "demo" : "join"} aria-labelledby="join-title" className="h3-sec h3-final">
      <div className="h3-wrap h3-narrow h3-final-in">
        <h2 id="join-title" className="h3-h2 h3-center">
          {t("h3.final.t")}
        </h2>
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
        <p className="h3-small h3-center">
          <WithWhatsapp text={t("h4.final.line")} />
        </p>
      </div>
    </section>
  );
}
