"use client";

import * as React from "react";

import { AssistantOrb } from "@/components/v2/LazyAssistantOrb";

import { stageDrawer, type StageState } from "./draw-stage";
import { DEMO_LANGS as ALL_LANGS, SRC_Y, wordsOf } from "./lines";
import { addScene, isCalm } from "./scene";
import { Fit } from "./Fit";
import { HearIt, useVoice } from "./use-voice";

type W = Readonly<Record<string, string>>;
const TICK = 220;
/** The greetings of the caption: Telugu, English, Hindi and Kannada only (owner, 20 Nov 2026), the site's four languages. */
const DEMO_LANGS = (["te", "en", "hi", "kn"] as const).map((c) => ALL_LANGS.find((l) => l.code === c)!);

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

type Hero = { gi: number; hw: number; hold: number; phase: "listen" | "speak" };

/**
 * The hero's stage (landing v2 part B.2, the approved design): the six sources on the left, sparks streaming into the AI assistant's orb, the Lead Finder's radar sweep with its counter, the voice spectrum, outcomes flowing out to three
 * chips on the right, and the live caption under the orb (the greeting in seven languages, in turn, word by word). "Try it": the visitor picks a sample business and a language and sends an enquiry; a big spark comes in from that
 * business's source, the orb answers in that language word by word, a spark goes out and the matching outcome lights. On a phone: the orb with its spectrum ring, the caption, "Try it" as a card and the outcomes as a list.
 * The orb is the product's own AssistantOrb. With "reduce motion": one still frame, the whole line shown, no loop. "Hear it" plays C1's recorded voice (only for a clip the manifest marks reviewed).
 */
export function HeroStage({ w }: { w: W }) {
  const [h, setH] = React.useState<Hero>({ gi: 0, hw: 0, hold: 0, phase: "listen" });
  const voice = useVoice();
  const line = DEMO_LANGS[h.gi].hero;
  const clipId = `hero-${DEMO_LANGS[h.gi].code}`;
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
        const len = wordsOf(DEMO_LANGS[s.gi].hero).length;
        if (s.phase === "listen") return s.hold >= 5 ? { ...s, phase: "speak", hold: 0, hw: 0 } : { ...s, hold: s.hold + 1 };
        if (s.hw < len) return { ...s, hw: s.hw + 1 };
        if (s.hold < 10) return { ...s, hold: s.hold + 1 };
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
  const live = React.useRef<StageState>({ motion, custom: null, onFound: () => undefined });
  React.useEffect(() => {
    live.current.motion = motion;
  });
  // the two canvases (the desktop stage, the phone's ring) join the page's one drawing loop; each reads the state of the moment
  const stageEl = React.useRef<HTMLCanvasElement>(null);
  React.useEffect(() => {
    const get = () => live.current;
    const offs = [stageEl.current && addScene(stageEl.current, stageDrawer(get))];
    return () => offs.forEach((off) => off?.());
  }, []);

  const shown = calm ? n : h.phase === "listen" ? 0 : h.hw;
  const done = h.phase === "speak" && h.hw >= n;
  const litOut = done ? (h.gi % 3) : -1; // the outcome chips light in turn, one for each greeting
  const mode = calm
    ? w[`h2.lang.${DEMO_LANGS[h.gi].code}`]
    : h.phase === "listen"
      ? w["h2.mode.picked"]
      : speaking
        ? w[`h2.lang.${DEMO_LANGS[h.gi].code}`]
        : w["h2.mode.listening"];
  const outs = [0, 1, 2].map((i) => ({ t: w[`h2.out.${i + 1}.t`], d: w[`h2.out.${i + 1}.d`] }));
  const captionLang = DEMO_LANGS[h.gi].code;
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
  return (
    <div data-part="hero-stage" data-lit-out={litOut >= 0 ? litOut : undefined}>
      {/* ONE stage at every width (owner, 20 Nov 2026): the design's 1240 x 540 drawing, scaled to the width of the page (Fit); nothing is swapped for a phone */}
      <Fit className="h3-fit-stage">
        <div className="h3-stage">
          <canvas ref={stageEl} aria-hidden="true" className="absolute inset-0 block size-full" />
          {SRC_Y.map((_, i) => (
            <div key={i} className={`h3-pos h3-src h3-src-${i}`}>
              <div className="h2-glass h2-node" data-source={i}>
                <Ico>{ICONS[i]}</Ico>
                <span>
                  <span className="block">{w[`h3.src.${i + 1}.t`]}</span>
                  <span className="block text-xs font-semibold text-muted">{w[`h3.src.${i + 1}.d`]}</span>
                </span>
              </div>
            </div>
          ))}
          <div className="h3-pos h3-orbp">
            <div className="h2-orbwrap size-full overflow-hidden">
              <AssistantOrb state={motion} />
            </div>
          </div>
          <div className="h3-pos h3-cap">
            <div className="h2-glass flex items-center gap-3 rounded-[18px] px-[18px] py-2.5" aria-live="polite" data-part="caption">
              <span className="h2-blink" />
              <span className="shrink-0 whitespace-nowrap text-[13px] font-bold text-brand-text">{mode}</span>
              <span className="min-w-0 font-display text-lg font-semibold leading-snug">{words}</span>
              {hear}
            </div>
          </div>
          {[0, 1, 2].map((i) => (
            <div key={i} className={`h3-pos h3-out h3-out-${i}`}>
              <div className="h2-glass h2-node h2-out" data-out={i} data-lit={i === litOut ? "" : undefined}>
                <Check />
                <span>
                  <span className="block">{outs[i].t}</span>
                  <span className="block text-xs font-semibold text-muted">{outs[i].d}</span>
                </span>
              </div>
            </div>
          ))}
        </div>
      </Fit>
    </div>
  );
}
