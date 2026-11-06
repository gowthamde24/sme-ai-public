"use client";

import * as React from "react";

import { AssistantOrb } from "@/components/v2/LazyAssistantOrb";

import { wordsOf } from "./lines";
import { addScene, bez, inkOf, isCalm, spectrum, type Pt } from "./scene";
import { HearIt, useVoice } from "./use-voice";

type W = Readonly<Record<string, string>>;
const TAU = 6.2832;
// the table in the design's 1240 × 560 space: a lit ellipse in perspective, the six helpers around it (back to front), the orb above on a cone of light
const CX = 620;
const CY = 370;
const RX = 430;
const RY = 130;
const ORB_BOTTOM: Pt = [CX, 272];
const SEATS = Array.from({ length: 6 }, (_, i) => {
  const th = ((60 + i * 60) * Math.PI) / 180;
  const depth = (Math.sin(th) + 1) / 2;
  return { i, x: CX + Math.cos(th) * RX * 0.92, y: CY + Math.sin(th) * RY * 0.92, size: 70 + depth * 34, depth };
});
const PARTS = 7; // six helpers, then everyone

function drawTable(ctx: CanvasRenderingContext2D, W: number, H: number, t: number, look: { dark: boolean; calm: boolean; dpr: number }, su: number): void {
  const k = W / 1240;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, W, H);
  ctx.setTransform(k, 0, 0, k, 0, 0);
  const ink = inkOf(look);
  const cone = ctx.createLinearGradient(0, 180, 0, CY);
  cone.addColorStop(0, "rgba(255,140,90,0)");
  cone.addColorStop(1, "rgba(255,140,90,.20)");
  ctx.fillStyle = cone;
  ctx.beginPath();
  ctx.moveTo(CX - 60, 200);
  ctx.lineTo(CX + 60, 200);
  ctx.lineTo(CX + 150, CY);
  ctx.lineTo(CX - 150, CY);
  ctx.closePath();
  ctx.fill();
  const tg = ctx.createRadialGradient(CX, CY, 10, CX, CY, RX);
  tg.addColorStop(0, "rgba(255,170,130,.35)");
  tg.addColorStop(0.5, look.dark ? "rgba(255,140,90,.12)" : "rgba(255,240,230,.55)");
  tg.addColorStop(1, look.dark ? "rgba(255,140,90,.04)" : "rgba(255,255,255,.2)");
  ctx.fillStyle = tg;
  ctx.beginPath();
  ctx.ellipse(CX, CY, RX, RY, 0, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = "rgba(255,119,60,.45)";
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.setLineDash([3, 8]);
  ctx.strokeStyle = "rgba(194,65,12,.3)";
  ctx.lineWidth = 1;
  for (const f of [0.72, 0.45]) {
    ctx.beginPath();
    ctx.ellipse(CX, CY, RX * f, RY * f, 0, 0, TAU);
    ctx.stroke();
  }
  ctx.setLineDash([]);
  // a slow light circling the rim
  const ra = t * 0.6;
  const lx = CX + Math.cos(ra) * RX;
  const ly = CY + Math.sin(ra) * RY;
  const g2 = ctx.createRadialGradient(lx, ly, 0, lx, ly, 60);
  g2.addColorStop(0, "rgba(255,119,60,.5)");
  g2.addColorStop(1, "rgba(255,119,60,0)");
  ctx.fillStyle = g2;
  ctx.beginPath();
  ctx.arc(lx, ly, 60, 0, TAU);
  ctx.fill();
  const active = su < 6 ? su : -1;
  for (const st of [...SEATS].sort((a, b) => a.y - b.y)) {
    const on = st.i === active || su === 6;
    const c1: Pt = [st.x, st.y - 120];
    const c2: Pt = [ORB_BOTTOM[0] + (st.x - CX) * 0.2, ORB_BOTTOM[1] + 40];
    const p0: Pt = [st.x, st.y - st.size / 2];
    ctx.strokeStyle = on ? "rgba(255,119,60,.55)" : `rgba(${ink},.08)`;
    ctx.lineWidth = on ? 2 : 1;
    ctx.beginPath();
    ctx.moveTo(p0[0], p0[1]);
    ctx.bezierCurveTo(c1[0], c1[1], c2[0], c2[1], ORB_BOTTOM[0], ORB_BOTTOM[1]);
    ctx.stroke();
    if (on && !look.calm)
      for (let q = 0; q < 3; q++) {
        const p = bez(p0, c1, c2, ORB_BOTTOM, (t * 0.7 + q / 3 + st.i * 0.1) % 1);
        ctx.fillStyle = "rgba(255,119,60,.9)";
        ctx.shadowColor = "rgba(255,119,60,1)";
        ctx.shadowBlur = 12;
        ctx.beginPath();
        ctx.arc(p[0], p[1], 3.5, 0, TAU);
        ctx.fill();
        ctx.shadowBlur = 0;
      }
    // its shadow on the table, and the spectrum ring of the one speaking
    ctx.fillStyle = `rgba(${look.dark ? "0,0,0" : "30,30,36"},.12)`;
    ctx.beginPath();
    ctx.ellipse(st.x, st.y + st.size * 0.42, st.size * 0.45, st.size * 0.12, 0, 0, TAU);
    ctx.fill();
    if (st.i === active) spectrum(ctx, st.x, st.y, st.size / 2 + 4, 16, t, 64, 1);
  }
}

