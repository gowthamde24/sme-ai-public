import Link from "next/link";

import { CallDemo, HeroStage, Journey, LeakCalc, RadarFinder, StandupTable } from "@/components/v2/site/LazyIslands";
import type { WaitlistAction } from "@/components/v2/site/WaitlistSection";
import type { SiteT } from "@/i18n/site";
import type { Lang } from "@/i18n/lang";
import { startEntry } from "@/lib/site/entry";
import { websiteOnly } from "@/lib/site/mode";

import { siteKycCopy, siteTrialCopy } from "@/lib/screens/flag";

import { homeEarly } from "./early";

import { GreetingsBand } from "./GreetingsBand";
import { FaqList, Finale, PlansSlab } from "./EndSections";
import { NumberSection } from "./NumberCard";

/** The words a client island of the home page needs, already filled ({brand}, {trial_days}); the others stay as placeholders for the island to fill. Server side: the site's dictionaries never reach the browser whole. */
export function islandWords(t: SiteT, keys: readonly string[]): Record<string, string> {
  return Object.fromEntries(keys.map((k) => [k, t(k as Parameters<SiteT>[0])]));
}
const HERO_KEYS = [
  "h2.hero.found",
  "h2.hero.scanning",
  "h2.hero.found.one",
  "h2.mode.picked",
  "h2.mode.listening",
  "h2.mode.in",
  "h2.mode.calling",
  "h2.mode.wait",
  ...["te", "ta", "kn", "ml", "hi", "mr", "en"].map((c) => `h2.lang.${c}`),
  ...[1, 2, 3].flatMap((i) => [`h2.out.${i}.t`, `h2.out.${i}.d`]),
  ...[1, 2, 3, 4, 5, 6].map((i) => `h2.src.${i}`),
  "h2.try",
  "h2.try.biz",
  "h2.try.lang",
  "h2.try.send",
  "h2.try.note",
  "h2.try.sent",
  ...["saree", "build", "coach"].flatMap((b) => [`h2.try.${b}`, `h2.try.src.${b}`, `h2.try.ask.${b}`, `h2.try.out.${b}.t`, `h2.try.out.${b}.d`]),
  "h2.hear",
  "h2.hear.on",
] as const;

const CALL_KEYS = [
  ...["title", "sub", "tabs", "calls", "ai", "ai.speaking", "listening", "mode.listening", "mode.speaking", "mode.thinking", "mode.ended", "speaking", "board", "talking", "none", "replay", "endnote", "endnote.phone", "note"].map((k) => `h2.call.${k}`),
  ...["saree", "build", "coach"].flatMap((b) => [`h2.call.tab.${b}`, `h2.call.${b}.source`, `h2.call.${b}.col.1`, `h2.call.${b}.col.2`, ...[1, 2, 3].flatMap((i) => [`h2.call.${b}.out.${i}.t`, `h2.call.${b}.out.${i}.d`])]),
  ...[1, 2, 3, 4, 5, 6].map((i) => `h2.call.saree.${i}.en`),
  ...[1, 2, 3, 4, 5].map((i) => `h2.call.build.${i}.en`),
  ...["te", "hi", "en"].map((c) => `h2.lang.${c}`),
  "h2.hear",
  "h2.hear.on",
] as const;
const FINDER_KEYS = [...["city", "near", "checked", "call", "ask", "skip", "list", "of", "empty"].map((k) => `h2.finder.${k}`), ...[1, 2, 3, 4].flatMap((i) => [`h2.finder.pin.${i}.what`, `h2.finder.pin.${i}.why`])] as const;
const LEAK_KEYS = ["title", "sub", "enq", "miss", "buy", "avg", "warm", "cold", "note", "in"].map((k) => `h2.leak.${k}`);
const MEET_KEYS = [...["live", "reporting", "closing", "pos", "progress", "hear", "note"].map((k) => `h2.meet.${k}`), ...[1, 2, 3, 4, 5, 6, 7].flatMap((i) => [`h2.meet.${i}.name`, `h2.meet.${i}.text`]), "h2.meet.4.short", "h2.meet.5.short", "h2.hear.on"] as const;
const AFTER_KEYS = [...["stop", "wait", "approve", "approved", "teach", "rule"].map((k) => `h2.after.${k}`), ...[1, 2, 3, 4, 5, 6].flatMap((i) => [`h2.after.${i}.name`, `h2.after.${i}.desc`, `h2.after.${i}.tag`])] as const;
/** The stand-up's recording in the site's language: English, and Telugu (a draft until a native speaker approves it; the manifest says so and no button is drawn); none for the others. */
const standupClips = (lang: Lang): string | null => (lang === "en" ? "standup-en" : lang === "te" ? "standup-te" : null);

