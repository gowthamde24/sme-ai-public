import { ArrowRight, BellOff, Bot, Check, Hand, Languages, Moon, Phone, PhoneOff, ShieldCheck } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { LeakCalc, RadarFinder } from "@/components/v2/site/LazyIslands";
import { publicPlanLines } from "@/components/v2/site/PublicPlans";
import type { SiteKey, SiteT } from "@/i18n/site";
import { PUBLIC_PLANS, planVars, rupees, type PublicPlan } from "@/lib/site/plans";

import audioManifest from "../../../../public/audio/site/manifest.json";
import { parseManifest, playable } from "../home2/voice";
import { Swipe } from "./Swipe";
import { VoiceCards, type VoiceCard } from "./VoiceCards";

type Start = { href: string; label: string };
const k = (s: string) => s as SiteKey;
/** The words a client island needs, filled on the server (the site's dictionaries never reach the browser whole). */
const words = (t: SiteT, keys: readonly string[]): Record<string, string> => Object.fromEntries(keys.map((key) => [key, t(k(key))]));
const FINDER_KEYS = [...["city", "near", "checked", "call", "ask", "skip", "list", "of", "empty"].map((x) => `h2.finder.${x}`), ...[1, 2, 3, 4].flatMap((i) => [`h2.finder.pin.${i}.what`, `h2.finder.pin.${i}.why`])];
const LEAK_KEYS = [...["enq", "miss", "buy", "avg", "in"].map((x) => `h2.leak.${x}`), ...["s1", "s2", "s3", "s4", "warm", "cold", "with", "of", "note"].map((x) => `h3.leak.${x}`), "h4.leak.more"];

/**
 * The four sample voices: the site's own recorded clips (public/audio/site, the manifest the hero and the phone use; a clip waiting for a native speaker's review is `draft: true` there and is left out here too), Telugu first, then Hindi, Kannada, English.
 * Each is a call's first line in that language, with the clip's own words as its transcript. Static files: nothing is asked of the app or of another site.
 */
const VOICES = [
  { n: 1, clip: "call-saree-1", lang: "te" },
  { n: 2, clip: "call-build-1", lang: "hi" },
  { n: 3, clip: "try-kn", lang: "kn" },
  { n: 4, clip: "call-coach-1", lang: "en" },
] as const;

/** A section's title block: the small orange label, the big title, one grey line. */
function Head({ id, eyebrow, title, sub }: { id: string; eyebrow: string; title: ReactNode; sub?: string }) {
  return (
    <header className="h4-head">
      <p className="h4-eyebrow">{eyebrow}</p>
      <h2 id={id} className="h4-h2">
        {title}
      </h2>
      {sub ? <p className="h4-lead">{sub}</p> : null}
    </header>
  );
}

function Section({ id, labelledBy, children }: { id: string; labelledBy: string; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={labelledBy} className="h4" data-part={`h4-${id}`}>
      <div className="h4-wrap">{children}</div>
    </section>
  );
}

function PlanCard({ plan, t, cta }: { plan: PublicPlan; t: SiteT; cta: Start }) {
  return (
    <div className={`h4-card h4-plan ${plan.recommended ? "h4-plan-rec" : ""}`} data-plan={plan.id}>
      <div className="h4-plan-top">
        <h3 className="h4-h3">{plan.name}</h3>
        {plan.recommended ? <span className="h4-rec">{t("pp.pop")}</span> : null}
      </div>
      <p className="h4-price" data-part="plan-cost">
        {rupees(plan.monthly)} <span>{t("pp.mo")}</span>
      </p>
      <p className="h4-small">{t("pp.gst")}</p>
      <ul className="h4-plan-lines">
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
    </div>
  );
}

/**
 * The sections of the home page between the demo and the final call to action, designed at 390 px first (design/home4.css): the cost of late call-backs, the Lead Finder, the voices, the plain rules, what is built in, the plans. One rhythm: a small orange
 * label, a big title, one grey line, then white cards with a soft border. Every word comes from the string store; the page reads fully with JavaScript off (the swipe rows are plain scrolling lists, the transcripts and the plans are server markup).
 */
