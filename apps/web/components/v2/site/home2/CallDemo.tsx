"use client";

import * as React from "react";

import { AssistantOrb } from "@/components/v2/LazyAssistantOrb";
import { Mark } from "@/components/v2/Mark";

import { CALLS, CALL_BIZ, wordsOf, type CallBiz } from "./lines";
import { addScene, isCalm, spectrum } from "./scene";
import { HearIt, useVoice } from "./use-voice";

type W = Readonly<Record<string, string>>;
const fill = (s: string, v: Record<string, string>) => s.replace(/\{(\w+)\}/g, (m, k: string) => v[k] ?? m);
type Call = { li: number; wi: number; hold: number; post: number; t: number };
const START: Call = { li: 0, wi: 0, hold: 0, post: -1, t: 0 };

/**
 * "Hear a call" (landing v2 part B.4): the app window of a sample call. The orb with its spectrum ring and the call's clock on the left; in the middle the line being said, word by word in the customer's language with English
 * (the site's language) under it, and the two lines before it, greyed; on the right the leads board, where the lead's card slides from "On the call" to its next column when the call ends, and the call's outcomes pop in one by one.
 * Tabs: Sarees (Telugu), Building materials (Hindi), Colleges (English). "Hear it" plays C1's recorded lines (assistant and customer voices) with their word times; without it the words run on a timer. Reduced motion: the whole call
 * at its end, nothing moves. Every call is an example for a sample business, and the page says so.
 */
