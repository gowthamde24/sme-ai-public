"use client";

import * as React from "react";

import { AssistantOrb } from "@/components/v2/LazyAssistantOrb";

import { heroRingDrawer, stageDrawer, type StageState } from "./draw-stage";
import { DEMO_LANGS, OUT_Y, SRC_LEFT, SRC_Y, STAGE_H, STAGE_W, TRY_BIZ, TRY_ROUTE, wordsOf, type TryBiz } from "./lines";
import { addScene, isCalm, sceneTime } from "./scene";
import { HearIt, useVoice } from "./use-voice";

type W = Readonly<Record<string, string>>;
const fill = (s: string, v: Record<string, string>) => s.replace(/\{(\w+)\}/g, (m, k: string) => v[k] ?? m);
const TICK = 220;
const pct = (v: number, of: number) => `${((v / of) * 100).toFixed(3)}%`;

/** Placed by plain style only (the leak audit: no element has both style and className); the box inside carries the classes. */
function Place({ s, children }: { s: React.CSSProperties; children: React.ReactNode }) {
  return <div style={{ position: "absolute", ...s }}>{children}</div>;
}

const ICONS = [
  <path key="a" d="m3 11 18-5v12L3 14v-3zM11.6 16.8a3 3 0 1 1-5.8-1.6" />,
  <path key="b" d="M3 9h18l-2-5H5zM5 9v11h14V9M9 20v-6h6v6" />,
  <path key="c" d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0" />,
  <path key="d" d="M20 12a8 8 0 0 1-11.6 7.1L4 20l1-4.2A8 8 0 1 1 20 12z" />,
  <path key="e" d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2zM16 2l6 6M22 2l-6 6" />,
  <path key="f" d="M3 7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM3 7l9 6 9-6" />,
];
const Ico = ({ children }: { children: React.ReactNode }) => (
  <span className="h2-ico">
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  </span>
);
const Check = () => (
  <Ico>
    <path d="M20 6 9 17l-5-5" />
  </Ico>
);

type Hero = { gi: number; hw: number; hold: number; phase: "listen" | "speak"; custom: { biz: TryBiz; lang: number } | null };

/**
 * The hero's stage (landing v2 part B.2, the approved design): the six sources on the left, sparks streaming into the AI assistant's orb, the Lead Finder's radar sweep with its counter, the voice spectrum, outcomes flowing out to three
 * chips on the right, and the live caption under the orb (the greeting in seven languages, in turn, word by word). "Try it": the visitor picks a sample business and a language and sends an enquiry; a big spark comes in from that
 * business's source, the orb answers in that language word by word, a spark goes out and the matching outcome lights. On a phone: the orb with its spectrum ring, the caption, "Try it" as a card and the outcomes as a list.
 * The orb is the product's own AssistantOrb. With "reduce motion": one still frame, the whole line shown, no loop. "Hear it" plays C1's recorded voice (only for a clip the manifest marks reviewed).
 */
