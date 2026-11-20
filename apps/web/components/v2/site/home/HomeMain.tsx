import { ArrowRight, ChevronDown, Grip, Mic, Phone, PhoneCall as PhoneCallIcon, PhoneOff, Volume2 } from "lucide-react";
import Link from "next/link";

import { AssistantOrb } from "@/components/v2/LazyAssistantOrb";
import { HeroStage, WaitlistForm } from "@/components/v2/site/LazyIslands";
import { hasWaitlist, waitlistWords, type WaitlistAction } from "@/components/v2/site/WaitlistSection";
import { teluguDemoFontVariable, teluguFontVariable } from "@/design/fonts";
import type { SiteLang } from "@/i18n/lang";
import type { SiteKey, SiteT } from "@/i18n/site";
import { SITE_LANGUAGE_NAMES } from "@/i18n/site-lang";
import { websiteOnly } from "@/lib/site/mode";
import { SITE_PACKS, textIn } from "@/lib/site/packs";
import { turnstileSiteKey } from "@/lib/security/turnstile";
import { WAITLIST_LANGS, WAITLIST_LANG_NAMES } from "@/lib/waitlist/types";

import { AskBox } from "./AskBox";
import { ChatStack } from "./ChatStack";
import { FOUND_KEYS, GREETING_MENTIONS_AI, STACK } from "./chat-stack";
import { LowerSections } from "./Lower";
import { OrbGate } from "./OrbGate";
import { StickyCta } from "./StickyCta";
import { FoundCard, LangTabs, StackProvider } from "./StackState";
import { WithWhatsapp } from "../home2/WithWhatsapp";

type Start = { href: string; label: string };
const k = (s: string) => s as SiteKey;
/** The words a client island needs, filled on the server (the site's dictionaries never reach the browser whole). */
const words = (t: SiteT, keys: readonly string[]): Record<string, string> => Object.fromEntries(keys.map((key) => [key, t(k(key))]));
/** The demo phone's icons, drawn on the server so the page's script carries no icon code for them. */
const DEMO_ICONS = {
  callButtons: (
    <>
      <span className="h3-dp-btn">
        <Mic size={20} strokeWidth={2} />
      </span>
      <span className="h3-dp-btn">
        <Grip size={20} strokeWidth={2} />
      </span>
      <span className="h3-dp-btn">
        <Volume2 size={20} strokeWidth={2} />
      </span>
      <span className="h3-dp-btn h3-dp-end">
        <PhoneOff size={22} strokeWidth={2.2} />
      </span>
    </>
  ),
  headIcons: (
    <>
      <Phone aria-hidden="true" size={20} strokeWidth={2} />
      <span className="h3-dp-dots" aria-hidden="true" />
    </>
  ),
  mic: <Mic size={20} strokeWidth={2.2} />,
};

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


/**
 * THE HOME PAGE (owner, 19 and 20 Nov 2026: "we don't need to mention each and every business"; "all the same in all layouts"; "keep the three animations"; "clean"). One page, one markup that reflows: every section is the same at 390, 430, 768,
 * 980, 1280 and 1440 px (columns stack, sizes follow clamp(), the spacing rhythm scales; the drawings are scaled whole, never swapped for a phone version; design/home3.css). Top to bottom: the hero (what the product is, three pills, the call
 * to action, and the stage: enquiries flying in from the platforms into the orb), "What should your assistant do?", the demo (one phone: the Telugu call's WhatsApp, three steps, what it found out), how many enquiries are reached in time
 * (the counter), the Lead Finder radar, what is built in, the plans with the trust row, three questions, the final call to action. No business type is named or linked: the variety is in the examples.
 */
export function HomeMain({ t, lang, start, hasForm, waitlist }: { t: SiteT; lang: SiteLang; start: Start; hasForm: boolean; waitlist?: WaitlistAction }) {
  const cta: Start = { href: start.href, label: t("h3.cta") };
  return (
    <div className={`h3 ${lang === "te" ? teluguFontVariable : teluguDemoFontVariable}`} data-part="home3">
      <Hero t={t} cta={cta} />
      <How t={t} />
      <Ask t={t} cta={cta} />
      <LowerSections t={t} />
      <Faq t={t} />
      <Final t={t} lang={lang} cta={cta} hasForm={hasForm} waitlist={waitlist} />
      <StickyCta href={cta.href} label={cta.label} arrow={<ArrowRight size={18} strokeWidth={2.2} aria-hidden="true" />} />
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
          arrow={<ArrowRight size={18} strokeWidth={2.4} aria-hidden="true" />}
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
              <ChatStack chats={STACK} captions={[1, 2, 3, 4].map((i) => t(k(`h3.stack.${i}`)))} sub={t("h3.phone.biz")} placeholder={t("h3.phone.msg")} icons={DEMO_ICONS} />
            </div>
            <FoundCard heading={t("h3.how.f.h")} listening={t("h3.found.listen")} summary={t("h3.found.sum")} sets={FOUND_KEYS.map((rows) => rows.map(([l, v]) => ({ l: t(k(l)), v: t(k(v)) })))} />
          </div>
        </StackProvider>
      </div>
    </section>
  );
}

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
          {[1, 2, 3].map((i) => (
            <details key={i} className="h3-faq-item">
              <summary>
                {t(k(i === 2 && !GREETING_MENTIONS_AI ? "h4.faq.2.q.quiet" : `h4.faq.${i}.q`))}
                <ChevronDown aria-hidden="true" size={20} strokeWidth={2.2} />
              </summary>
              <p>{t(k(i === 2 && !GREETING_MENTIONS_AI ? "h4.faq.2.a.quiet" : `h4.faq.${i}.a`))}</p>
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
