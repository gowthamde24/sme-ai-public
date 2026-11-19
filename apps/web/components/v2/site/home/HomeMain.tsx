import { ArrowRight, Check, Clock, Languages, MessageCircle, Moon, Phone, PhoneCall as PhoneCallIcon, Play, ShieldCheck, Zap } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { AssistantOrb } from "@/components/v2/LazyAssistantOrb";
import { PhoneCall, PhoneChat, PpBubble, PpDay, PpLine } from "@/components/v2/PhonePreview";
import { WaitlistForm } from "@/components/v2/site/LazyIslands";
import { publicPlanLines } from "@/components/v2/site/PublicPlans";
import { hasWaitlist, waitlistWords, type WaitlistAction } from "@/components/v2/site/WaitlistSection";
import { teluguFontVariable } from "@/design/fonts";
import type { Lang } from "@/i18n/lang";
import type { SiteKey, SiteT } from "@/i18n/site";
import { websiteOnly } from "@/lib/site/mode";
import { SITE_PACKS, textIn } from "@/lib/site/packs";
import { PUBLIC_PLANS, planVars, rupees, type PublicPlan } from "@/lib/site/plans";
import { turnstileSiteKey } from "@/lib/security/turnstile";
import { WAITLIST_LANGS, WAITLIST_LANG_NAMES } from "@/lib/waitlist/types";

import { AskBox } from "./AskBox";
import { CALL_TE, VOICES, WA_TE } from "./demo-lines";
import { WithWhatsapp } from "../home2/WithWhatsapp";

type Start = { href: string; label: string };
const k = (s: string) => s as SiteKey;

/** The English (or Hindi, Kannada) meaning under a Telugu line of the sample phones; none on the Telugu page, where the line is already in the reader's language. */
const Gloss = ({ lang, text }: { lang: Lang; text: string }) => (lang === "te" ? null : <span className="h3-gloss">{text}</span>);

/**
 * THE HOME PAGE (owner, 19 Nov 2026: "we don't need to mention each and every business"; "all the same in all layouts"). One page, one markup that reflows: every section is the same at 390, 430, 768, 980, 1280 and 1440 px
 * (columns stack, sizes follow clamp(), the spacing rhythm scales; design/home3.css). There is NO second markup for a phone, no section hidden or swapped at a width, no script to measure the screen.
 * Top to bottom: the hero (what the product is, three pills, the CTA, a phone with a call), "What should your assistant do?" (a box and example chips that lead to sign-up), how it works (one phone: the Telugu call, the WhatsApp that
 * follows, what it found out; the dark band), "Hear our voices" (example calls; no audio exists, so the buttons are disabled), what is built in, the plans, the final call to action. The footer is the home footer.
 * No business type is named or linked anywhere on it.
 */
export function HomeMain({ t, lang, start, hasForm, waitlist }: { t: SiteT; lang: Lang; start: Start; hasForm: boolean; waitlist?: WaitlistAction }) {
  const cta: Start = { href: start.href, label: t("h3.cta") };
  return (
    <div className={`h3 ${teluguFontVariable}`} data-part="home3">
      <Hero t={t} lang={lang} cta={cta} />
      <Ask t={t} cta={cta} />
      <How t={t} lang={lang} />
      <Voices t={t} />
      <Built t={t} />
      <Plans t={t} cta={cta} />
      <Final t={t} lang={lang} cta={cta} hasForm={hasForm} waitlist={waitlist} />
    </div>
  );
}

function Pill({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <li className="h3-pill h2-glass">
      <span className="h3-pill-ico" aria-hidden="true">
        {icon}
      </span>
      {children}
    </li>
  );
}

function Hero({ t, lang, cta }: { t: SiteT; lang: Lang; cta: Start }) {
  const words = t("h3.hero.t").split(". ").map((s, i, a) => (i < a.length - 1 ? `${s}.` : s));
  return (
    <section id="top-hero" aria-labelledby="h1" className="h3-sec h3-hero">
      <span aria-hidden="true" className="h3-glow" />
      <div className="h3-wrap h3-hero-grid">
        <div className="h3-hero-text">
          <h1 id="h1" className="h3-h1">
            {words.map((w, i) => (
              <span key={i} className="h3-line">
                {w}{" "}
              </span>
            ))}
          </h1>
          <p className="h3-lead h3-hero-p">{t("h3.hero.p")}</p>
          <ul className="h3-pills" aria-label={t("h3.hero.t")}>
            <Pill icon={<Zap size={16} strokeWidth={2.4} />}>{t("h3.pill.1")}</Pill>
            <Pill icon={<Clock size={16} strokeWidth={2.4} />}>{t("h3.pill.2")}</Pill>
            <Pill icon={<MessageCircle size={16} strokeWidth={2.4} />}>{t("h3.pill.3")}</Pill>
          </ul>
          <div className="h3-cta-row">
            <Link href={cta.href} className="h3-btn h3-btn-main" data-part="hero-cta">
              {cta.label}
              <ArrowRight size={18} strokeWidth={2.4} aria-hidden="true" />
            </Link>
            <Link href="#voices" className="h3-btn h3-btn-line" data-part="hear-call">
              <PhoneCallIcon size={17} strokeWidth={2.3} aria-hidden="true" />
              {t("h2.hero.hear")}
            </Link>
          </div>
          {websiteOnly() ? (
            <p className="h3-small" data-part="trial-note">
              {t("demo.note")}
            </p>
          ) : null}
        </div>
        <div className="h3-hero-phone" data-part="hero-phone">
          <PhoneCall name="Padma Silks" sub="00:42" captions={t("h3.phone.cap")} animate keepFrame>
            {CALL_TE.map((line, i) => (
              <PpLine key={i} from={i % 2 === 0 ? "them" : "me"} who={i % 2 === 0 ? t("h3.phone.ai") : t("h3.phone.you")}>
                {line}
                <Gloss lang={lang} text={t(k(`h3.call.${i + 1}.g`))} />
              </PpLine>
            ))}
          </PhoneCall>
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
          <h2 id="ask-title" className="h3-h2">
            {t("h3.ask.title")}
          </h2>
          <p className="h3-lead">{t("h3.ask.sub")}</p>
        </header>
        <AskBox
          href={cta.href}
          words={{ label: t("h3.ask.label"), placeholder: t("h3.ask.ph"), mic: t("h3.ask.mic"), go: t("h3.ask.go"), note: t("h3.ask.note") }}
          chips={[1, 2, 3, 4, 5].map((i) => t(k(`h3.ask.chip.${i}`)))}
        />
      </div>
    </section>
  );
}

