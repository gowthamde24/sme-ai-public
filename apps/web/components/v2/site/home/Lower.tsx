import { ArrowRight, Bot, Hand, Phone, ShieldCheck } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { LeakCalc, RadarFinder } from "@/components/v2/site/LazyIslands";
import type { SiteKey, SiteT } from "@/i18n/site";
import { PUBLIC_PLANS, PLAN_FACTS, rupees, type PublicPlan } from "@/lib/site/plans";

import audioManifest from "../../../../public/audio/site/manifest.json";
import { parseManifest, playable } from "../home2/voice";
import { Swipe } from "./Swipe";
import { VoiceCards, type VoiceCard } from "./VoiceCards";

type Start = { href: string; label: string };
const k = (s: string) => s as SiteKey;
/** The words a client island needs, filled on the server (the site's dictionaries never reach the browser whole). */
const words = (t: SiteT, keys: readonly string[]): Record<string, string> => Object.fromEntries(keys.map((key) => [key, t(k(key))]));
const FINDER_KEYS = [...["city", "near", "checked", "call", "ask", "skip", "list", "of", "empty"].map((x) => `h2.finder.${x}`), ...[1, 3, 4].map((i) => `h2.finder.pin.${i}.what`)];
const LEAK_KEYS = [...["enq", "miss", "buy", "avg", "in"].map((x) => `h2.leak.${x}`), ...["warm", "cold", "note"].map((x) => `h3.leak.${x}`), "h4.leak.slip", "h4.leak.with", "h4.leak.more"];

/**
 * The four sample voices: the site's own recorded clips (public/audio/site, the manifest the hero and the phone use; a clip waiting for a native speaker's review is `draft: true` there and is left out here too), Telugu first, then Hindi, Kannada, English.
 * Each is a call's first line in that language, with the clip's own words as its transcript (two lines of it show). Static files: nothing is asked of the app or of another site.
 */
const VOICES = [
  { n: 1, clip: "call-saree-1", lang: "te" },
  { n: 2, clip: "call-build-1", lang: "hi" },
  { n: 3, clip: "try-kn", lang: "kn" },
  { n: 4, clip: "call-coach-1", lang: "en" },
] as const;

/** A section's title block (the spec's: a title of at most six words, then one grey line). */
function Head({ id, title, sub }: { id: string; title: string; sub?: string }) {
  return (
    <header className="h4-head">
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

/** A plan on the home page: its name, its price a month, and ONE line (its minutes; for Pay as you go, the price of a minute). Every number is the plan's own (lib/site/plans.ts); the pricing page has the rest. */
function PlanCard({ plan, t }: { plan: PublicPlan; t: SiteT }) {
  const line = plan.minutes === null ? t("h4.pl.payg", { p: rupees(PLAN_FACTS.extraMinute) }) : t("h4.pl.min", { n: new Intl.NumberFormat("en-IN").format(plan.minutes) });
  return (
    <div className={`h4-card h4-plan ${plan.recommended ? "h4-plan-rec" : ""}`} data-plan={plan.id}>
      <div className="h4-plan-top">
        <h3 className="h4-h3">{plan.name}</h3>
        {plan.recommended ? <span className="h4-rec">{t("pp.pop")}</span> : null}
      </div>
      <p className="h4-price" data-part="plan-cost">
        {rupees(plan.monthly)} <span>{t("pp.mo")}</span>
      </p>
      <p className="h4-card-d">{line}</p>
    </div>
  );
}

/**
 * The sections of the home page between the try-it box and the FAQ (website-spec-v4, sections 4 to 8), designed at 390 px first (design/home4.css): what late call-backs cost, the Lead Finder, the voices, what is built in, the plans. Each is a title of at most six
 * words, one grey line and one visual. Every word comes from the string store; the page reads fully with JavaScript off (the swipe rows are plain scrolling lists, the transcripts and the plans are server markup).
 */
export function LowerSections({ t }: { t: SiteT; cta?: Start }) {
  const manifest = parseManifest(audioManifest);
  const voices: VoiceCard[] = VOICES.flatMap((v) => {
    const clip = manifest?.clips[v.clip];
    if (!clip || !playable(manifest, v.clip)) return [];
    return [{ id: v.clip, biz: t(k(`h4.v.${v.n}.biz`)), langName: t(k(`h2.lang.${v.lang}`)), lang: v.lang, text: clip.text, seconds: clip.duration, sources: clip.sources }];
  });
  const icons = [<Phone key="1" size={20} strokeWidth={2.2} />, <ShieldCheck key="2" size={20} strokeWidth={2.2} />, <Hand key="3" size={20} strokeWidth={2.2} />, <Bot key="4" size={20} strokeWidth={2.2} />];
  return (
    <>
      <Section id="calc" labelledBy="calc-title">
        <Head id="calc-title" title={t("h4.leak.t")} sub={t("h4.leak.sub")} />
        <LeakCalc w={words(t, LEAK_KEYS)} />
      </Section>
      <Section id="finder" labelledBy="finder-title">
        <Head id="finder-title" title={t("h4.finder.t")} sub={t("h4.finder.sub")} />
        <RadarFinder w={words(t, FINDER_KEYS)} />
        <p className="h4-small" style={{ marginTop: 12 }}>
          {t("h2.finder.note")}
        </p>
      </Section>
      {voices.length > 0 ? (
        <Section id="voices" labelledBy="voices-title">
          <Head id="voices-title" title={t("h4.voices.t")} sub={t("h4.voices.sub")} />
          <div className="h4-voices">
            <VoiceCards items={voices} w={{ play: t("h4.voices.play"), stop: t("h4.voices.stop"), playing: t("h4.voices.playing"), dot: t("h4.dot"), region: t("h4.voices.t") }} />
          </div>
        </Section>
      ) : null}
      <Section id="built" labelledBy="built-title">
        <Head id="built-title" title={t("h3.built.title")} />
        <ul className="h4-built" data-part="built-in">
          {icons.map((ico, i) => (
            <li key={i} className="h4-card h4-built-card" data-built={i + 1}>
              <span className="h4-ico" aria-hidden="true">
                {ico}
              </span>
              <h3 className="h4-h3">{t(k(`h4.bi.${i + 1}`))}</h3>
              {i === 2 ? <p className="h4-card-d">{t("h4.bi.3.d")}</p> : null}
            </li>
          ))}
        </ul>
      </Section>
      <Section id="plans" labelledBy="plans-title">
        <Head id="plans-title" title={t("h4.pl.title")} />
        <Swipe label={t("h4.pl.title")} dotWord={t("h4.dot")} className="h4-plans">
          {PUBLIC_PLANS.map((p) => (
            <PlanCard key={p.id} plan={p} t={t} />
          ))}
        </Swipe>
        <div className="h4-plans-note">
          <p data-part="plans-free">{t("h4.pl.line", { gst: `${PLAN_FACTS.gstPercent}%` })}</p>
          <Link href="/pricing" data-part="plans-more">
            {t("h4.pl.more")}
            <ArrowRight size={16} strokeWidth={2.4} aria-hidden="true" />
          </Link>
        </div>
      </Section>
    </>
  );
}
