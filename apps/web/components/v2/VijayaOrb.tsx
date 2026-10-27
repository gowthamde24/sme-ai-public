"use client";

import { useEffect, useRef } from "react";

/** What the orb is doing: calm ribbons (`idle`), ribbons that follow the microphone (`listening`), faster and tighter ones (`thinking`), ribbons that follow the voice (`speaking`). */
export type VijayaState = "idle" | "listening" | "thinking" | "speaking";

type Wave = { c: string; a: number; k: number; s: number; p: number; h: number; o: number; l: number };
// the five ribbons: colour, size, wave count, speed, phase, thickness, height in the sphere, opacity (the brand's warm core, orange, peach, rose and cream)
const WAVES: Wave[] = [
  { c: "255,122,61", a: 0.34, k: 0.9, s: 0.55, p: 0, h: 0.3, o: -0.05, l: 0.85 },
  { c: "255,176,120", a: 0.3, k: 1.3, s: -0.42, p: 1.7, h: 0.22, o: 0.06, l: 0.75 },
  { c: "236,72,110", a: 0.28, k: 1.1, s: 0.35, p: 3.1, h: 0.2, o: 0.02, l: 0.55 },
  { c: "255,226,205", a: 0.22, k: 1.7, s: -0.65, p: 4.4, h: 0.09, o: -0.02, l: 0.8 },
  { c: "255,150,80", a: 0.4, k: 0.7, s: 0.28, p: 5.2, h: 0.16, o: 0, l: 0.45 },
];
const S = Math.sin;

/** Level of a Web Audio analyser, 0 to 1 (the loudness of what the microphone hears or what is being played). */
function level(a: AnalyserNode | null, buf: Uint8Array<ArrayBuffer>): number {
  if (!a) return -1;
  a.getByteTimeDomainData(buf);
  let sum = 0;
  for (const v of buf) sum += ((v - 128) / 128) ** 2;
  return Math.min(1, Math.sqrt(sum / buf.length) * 3.2);
}

function draw(ctx: CanvasRenderingContext2D, W: number, t: number, state: VijayaState, lv: number): void {
  const r = W / 2;
  const speak = state === "speaking";
  // how much the ribbons rise (e), how fast they flow (sp) and how many waves fit (kk): calm, listening (the microphone), thinking (faster, tighter), speaking (the voice, or a pulse of its own)
  const e = state === "listening" ? 0.45 + 1.1 * (lv < 0 ? 0.25 + 0.2 * S(t * 3.1) : lv) : speak ? (lv < 0 ? 0.85 + 0.3 * S(t * 2.6) + 0.15 * S(t * 6.1) : 0.4 + 1.3 * lv) : state === "thinking" ? 0.5 : 0.45;
  const sp = state === "thinking" ? 2.1 : state === "idle" ? 0.7 : 1;
  const kk = state === "thinking" ? 1.5 : 1;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, W, W);
  ctx.save();
  ctx.beginPath();
  ctx.arc(r, r, r, 0, 6.2832);
  ctx.clip();
  const g = ctx.createRadialGradient(r * 0.8, r * 0.7, r * 0.05, r, r, r * 1.02);
  g.addColorStop(0, "#4a1a0c");
  g.addColorStop(0.55, "#24100b");
  g.addColorStop(1, "#120807");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, W);
  const core = ctx.createRadialGradient(r, r * 1.02, 0, r, r, r * 0.75);
  core.addColorStop(0, `rgba(255,110,50,${speak ? 0.32 : 0.22})`);
  core.addColorStop(1, "rgba(255,110,50,0)");
  ctx.fillStyle = core;
  ctx.fillRect(0, 0, W, W);
  ctx.globalCompositeOperation = "screen";
  const step = Math.max(1, W / 120);
  for (const v of WAVES) {
    const top: number[] = [];
    const bot: number[] = [];
    for (let x = -step; x <= W + step; x += step) {
      const u = x / W;
      const env = Math.max(0, S(Math.PI * u)) ** 0.8;
      const y = r + v.o * r + S(t * sp * 0.4 + v.p) * r * 0.06 + (S(u * 6.2832 * v.k * kk + t * v.s * sp * 2.2 + v.p) * 0.75 + S(u * 9.74 - t * v.s * sp * 1.4 + v.p * 0.5) * 0.25) * v.a * r * e * env;
      const th = 1.3 * v.h * r * env * (0.55 + 0.45 * S(u * 5.34 + t * v.s * sp * 1.8 + v.p)) * (speak ? 1 : 0.8);
      top.push(x, y - th / 2);
      bot.push(x, y + th / 2);
    }
    ctx.beginPath();
    ctx.moveTo(top[0], top[1]);
    for (let j = 2; j < top.length; j += 2) ctx.lineTo(top[j], top[j + 1]);
    for (let j = bot.length - 2; j >= 0; j -= 2) ctx.lineTo(bot[j], bot[j + 1]);
    ctx.closePath();
    const lg = ctx.createLinearGradient(0, 0, W, 0);
    lg.addColorStop(0, `rgba(${v.c},0)`);
    lg.addColorStop(0.25, `rgba(${v.c},${v.l * 0.7})`);
    lg.addColorStop(0.5, `rgba(${v.c},${v.l})`);
    lg.addColorStop(0.75, `rgba(${v.c},${v.l * 0.7})`);
    lg.addColorStop(1, `rgba(${v.c},0)`);
    ctx.fillStyle = lg;
    ctx.shadowColor = `rgba(${v.c},.6)`;
    ctx.shadowBlur = r * 0.18;
    ctx.fill();
  }
  ctx.globalCompositeOperation = "source-over";
  ctx.shadowBlur = 0;
  const h = ctx.createRadialGradient(r * 0.62, r * 0.38, 0, r * 0.62, r * 0.38, r * 0.85);
  h.addColorStop(0, "rgba(255,255,255,.28)");
  h.addColorStop(0.3, "rgba(255,255,255,.07)");
  h.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = h;
  ctx.fillRect(0, 0, W, W);
  const rim = ctx.createRadialGradient(r, r, r * 0.8, r, r, r);
  rim.addColorStop(0, "rgba(255,140,90,0)");
  rim.addColorStop(1, "rgba(255,150,100,.38)");
  ctx.fillStyle = rim;
  ctx.fillRect(0, 0, W, W);
  ctx.restore();
}