function How({ t, lang }: { t: SiteT; lang: Lang }) {
  const found = [1, 2, 3] as const;
  return (
    <section id="how" aria-labelledby="how-title" className="h3-sec h3-band">
      <span aria-hidden="true" className="h3-band-glow" />
      <div className="h3-wrap">
        <header className="h3-head">
          <h2 id="how-title" className="h3-h2">
            {t("h3.how.title")}
          </h2>
          <p className="h3-lead">{t("h3.how.sub")}</p>
        </header>
        <div className="h3-how-grid">
          <div className="h3-how-phone" data-part="how-phone">
            <PhoneChat name="Padma Silks" sub={t("h3.phone.biz")} placeholder={t("h3.phone.msg")} theme="dark" keepFrame>
              <PpDay>{t("h3.phone.today")}</PpDay>
              <PpDay>{t("h3.phone.calllog")}</PpDay>
              {WA_TE.map((line, i) => (
                <PpBubble key={i} from={i === 1 ? "me" : "them"} tail time={["9:41 am", "9:42 am", "9:42 am"][i]} ticks={i === 1 ? "read" : undefined}>
                  {line}
                  <Gloss lang={lang} text={t(k(`h3.wa.${i + 1}.g`))} />
                </PpBubble>
              ))}
            </PhoneChat>
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

function Voices({ t }: { t: SiteT }) {
  return (
    <section id="voices" aria-labelledby="voices-title" className="h3-sec">
      <div className="h3-wrap">
        <header className="h3-head">
          <h2 id="voices-title" className="h3-h2">
            {t("h3.voices.title")}
          </h2>
          <p className="h3-lead">{t("h3.voices.sub")}</p>
        </header>
        <ul className="h3-grid h3-grid-4" data-part="voices">
          {VOICES.map((v, i) => (
            <li key={v.name} className="h3-card h3-voice" data-voice={v.name}>
              <span className="h3-avatar" aria-hidden="true">
                {v.name[0]}
              </span>
              <h3 className="h3-h3">{v.name}</h3>
              <p className="h3-voice-lang">{t(k(`h2.lang.${v.lang}`))}</p>
              <p className="h3-card-d">{t(k(`h3.voice.${i + 1}.d`))}</p>
              {/* no recording exists yet: a disabled button that says so, never a player that plays nothing */}
              <button type="button" disabled aria-disabled="true" className="h3-play">
                <Play size={15} strokeWidth={2.4} aria-hidden="true" />
                {t("h3.voice.soon")}
              </button>
            </li>
          ))}
        </ul>
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
function Final({ t, lang, cta, hasForm, waitlist }: { t: SiteT; lang: Lang; cta: Start; hasForm: boolean; waitlist?: WaitlistAction }) {
  const form = hasForm && hasWaitlist(waitlist);
  const words = { ...waitlistWords(t), name: t("h2.join.name"), contact: t("h2.join.phone"), type: t("h2.join.biz"), city: t("h2.join.city"), submit: t("demo.submit"), thanksTitle: t("h2.join.thanks"), thanksBody: t("h2.join.once") };
  return (
    <section id={form ? "demo" : "join"} aria-labelledby="join-title" className="h3-sec h3-final">
      <span aria-hidden="true" className="h3-final-glow" />
      <div className="h3-wrap h3-narrow h3-final-in">
        <div className="h3-orb">
          <span aria-hidden="true" className="h2-ring absolute inset-0 rounded-full" />
          <span aria-hidden="true" className="h2-ring h2-ring-2 absolute inset-0 rounded-full" />
          <span aria-hidden="true" className="h2-ring h2-ring-3 absolute inset-0 rounded-full" />
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
            words={words}
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