/** The English under a sample call's line is in the site's language; under a call already in the site's language it would only repeat the line, so it is left out. */
function callWords(t: SiteT, lang: Lang): Record<string, string> {
  const w = islandWords(t, CALL_KEYS);
  for (const [biz, callLang] of [["saree", "te"], ["build", "hi"]] as const) if (callLang === lang) for (const k of Object.keys(w)) if (k.startsWith(`h2.call.${biz}.`) && k.endsWith(".en")) w[k] = "";
  return w;
}

const btnMain = "inline-flex min-h-12 items-center justify-center gap-2.5 rounded-full bg-[#ff773c] px-6 text-base font-extrabold text-[#1e1e24] shadow-[0_10px_24px_-10px_rgba(255,119,60,.8)] transition-transform duration-150 hover:-translate-y-0.5 active:scale-[.97]";
const btnLine = "inline-flex min-h-12 items-center justify-center gap-2.5 rounded-full bg-surface px-6 text-base font-extrabold text-ink shadow-[inset_0_0_0_1.5px_var(--v2-border)] transition-transform duration-150 hover:-translate-y-0.5 active:scale-[.97]";
const Arrow = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M5 12h14M13 6l6 6-6 6" />
  </svg>
);

/** The headline: each word rises out of a blur once, on load (CSS only; with "reduce motion" it is simply there). It is the page's largest paint and takes its full size at once, so nothing shifts. */
function Headline({ t }: { t: SiteT }) {
  const l1 = t("h2.hero.l1").split(" ");
  const l2 = t("h2.hero.l2").split(" ");
  const word = (x: string, d: number) => (
    <span key={d}>
      <span className={`h2-wd h2-d${Math.min(8, d)}`}>{x}</span>{" "}
    </span>
  );
  return (
    <h1 id="h1" className="m-0 font-display text-[42px] font-extrabold leading-[1.02] tracking-[-0.045em] [text-wrap:balance] lg:text-[68px] lg:leading-none">
      {l1.map((x, i) => word(x, i + 1))}
      <br className="max-lg:hidden" />
      {l2.map((x, i) => word(x, l1.length + i + 1))}
    </h1>
  );
}

/**
 * The public home page, landing v2 (job landing-v2; the owner approved the design on 6 Nov 2026). Sections in the design's order; each moving scene is a client island loaded as its own chunk, and every word and the layout are server
 * markup, so the page reads fully with JavaScript off. Built in order: the hero and "Try it" first.
 */