/**
 * The evening stand-up (landing v2 part B.6): a holographic table in perspective with the AI assistant's orb above it on a cone of light, the six helpers as small orbs around it (each the product's own AssistantOrb). The one
 * reporting gets a spectrum ring and a beam of sparks to the centre; its words come word by word in the subtitles, then the next; a seven-part progress bar shows where the stand-up is. "Hear the stand-up" plays C1's recording in
 * the site's language when a reviewed one exists (English today; Telugu waits for its review and has no button). On a phone: the orb and a row of the helpers. Every word is an example for a sample shop, and the page says so.
 */
export function StandupTable({ w, clipGroup }: { w: W; clipGroup: string | null }) {
  const [m, setM] = React.useState({ su: 0, mw: 0, hold: 0 });
  const voice = useVoice();
  const calm = React.useSyncExternalStore(
    () => () => undefined,
    isCalm,
    () => false,
  );
  const text = (i: number) => w[`h2.meet.${i + 1}.text`];
  const name = (i: number) => w[`h2.meet.${i + 1}.name`];
  React.useEffect(() => {
    if (calm) return;
    const id = window.setInterval(() => {
      if (voice.playing) return;
      setM((s) => {
        const n = wordsOf(text(s.su)).length;
        if (s.mw < n) return { ...s, mw: s.mw + 1 };
        if (s.hold < 11) return { ...s, hold: s.hold + 1 };
        return { su: (s.su + 1) % PARTS, mw: 0, hold: 0 };
      });
    }, 220);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the words are fixed for the page
  }, [calm, voice.playing]);
  const clipId = clipGroup ? `${clipGroup}-${m.su + 1}` : "";
  const { on: soundOn, play } = voice;
  React.useEffect(() => {
    if (!soundOn || !clipId || m.mw !== 0) return;
    void play(clipId, (i) => setM((s) => ({ ...s, mw: Math.max(s.mw, i + 1) })));
  }, [soundOn, play, clipId, m.mw]);

  const su = calm ? 6 : m.su;
  const live = React.useRef(su);
  React.useEffect(() => {
    live.current = su;
  });
  const canvas = React.useRef<HTMLCanvasElement>(null);
  React.useEffect(() => (canvas.current ? addScene(canvas.current, (c, W, H, t, look) => drawTable(c, W, H, t, look, live.current)) : undefined), []);
  const words = wordsOf(text(su));
  const shown = calm ? words.length : m.mw;
  const orbState = su === 6 ? (shown < words.length ? "speaking" : "idle") : "listening";
  const pct = (v: number, of: number) => `${((v / of) * 100).toFixed(2)}%`;

  return (
    <div data-part="standup" data-su={su}>
      {/* desktop: the table */}
      <div className="hidden lg:block">
        <div style={{ position: "relative", width: "100%", aspectRatio: "1240 / 560" }}>
        <canvas ref={canvas} aria-hidden="true" className="absolute inset-0 block size-full" />
        <span className="absolute left-1/2 top-[17%] block aspect-square w-[14.2%] -translate-x-1/2">
          <span className="h2-orbwrap block size-full overflow-hidden">
            <AssistantOrb state={orbState} />
          </span>
        </span>
        <span className="h2-glass absolute left-1/2 top-[3%] inline-flex -translate-x-1/2 items-center gap-2.5 whitespace-nowrap rounded-full px-4 py-2 text-sm font-bold">
          <span className="h2-blink" />
          {w["h2.meet.live"]}
        </span>
        {SEATS.map((st) => (
          <div key={st.i} style={{ position: "absolute", left: pct(st.x - st.size / 2, 1240), top: pct(st.y - st.size / 2, 560), width: pct(st.size, 1240) }}>
            <span className={`block aspect-square overflow-hidden rounded-full transition-[opacity,box-shadow] duration-500 ${st.i === su ? "shadow-[0_0_30px_rgba(255,119,60,.8)]" : su === 6 ? "" : "opacity-70"}`} data-seat={st.i} data-on={st.i === su ? "" : undefined}>
              <AssistantOrb state={st.i === su ? "speaking" : "idle"} />
            </span>
            <span className={`mt-3 block whitespace-nowrap text-center text-sm ${st.i === su ? "font-extrabold text-brand-text" : "font-bold text-muted"}`}>{name(st.i)}</span>
          </div>
        ))}
        </div>
      </div>
      {/* phone: the orb and a row of the helpers */}
      <div className="lg:hidden">
        <div className="mx-auto size-[130px]">
          <span className="h2-orbwrap block size-full overflow-hidden">
            <AssistantOrb state={orbState} />
          </span>
        </div>
        <ul className="mt-5 grid grid-cols-3 gap-3">
          {SEATS.map((st) => (
            <li key={st.i} className="flex flex-col items-center gap-1.5">
              <span className={`block size-12 overflow-hidden rounded-full ${st.i === su ? "shadow-[0_0_0_2px_#ff773c,0_0_0_7px_rgba(255,119,60,.16)]" : "opacity-60"}`}>
                <AssistantOrb state={st.i === su ? "speaking" : "idle"} />
              </span>
              <span className={`text-center text-xs ${st.i === su ? "font-extrabold text-brand-text" : "font-bold text-muted"}`}>{name(st.i)}</span>
            </li>
          ))}
        </ul>
      </div>
      {/* the subtitles and the stand-up's progress */}
      <div className="relative mt-6 flex flex-col items-center gap-4 lg:-mt-10">
        <div className="h2-glass flex min-h-32 w-full max-w-[860px] flex-col gap-2 rounded-[28px] px-5 py-5 lg:px-[30px]" aria-live="polite">
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm font-extrabold text-brand-text" data-part="meet-who">
              {su === 6 ? w["h2.meet.closing"] : w["h2.meet.reporting"].replace("{name}", name(su))}
            </span>
            <span className="text-[13px] tabular-nums text-muted">{w["h2.meet.pos"].replace("{n}", String(su + 1)).replace("{of}", String(PARTS))}</span>
          </div>
          <p className="m-0 font-display text-xl font-semibold leading-snug tracking-[-0.01em] lg:text-[30px] lg:leading-[1.3]" data-part="meet-words">
            {words.map((x, i) => (
              <React.Fragment key={i}>
                <span className="h2-w" data-said={i < shown ? "" : undefined} data-now={!calm && i === shown - 1 ? "" : undefined}>
                  {x}
                </span>{" "}
              </React.Fragment>
            ))}
          </p>
        </div>
        <ol className="grid w-full max-w-[860px] grid-cols-7 gap-1.5" aria-label={w["h2.meet.progress"]}>
          {Array.from({ length: PARTS }, (_, i) => {
            const fill = i < su ? 1 : i > su ? 0 : Math.min(1, (shown + (calm ? 0 : m.hold * 0.2)) / (words.length + 2.2));
            return (
              <li key={i} className="flex min-w-0 flex-col gap-1.5">
                <span className="block h-1 overflow-hidden rounded-full bg-ink/10">
                  <span style={{ display: "block", height: "100%", transformOrigin: "left", transform: `scaleX(${calm && i <= su ? 1 : fill})` }}>
                    <span className="block size-full rounded-full bg-[linear-gradient(90deg,#ff9a6b,#ff773c,#ec486e)]" />
                  </span>
                </span>
                <span className={`truncate text-xs font-bold ${i === su ? "text-brand-text" : i < su ? "text-ink" : "text-muted"}`}>{i === 6 ? w["h2.meet.7.name"] : name(i)}</span>
              </li>
            );
          })}
        </ol>
        <div className="mt-1.5 flex flex-wrap items-center justify-center gap-3">
          {clipId ? <HearIt voice={voice} id={clipId} w={w} label="h2.meet.hear" /> : null}
          <span className="text-[13px] text-muted">{w["h2.meet.note"]}</span>
        </div>
      </div>
    </div>
  );
}