export function LowerSections({ t, cta }: { t: SiteT; cta: Start }) {
  const manifest = parseManifest(audioManifest);
  const voices: VoiceCard[] = VOICES.flatMap((v) => {
    const clip = manifest?.clips[v.clip];
    if (!clip || !playable(manifest, v.clip)) return [];
    return [{ id: v.clip, biz: t(k(`h4.v.${v.n}.biz`)), what: t(k(`h4.v.${v.n}.what`)), langName: t(k(`h2.lang.${v.lang}`)), lang: v.lang, text: clip.text, seconds: clip.duration, sources: clip.sources }];
  });
  const icons = [<Phone key="1" size={20} strokeWidth={2.2} />, <ShieldCheck key="2" size={20} strokeWidth={2.2} />, <Moon key="3" size={20} strokeWidth={2.2} />, <Languages key="4" size={20} strokeWidth={2.2} />];
  const rules = [<Bot key="1" size={20} strokeWidth={2.2} />, <Hand key="2" size={20} strokeWidth={2.2} />, <BellOff key="3" size={20} strokeWidth={2.2} />, <PhoneOff key="4" size={20} strokeWidth={2.2} />];
  return (
    <>
      <Section id="calc" labelledBy="calc-title">
        <Head id="calc-title" eyebrow={t("h4.eb.cost")} title={t("h3.leak.q").split(/(\S+-\S+)/).map((part, i) => (i % 2 ? <span key={i} className="whitespace-nowrap">{part}</span> : part))} sub={t("h3.leak.sub")} />
        <LeakCalc w={words(t, LEAK_KEYS)} />
      </Section>
      <Section id="finder" labelledBy="finder-title">
        <Head id="finder-title" eyebrow={t("h4.eb.finder")} title={t("h4.finder.t")} sub={t("h4.finder.sub")} />
        <RadarFinder w={words(t, FINDER_KEYS)} />
        <p className="h4-small" style={{ marginTop: 12 }}>
          {t("h2.finder.note")}
        </p>
      </Section>
      {voices.length > 0 ? (
        <Section id="voices" labelledBy="voices-title">
          <Head id="voices-title" eyebrow={t("h4.eb.voices")} title={t("h4.voices.t")} sub={t("h4.voices.sub")} />
          <div className="h4-voices">
            <VoiceCards items={voices} w={{ play: t("h4.voices.play"), stop: t("h4.voices.stop"), playing: t("h4.voices.playing"), dot: t("h4.dot"), region: t("h4.voices.t") }} />
          </div>
        </Section>
      ) : null}
      <Section id="trust" labelledBy="trust-title">
        <Head id="trust-title" eyebrow={t("h4.eb.trust")} title={t("h4.trust.t")} sub={t("h4.trust.sub")} />
        <ul className="h4-rules h4-panel" data-part="trust">
          {rules.map((ico, i) => (
            <li key={i} data-trust={i + 1}>
              <span className="h4-ico" aria-hidden="true">
                {ico}
              </span>
              {t(k(`h4.trust.${i + 1}`))}
            </li>
          ))}
        </ul>
      </Section>
      <Section id="built" labelledBy="built-title">
        <Head id="built-title" eyebrow={t("h4.eb.built")} title={t("h3.built.title")} sub={t("h4.built.sub")} />
        <ul className="h4-built" data-part="built-in">
          {icons.map((ico, i) => (
            <li key={i} className="h4-built-row" data-built={i + 1}>
              <span className="h4-ico" aria-hidden="true">
                {ico}
              </span>
              <h3 className="h4-h3">{t(k(`h3.built.${i + 1}.t`))}</h3>
              <p className="h4-card-d">{t(k(`h3.built.${i + 1}.d`))}</p>
            </li>
          ))}
        </ul>
      </Section>
      <Section id="plans" labelledBy="plans-title">
        <Head id="plans-title" eyebrow={t("h4.eb.plans")} title={t("h2.plans.title")} sub={t("h3.plans.free")} />
        <Swipe label={t("h2.plans.title")} dotWord={t("h4.dot")} className="h4-plans">
          {PUBLIC_PLANS.map((p) => (
            <PlanCard key={p.id} plan={p} t={t} cta={cta} />
          ))}
        </Swipe>
        <div className="h4-plans-note">
          <p data-part="plans-free">{t("h2.plans.sub")}</p>
          <p>{t("pp.sh.2", planVars())}</p>
          <Link href="/pricing" data-part="plans-more">
            {t("h3.plans.more")}
            <ArrowRight size={16} strokeWidth={2.4} aria-hidden="true" />
          </Link>
        </div>
      </Section>
    </>
  );
}