/**
 * Vijaya, the assistant's picture: a glass sphere with ribbons of warm light flowing inside, drawn on a canvas (the one orb of the product: the Today card, the floating orb, voice mode, the live call, the setup, the home page).
 * `analyser` is a Web Audio analyser: while `listening` the ribbons follow the microphone, while `speaking` they follow the voice that is playing; without one, speaking pulses by itself and listening breathes. The drawing pauses while the orb is
 * off screen (IntersectionObserver), is capped at a device pixel ratio of 2, and with "reduce motion" (or `still`) is one frame and never moves. It fills its parent (`size` puts a width and height of its own on a wrapper), so nothing jumps
 * when it arrives. Decorative: the name beside it says what it is.
 */
export function VijayaOrb({ state = "idle", size, still = false, analyser = null }: { state?: VijayaState; size?: number; still?: boolean; analyser?: AnalyserNode | null }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const live = useRef({ state, analyser });
  live.current = { state, analyser };
  useEffect(() => {
    const el = canvas.current;
    const ctx = el?.getContext("2d");
    if (!el || !ctx) return;
    const calm = still || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const buf = new Uint8Array(new ArrayBuffer(256));
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let visible = true;
    let frame = 0;
    const start = performance.now();
    const paint = (now: number) => {
      const w = Math.round((el.clientWidth || size || 40) * dpr);
      if (el.width !== w) el.width = el.height = w;
      const { state: s, analyser: a } = live.current;
      draw(ctx, w, calm ? 1.3 : (now - start) / 1000, s, level(a, buf));
    };
    const loop = (now: number) => {
      if (visible) paint(now);
      frame = requestAnimationFrame(loop);
    };
    paint(start);
    const io = typeof IntersectionObserver === "undefined" || calm ? null : new IntersectionObserver((es) => void (visible = es[0].isIntersecting));
    io?.observe(el);
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => paint(performance.now()));
    ro?.observe(el);
    if (!calm) frame = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(frame);
      io?.disconnect();
      ro?.disconnect();
    };
  }, [still, size]);
  const orb = <canvas ref={canvas} aria-hidden="true" data-vijaya={state} className="block size-full rounded-full" />;
  return size ? (
    <span style={{ display: "block", width: size, height: size, flex: "none" }}>{orb}</span>
  ) : (
    orb
  );
}