export function HeroStage({ w }: { w: W }) {
  const [h, setH] = React.useState<Hero>({ gi: 0, hw: 0, hold: 0, phase: "listen", custom: null });
  const [found, setFound] = React.useState(0);
  const [biz, setBiz] = React.useState<TryBiz>("saree");
  const [lang, setLang] = React.useState(0);
  const customAt = React.useRef<number | null>(null);
  const voice = useVoice();
  const line = h.custom ? DEMO_LANGS[h.custom.lang].line : DEMO_LANGS[h.gi].hero;
  const clipId = h.custom ? `try-${DEMO_LANGS[h.custom.lang].code}` : `hero-${DEMO_LANGS[h.gi].code}`;
  const n = wordsOf(line).length;
  const calm = React.useSyncExternalStore(
    () => () => undefined,
    isCalm,
    () => false,
  );

  // the caption's clock: listen a moment, then say the line word by word (or as the recorded voice says it), hold, then the next language (a visitor's enquiry holds longer, then the greetings carry on)
  React.useEffect(() => {
    if (calm) return;
    const id = window.setInterval(() => {
      if (voice.playing) return;
      setH((s) => {
        const len = wordsOf(s.custom ? DEMO_LANGS[s.custom.lang].line : DEMO_LANGS[s.gi].hero).length;
        if (s.phase === "listen") return s.hold >= 5 ? { ...s, phase: "speak", hold: 0, hw: 0 } : { ...s, hold: s.hold + 1 };
        if (s.hw < len) return { ...s, hw: s.hw + 1 };
        if (s.hold < (s.custom ? 22 : 10)) return { ...s, hold: s.hold + 1 };
        if (s.custom) return { ...s, custom: null, phase: "listen", hold: 0, hw: 0 };
        return { ...s, gi: (s.gi + 1) % DEMO_LANGS.length, phase: "listen", hold: 0, hw: 0 };
      });
    }, TICK);
    return () => window.clearInterval(id);
  }, [calm, voice.playing]);
  // with the sound on, a line that has a reviewed recording is said by it: its word times light the words
  const { on: soundOn, play } = voice;
  React.useEffect(() => {
    if (!soundOn || h.phase !== "speak" || h.hw !== 0) return;
    void play(clipId, (i) => setH((s) => ({ ...s, hw: Math.max(s.hw, i + 1) })));
  }, [soundOn, play, h.phase, h.hw, clipId]);

  const speaking = !calm && h.phase === "speak" && h.hw < n;
  const motion: StageState["motion"] = calm ? "idle" : h.phase === "listen" ? "listening" : speaking ? "speaking" : "idle";
  const live = React.useRef<StageState>({ motion, custom: null, onFound: () => setFound((f) => f + 1) });
  React.useEffect(() => {
    live.current.motion = motion;
    const c = h.custom;
    live.current.custom = c && customAt.current !== null ? { at: customAt.current, src: TRY_ROUTE[c.biz].src, out: TRY_ROUTE[c.biz].out, replySecs: wordsOf(DEMO_LANGS[c.lang].line).length * 0.22 } : null;
  });
  // the two canvases (the desktop stage, the phone's ring) join the page's one drawing loop; each reads the state of the moment
  const stageEl = React.useRef<HTMLCanvasElement>(null);
  const ringEl = React.useRef<HTMLCanvasElement>(null);
  React.useEffect(() => {
    const get = () => live.current;
    const offs = [stageEl.current && addScene(stageEl.current, stageDrawer(get)), ringEl.current && addScene(ringEl.current, heroRingDrawer(get))];
    return () => offs.forEach((off) => off?.());
  }, []);

  const send = () => {
    voice.stop();
    customAt.current = sceneTime();
    setH({ gi: h.gi, phase: calm ? "speak" : "listen", hold: 0, hw: calm ? wordsOf(DEMO_LANGS[lang].line).length : 0, custom: { biz, lang } });
  };
  const shown = calm ? n : h.phase === "listen" ? 0 : h.hw;
  const done = h.phase === "speak" && h.hw >= n;
  const litOut = h.custom && done ? TRY_ROUTE[h.custom.biz].out : -1;
  const mode = h.custom
    ? h.phase === "listen"
      ? w["h2.mode.in"]
      : speaking
        ? fill(w["h2.mode.calling"], { lang: w[`h2.lang.${DEMO_LANGS[h.custom.lang].code}`] })
        : w["h2.mode.wait"]
    : calm
      ? w[`h2.lang.${DEMO_LANGS[h.gi].code}`]
      : h.phase === "listen"
        ? w["h2.mode.picked"]
        : speaking
          ? w[`h2.lang.${DEMO_LANGS[h.gi].code}`]
          : w["h2.mode.listening"];
  const outs = [0, 1, 2].map((i) => (i === litOut && h.custom ? { t: w[`h2.try.out.${h.custom.biz}.t`], d: w[`h2.try.out.${h.custom.biz}.d`] } : { t: w[`h2.out.${i + 1}.t`], d: w[`h2.out.${i + 1}.d`] }));
  const note = h.custom ? fill(w["h2.try.sent"], { src: w[`h2.try.src.${h.custom.biz}`], ask: w[`h2.try.ask.${h.custom.biz}`] }) : w["h2.try.note"];
  const captionLang = DEMO_LANGS[h.custom ? h.custom.lang : h.gi].code;
  const words = (
    <span lang={captionLang} data-part="caption-words">
      {wordsOf(line).map((x, i) => (
        <React.Fragment key={i}>
          <span className="h2-w" data-said={i < shown ? "" : undefined} data-now={i === shown - 1 && speaking ? "" : undefined}>
            {x}
          </span>{" "}
        </React.Fragment>
      ))}
    </span>
  );
  const hear = <HearIt voice={voice} id={clipId} w={w} />;
  const radios = (wrap: string) => (
    <>
      <div role="radiogroup" aria-label={w["h2.try.biz"]} className={`flex gap-0.5 ${wrap}`}>
        {TRY_BIZ.map((b) => (
          <button key={b} type="button" role="radio" aria-checked={biz === b} onClick={() => setBiz(b)} data-try-biz={b} className={`min-h-11 rounded-full px-3.5 text-sm font-extrabold ${biz === b ? "bg-ink text-bg" : "text-muted hover:text-ink"}`}>
            {w[`h2.try.${b}`]}
          </button>
        ))}
      </div>
      <div role="radiogroup" aria-label={w["h2.try.lang"]} className={`flex gap-0.5 ${wrap}`}>
        {DEMO_LANGS.map((l, i) => (
          <button key={l.code} type="button" role="radio" aria-checked={lang === i} onClick={() => setLang(i)} lang={l.code} data-try-lang={l.code} className={`min-h-11 rounded-full px-2.5 text-sm font-extrabold ${lang === i ? "bg-ink text-bg" : "text-muted hover:text-ink"}`}>
            {l.label}
          </button>
        ))}
      </div>
    </>
  );
  const sendBtn = (cls: string) => (
    <button type="button" onClick={send} data-part="send" className={`inline-flex min-h-12 items-center justify-center gap-2 whitespace-nowrap rounded-full bg-[#ff773c] px-6 text-base font-extrabold text-[#1e1e24] shadow-[0_10px_24px_-10px_rgba(255,119,60,.8)] active:scale-[.97] ${cls}`}>
      {w["h2.try.send"]}
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M5 12h14M13 6l6 6-6 6" />
      </svg>
    </button>
  );

  return (
    <div data-part="hero-stage" data-lit-out={litOut >= 0 ? litOut : undefined}>
      {/* desktop: the whole stage, in the design's 1240 × 540 proportions */}
      <div className="h2-fadein relative mx-auto mt-7 hidden w-full max-w-[1240px] lg:block">
        <div style={{ position: "relative", width: "100%", aspectRatio: `${STAGE_W} / ${STAGE_H}` }}>
          <Place s={{ inset: 0 }}>
            <canvas ref={stageEl} aria-hidden="true" className="block size-full" />
          </Place>
          {SRC_Y.map((y, i) => (
            <Place key={i} s={{ left: pct(SRC_LEFT[i], STAGE_W), top: pct(y - 20, STAGE_H) }}>
              <div className="h2-glass h2-node" data-source={i}>
                <Ico>{ICONS[i]}</Ico>
                {w[`h2.src.${i + 1}`]}
              </div>
            </Place>
          ))}
          <Place s={{ left: "50%", top: 0, transform: "translateX(-50%)" }}>
            <div className="h2-glass h2-node" data-part="found">
              <span className="h2-blink" />
              {found === 0 ? w["h2.hero.scanning"] : found === 1 ? w["h2.hero.found.one"] : fill(w["h2.hero.found"], { n: String(found) })}
            </div>
          </Place>
          <Place s={{ left: "50%", top: pct(130, STAGE_H), width: pct(280, STAGE_W), aspectRatio: "1", transform: "translateX(-50%)" }}>
            <div className="h2-orbwrap size-full overflow-hidden">
              <AssistantOrb state={motion} />
            </div>
          </Place>
          <Place s={{ left: "50%", top: pct(462, STAGE_H), transform: "translateX(-50%)" }}>
            <div className="h2-glass flex w-max max-w-[min(660px,52vw)] items-center gap-3 rounded-[18px] px-[18px] py-2.5" aria-live="polite" data-part="caption">
              <span className="h2-blink" />
              <span className="shrink-0 whitespace-nowrap text-[13px] font-bold text-brand-text">{mode}</span>
              <span className="min-w-0 font-display text-lg font-semibold leading-snug">{words}</span>
              {hear}
            </div>
          </Place>
          {OUT_Y.map((y, i) => (
            <Place key={i} s={{ right: pct(24, STAGE_W), top: pct(y, STAGE_H) }}>
              <div className="h2-glass h2-node h2-out" data-out={i} data-lit={i === litOut ? "" : undefined}>
                <Check />
                <span>
                  <span className="block">{outs[i].t}</span>
                  <span className="block text-xs font-semibold text-muted">{outs[i].d}</span>
                </span>
              </div>
            </Place>
          ))}
        </div>
        <div className="mt-[22px] flex flex-col items-center gap-3">
          <div className="h2-glass h2-try flex items-center gap-3.5 rounded-[22px] py-2 pl-[22px] pr-2" data-part="try">
            <span className="whitespace-nowrap font-display text-lg font-extrabold">{w["h2.try"]}</span>
            {radios("")}
            {sendBtn("")}
          </div>
          <p className="text-sm text-muted" aria-live="polite" data-part="try-note">
            {note}
          </p>
        </div>
      </div>

      {/* phone: the orb with its spectrum ring, the caption, "Try it" as a card, the outcomes as a list */}
      <div className="lg:hidden">
        <div className="relative mx-auto mt-[18px] size-[300px]">
          <Place s={{ inset: 0 }}>
            <canvas ref={ringEl} aria-hidden="true" className="block size-full" />
          </Place>
          <Place s={{ left: 60, top: 60, width: 180, height: 180 }}>
            <div className="h2-orbwrap size-full overflow-hidden">
              <AssistantOrb state={motion} />
            </div>
          </Place>
        </div>
        <div className="h2-glass relative flex min-h-[76px] flex-col gap-1 rounded-[18px] px-4 py-3" aria-live="polite" data-part="caption-phone">
          <span className="inline-flex items-center gap-2 text-[13px] font-bold text-brand-text">
            <span className="h2-blink" />
            {mode}
            <span className="ml-auto">{hear}</span>
          </span>
          <span className="font-display text-lg font-semibold leading-snug">{words}</span>
        </div>
        <div className="h2-glass h2-try relative mt-3.5 flex flex-col gap-3 rounded-[22px] p-4" data-part="try-phone">
          <span className="font-display text-lg font-extrabold">{w["h2.try"]}</span>
          {radios("flex-wrap")}
          {sendBtn("w-full")}
          <p className="text-[13px] leading-normal text-muted" aria-live="polite">
            {note}
          </p>
        </div>
        <div className="relative mt-3.5 flex flex-col gap-2">
          {outs.map((o, i) => (
            <div key={i} className="h2-glass h2-node h2-out whitespace-normal" data-out-phone={i} data-lit={i === litOut ? "" : undefined}>
              <Check />
              <span>
                <span className="block">{o.t}</span>
                <span className="block text-xs font-semibold text-muted">{o.d}</span>
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