export function HomeV2({ t, lang, hasForm, waitlist }: { t: SiteT; lang: Lang; hasForm: boolean; waitlist?: WaitlistAction }) {
  // the main button: "Join early access" to the closing form (website mode says the same; no form: where "start" leads; home2/early.ts). With SITE_TRIAL_COPY=1 (after the lawyer's review): "Start 14-day trial", to sign-up
  const start = siteTrialCopy() ? startEntry(t, lang, t("h2.later.start"), { hasForm }) : homeEarly(t, lang);
  return (
    <>
      <HomeHero t={t} start={start} />
      <GreetingsBand label={t("h2.greet.label")} line={t("h2.greet.line")} />
      <section id="call" aria-labelledby="call-title" className="px-4 pb-0 pt-14 lg:px-8 lg:py-24">
        <div className="mx-auto max-w-[1240px]">
          <CallDemo w={callWords(t, lang)} />
        </div>
      </section>
      <section id="finder" aria-labelledby="finder-title" className="px-4 pb-0 pt-16 lg:px-8 lg:pb-24 lg:pt-10">
        <div className="mx-auto flex max-w-[1240px] flex-col gap-6 lg:gap-8">
          <div className="flex flex-col gap-3.5 lg:flex-row lg:items-end lg:justify-between lg:gap-12">
            <h2 id="finder-title" className="m-0 max-w-[740px] font-display text-[34px] font-extrabold leading-[1.04] tracking-[-0.04em] lg:text-[56px] lg:leading-[1.02]">
              {t("h2.finder.title")}
            </h2>
            <p className="m-0 max-w-[430px] text-base leading-relaxed text-muted lg:text-[17px]">{t("h2.finder.sub")}</p>
          </div>
          <RadarFinder w={islandWords(t, FINDER_KEYS)} />
          <p className="m-0 text-sm text-muted">{t("h2.finder.note")}</p>
        </div>
      </section>
      <section id="team" aria-labelledby="team-title" className="relative overflow-hidden px-4 pb-0 pt-16 lg:px-8 lg:pb-24 lg:pt-16">
        <div className="mx-auto flex max-w-[1240px] flex-col gap-2">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between lg:gap-12">
            <h2 id="team-title" className="m-0 max-w-[760px] font-display text-[34px] font-extrabold leading-[1.04] tracking-[-0.04em] lg:text-[56px] lg:leading-[1.02]">
              {t("h2.meet.title")}
            </h2>
            <p className="m-0 max-w-[400px] text-[15px] leading-relaxed text-muted lg:text-[17px]">{t("h2.meet.sub")}</p>
          </div>
          <div className="mt-5 lg:mt-0">
            <StandupTable w={islandWords(t, MEET_KEYS)} clipGroup={standupClips(lang)} />
          </div>
        </div>
      </section>
      <section id="after" aria-labelledby="after-title" className="relative px-4 pb-0 pt-16 lg:px-8 lg:pb-10 lg:pt-14">
        <div className="mx-auto flex max-w-[1240px] flex-col gap-2">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between lg:gap-12">
            <h2 id="after-title" className="m-0 max-w-[820px] font-display text-[34px] font-extrabold leading-[1.04] tracking-[-0.04em] lg:text-[56px] lg:leading-[1.02]">
              {t("h2.after.title")}
            </h2>
            <p className="m-0 max-w-[360px] text-[15px] leading-relaxed text-muted lg:text-[17px]">{t("h2.after.sub")}</p>
          </div>
          <Journey w={islandWords(t, AFTER_KEYS)} />
          <p className="m-0 mt-3 text-center text-sm text-muted">{t("h2.after.note")}</p>
        </div>
      </section>
      <NumberSection t={t} kyc={siteKycCopy()} />
      <section id="calc" aria-labelledby="calc-title" className="px-4 pb-0 pt-16 lg:px-8 lg:pb-10 lg:pt-28">
        <div className="mx-auto max-w-[1240px]">
          <LeakCalc w={islandWords(t, LEAK_KEYS)} />
        </div>
      </section>
      <PlansSlab t={t} start={start} />
      <FaqList t={t} kyc={siteKycCopy()} />
      <Finale t={t} lang={lang} action={waitlist} start={start} />
    </>
  );
}

function HomeHero({ t, start }: { t: SiteT; start: { href: string; label: string } }) {
  return (
    <section aria-labelledby="h1" className="relative overflow-hidden px-4 pb-2 pt-7 lg:px-8 lg:pb-10 lg:pt-11">
      <span aria-hidden="true" className="absolute left-1/2 top-[300px] block size-[560px] -translate-x-1/2 lg:top-[360px] lg:size-[1000px]">
        <span className="h2-glow block size-full" />
      </span>
      <div className="relative mx-auto grid grid-cols-[minmax(0,1fr)] max-w-[1240px] items-end gap-5 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)] lg:gap-14">
        <Headline t={t} />
        <div className="h2-fadein h2-d8 flex flex-col gap-5 pb-1.5">
          <p className="m-0 text-base leading-relaxed text-muted lg:text-lg">
            {/* one sentence for every screen (owner, 6 Nov 2026: the phone shows everything the desktop shows) */}
            {t("h2.hero.sub")}
          </p>
          <div className="flex gap-2.5 max-lg:hidden">
            <Link href={start.href} className={btnMain}>
              {start.label}
              <Arrow />
            </Link>
            <Link href="#call" className={btnLine}>
              {t("h2.hero.hear")}
            </Link>
          </div>
        </div>
      </div>
      {/* website mode (job DQ): the app is not open yet, and the page says so under its buttons */}
      {websiteOnly() ? (
        <p className="relative mx-auto mt-3 max-w-[1240px] text-sm text-muted" data-part="trial-note">
          {t("demo.note")}
        </p>
      ) : null}
      <HeroStage w={islandWords(t, HERO_KEYS)} />
      <div className="mt-[18px] flex flex-col gap-2.5 lg:hidden">
        <Link href={start.href} className={`${btnMain} w-full`}>
          {start.label}
        </Link>
        <Link href="#call" className={`${btnLine} w-full`}>
          {t("h2.hero.hear")}
        </Link>
      </div>
    </section>
  );
}
