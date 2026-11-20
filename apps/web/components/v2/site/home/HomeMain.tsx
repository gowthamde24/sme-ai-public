import { ArrowRight, Clock, MessageCircle, PhoneCall as PhoneCallIcon, Zap } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { AssistantOrb } from "@/components/v2/LazyAssistantOrb";
import { HeroStage, WaitlistForm } from "@/components/v2/site/LazyIslands";
import { hasWaitlist, waitlistWords, type WaitlistAction } from "@/components/v2/site/WaitlistSection";
import { teluguFontVariable } from "@/design/fonts";
import type { SiteLang } from "@/i18n/lang";
import type { SiteKey, SiteT } from "@/i18n/site";
import { SITE_LANGUAGE_NAMES } from "@/i18n/site-lang";
import { websiteOnly } from "@/lib/site/mode";
import { SITE_PACKS, textIn } from "@/lib/site/packs";
import { turnstileSiteKey } from "@/lib/security/turnstile";
import { WAITLIST_LANGS, WAITLIST_LANG_NAMES } from "@/lib/waitlist/types";

import { AskBox } from "./AskBox";
import { ChatStack } from "./ChatStack";
import { STACK } from "./chat-stack";
import { LowerSections } from "./Lower";
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
      <LowerSections t={t} />
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
                    <div className="h3-found" data-part="found-out">
                      <p className="h3-found-h">{t("h3.how.f.h")}</p>
                      <dl>
                        {found.map((f) => (
                          <div key={f}>
                            <dt>{t(k(`h3.how.f.${f}`))}</dt>
                            <dd>{t(k(`h3.how.f.${f}.v`))}</dd>
                          </div>
                        ))}
                      </dl>
                    </div>
                  ) : null}
                </div>
              </li>
            ))}
          </ol>
        </div>
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