export function CallDemo({ w }: { w: W }) {
  const [biz, setBiz] = React.useState<CallBiz>("saree");
  const [c, setC] = React.useState<Call>(START);
  const voice = useVoice();
  const calm = React.useSyncExternalStore(
    () => () => undefined,
    isCalm,
    () => false,
  );
  const call = CALLS[biz];
  const lines = call.lines;
  const ended = calm || c.post >= 0;
  const li = ended ? lines.length - 1 : c.li;
  const line = lines[li];
  const n = wordsOf(line.text).length;
  React.useEffect(() => {
    if (calm) return;
    const id = window.setInterval(() => {
      if (voice.playing) return;
      setC((s) => {
        const ls = CALLS[biz].lines;
        if (s.post >= 0) return s.post > 44 ? START : { ...s, post: s.post + 1 };
        const len = wordsOf(ls[s.li].text).length;
        if (s.wi < len) return { ...s, wi: s.wi + 1, t: s.t + 1 };
        if (s.hold < 6) return { ...s, hold: s.hold + 1, t: s.t + 1 };
        if (s.li + 1 < ls.length) return { ...s, li: s.li + 1, wi: 0, hold: 0, t: s.t + 1 };
        return { ...s, post: 0 };
      });
    }, 220);
    return () => window.clearInterval(id);
  }, [calm, biz, voice.playing]);
  // the recorded line, when the sound is on: its word times light the words, and the clock follows it
  const clipId = `call-${biz}-${li + 1}`;
  const { on: soundOn, play } = voice;
  React.useEffect(() => {
    if (!soundOn || ended || c.wi !== 0) return;
    const at = Date.now();
    void play(clipId, (i) => setC((s) => ({ ...s, wi: Math.max(s.wi, i + 1), t: s.t + (Date.now() - at > 220 * (s.wi + 1) ? 1 : 0) })));
  }, [soundOn, play, clipId, ended, c.wi]);

  const motion = ended ? "idle" : c.wi >= n && c.hold > 0 ? "thinking" : line.ai ? "speaking" : "listening";
  const live = React.useRef(motion);
  React.useEffect(() => {
    live.current = motion;
  });
  const ring = React.useRef<HTMLCanvasElement>(null);
  React.useEffect(() => {
    if (!ring.current) return;
    return addScene(ring.current, (ctx, W, _H, t) => {
      const k = W / 250;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, W, W);
      ctx.setTransform(k, 0, 0, k, 0, 0);
      const mo = live.current;
      spectrum(ctx, 125, 125, 100, mo === "speaking" ? 20 : mo === "listening" ? 9 : mo === "thinking" ? 6 : 2, t, 84, 1);
    });
  }, []);

  const pick = (b: CallBiz) => {
    voice.stop();
    setBiz(b);
    setC(START);
  };
  const shown = ended ? n : c.wi;
  const secs = Math.floor((calm ? 52 : c.t) * 0.22);
  const clock = `${String(Math.floor(secs / 60)).padStart(2, "0")}:${String(secs % 60).padStart(2, "0")}`;
  const done = ended ? Math.min(3, (calm ? 15 : c.post) / 5 + 1) | 0 : 0;
  const who = (ai: boolean) => (ai ? w["h2.call.ai"] : call.lead);
  const past = (ended ? lines.slice(-2) : lines.slice(Math.max(0, li - 2), li)).map((l) => ({ l, i: lines.indexOf(l) }));
  const en = (i: number) => w[`h2.call.${biz}.${i + 1}.en`] ?? "";
  const modeWord = { listening: w["h2.call.mode.listening"], speaking: w["h2.call.mode.speaking"], thinking: w["h2.call.mode.thinking"], idle: w["h2.call.mode.ended"] }[motion];
  const outcomes = [1, 2, 3].map((i) => ({ t: w[`h2.call.${biz}.out.${i}.t`], d: w[`h2.call.${biz}.out.${i}.d`] }));
  const col = ended ? 1 : 0;
  const status = ended ? outcomes[Math.min(1, done - 1)]?.t : w["h2.call.talking"];

  const caption = (
    <span lang={call.lang} data-part="call-words">
      {wordsOf(line.text).map((x, i) => (
        <React.Fragment key={i}>
          <span className="h2-w" data-said={i < shown ? "" : undefined} data-now={!ended && i === shown - 1 ? "" : undefined}>
            {x}
          </span>{" "}
        </React.Fragment>
      ))}
    </span>
  );

  return (
    <div className="flex flex-col gap-6 lg:gap-9" data-part="call-demo" data-biz={biz} data-ended={ended ? "" : undefined}>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between lg:gap-12">
        <div className="flex max-w-[700px] flex-col gap-3.5">
          <h2 id="call-title" className="m-0 font-display text-[34px] font-extrabold leading-[1.04] tracking-[-0.04em] lg:text-[56px] lg:leading-[1.02]">
            {w["h2.call.title"]}
          </h2>
          <p className="m-0 text-base leading-relaxed text-muted lg:text-lg">{w["h2.call.sub"]}</p>
        </div>
        <div role="tablist" aria-label={w["h2.call.tabs"]} className="h2-glass flex shrink-0 gap-1 self-start rounded-full p-[5px] lg:self-auto">
          {CALL_BIZ.map((b) => (
            <button key={b} type="button" role="tab" aria-selected={biz === b} aria-controls="call-panel" onClick={() => pick(b)} data-call-tab={b} className={`min-h-11 rounded-full px-[18px] text-sm font-extrabold ${biz === b ? "bg-ink text-bg" : "text-muted hover:text-ink"}`}>
              {w[`h2.call.tab.${b}`]}
            </button>
          ))}
        </div>
      </div>

      <div id="call-panel" role="tabpanel" aria-labelledby="call-title" className="overflow-hidden rounded-[28px] border border-line bg-surface shadow-[0_60px_120px_-70px_rgba(30,30,36,.55)]">
        <div className="flex flex-wrap items-center gap-x-3.5 gap-y-2 border-b border-line px-[22px] py-3.5">
          <Mark px={20} />
          <span className="font-extrabold">{w["h2.call.calls"]}</span>
          <span className="text-muted">/</span>
          <span className="min-w-0 font-semibold text-muted [overflow-wrap:anywhere]">
            {call.lead}, {w[`h2.call.${biz}.source`]}
          </span>
          <span className="ml-auto inline-flex shrink-0 items-center gap-2 rounded-full bg-brand-bg px-3 py-1.5 text-[13px] font-bold text-brand-text" data-part="call-mode">
            <span className="h2-blink" />
            {modeWord}
          </span>
        </div>
        <div className="grid grid-cols-[minmax(0,1fr)] lg:grid-cols-[300px_minmax(0,1fr)_340px]">
          <div className="flex flex-col items-center gap-[18px] border-line bg-[radial-gradient(circle_at_50%_38%,var(--v2-brand-bg),var(--v2-surface)_70%)] px-7 py-8 max-lg:border-b lg:border-r">
            <div className="relative size-[200px] lg:size-[250px]">
              <canvas ref={ring} aria-hidden="true" className="absolute inset-0 block size-full" />
              <span className="absolute inset-[12%] block">
                <span className="h2-orbwrap block size-full overflow-hidden">
                  <AssistantOrb state={motion} />
                </span>
              </span>
            </div>
            <p className="m-0 mt-1.5 font-display text-[40px] font-bold tabular-nums tracking-[-0.02em]" data-part="clock">
              {clock}
            </p>
            <p className="m-0 text-sm text-muted">{fill(w["h2.call.speaking"], { lang: w[`h2.lang.${call.lang}`] })}</p>
            <HearIt voice={voice} id={clipId} w={w} />
          </div>
          <div className="flex min-h-[360px] flex-col justify-end gap-[18px] px-5 py-6 lg:min-h-[440px] lg:px-9 lg:py-8">
            {past.map(({ l, i }) => (
              <div key={i} className={`flex flex-col ${l.ai ? "items-start text-left" : "items-end text-right"}`}>
                <p className="m-0 text-[13px] font-bold text-muted">{who(l.ai)}</p>
                <p className="m-0 mt-1 text-base leading-normal text-muted">{en(i) || l.text}</p>
              </div>
            ))}
            {ended ? (
              <p className="m-0 rounded-2xl border border-brand-edge/30 bg-brand-bg px-[18px] py-3.5 font-bold" data-part="call-ended">
                <span className="max-lg:hidden">{w["h2.call.endnote"]}</span>
                <span className="lg:hidden">{w["h2.call.endnote.phone"]}</span>
              </p>
            ) : (
              <div className={`flex flex-col ${line.ai ? "items-start text-left" : "items-end text-right"}`} aria-live="polite">
                <p className="m-0 text-[13px] font-extrabold text-brand-text">{line.ai ? w["h2.call.ai.speaking"] : fill(w["h2.call.listening"], { name: call.lead })}</p>
                <p className="m-0 mt-2 font-display text-2xl font-semibold leading-snug tracking-[-0.01em] lg:text-[32px] lg:leading-[1.32]">{caption}</p>
                {en(li) ? <p className="m-0 mt-2.5 text-base leading-normal text-muted">{en(li)}</p> : null}
              </div>
            )}
          </div>
          <div className="flex flex-col gap-3.5 border-line bg-surface-2/50 p-6 max-lg:border-t lg:border-l" data-part="board">
            <p className="m-0 font-extrabold">{w["h2.call.board"]}</p>
            <div className="relative grid h-[120px] grid-cols-2 gap-2">
              {[0, 1].map((i) => (
                <div key={i} className={`rounded-[14px] border-[1.5px] border-dashed p-2.5 transition-colors duration-500 ${i === col ? "border-[#ffb38f] bg-brand-bg" : "border-line bg-surface"}`}>
                  <p className="m-0 text-xs font-bold text-muted">{w[`h2.call.${biz}.col.${i + 1}`]}</p>
                </div>
              ))}
              <span className={`absolute top-10 block w-[calc(50%-20px)] transition-[left,transform] duration-[900ms] ease-[cubic-bezier(.77,0,.175,1)] ${col === 0 ? "left-2 -rotate-2" : "left-[calc(50%+4px)]"}`} data-part="lead-card" data-col={col}>
                <span className="block rounded-xl border border-line bg-surface px-3 py-2.5 shadow-[0_16px_30px_-16px_rgba(30,30,36,.4)]">
                  <span className="block text-sm font-extrabold">{call.lead}</span>
                  <span className="block text-xs text-muted">{status}</span>
                </span>
              </span>
            </div>
            {outcomes.slice(0, done).map((o, i) => (
              <div key={`${biz}-${i}`} className="h2-pop flex items-start gap-2.5 rounded-[14px] border border-line bg-surface p-3" data-part="outcome">
                <span className="flex size-6 shrink-0 items-center justify-center rounded-lg bg-[#1e1e24] text-[#ff9a6b]">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M20 6 9 17l-5-5" />
                  </svg>
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-extrabold">{o.t}</span>
                  <span className="block text-xs leading-snug text-muted">{o.d}</span>
                </span>
              </div>
            ))}
            {done === 0 ? <p className="m-0 text-[13px] text-muted">{w["h2.call.none"]}</p> : null}
            <button type="button" onClick={() => { voice.stop(); setC(START); }} className="mt-auto inline-flex min-h-11 self-start items-center rounded-full bg-surface px-5 text-sm font-extrabold text-ink shadow-[inset_0_0_0_1.5px_var(--v2-border)]" data-part="replay">
              {w["h2.call.replay"]}
            </button>
          </div>
        </div>
      </div>
      <p className="m-0 text-sm text-muted">{w["h2.call.note"]}</p>
    </div>
  );
}
