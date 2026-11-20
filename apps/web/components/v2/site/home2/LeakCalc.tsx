"use client";

import * as React from "react";

import { inkOf, isDark, type Look } from "./scene";

type W = Readonly<Record<string, string>>;
const TAU = 6.2832;
type Pt = [number, number];
const hsh = (i: number, m: number) => {
  const v = Math.sin(i * 12.9898 + m * 78.233) * 43758.5453;
  return v - Math.floor(v);
};
const inr = (v: number) => `₹${Math.round(v).toLocaleString("en-IN")}`;
const num = (v: number) => Math.round(v).toLocaleString("en-IN");

const B = (p: Pt[], u: number): Pt => {
  const v = 1 - u;
  return [v * v * v * p[0][0] + 3 * v * v * u * p[1][0] + 3 * v * u * u * p[2][0] + u * u * u * p[3][0], v * v * v * p[0][1] + 3 * v * v * u * p[1][1] + 3 * v * u * u * p[2][1] + u * u * u * p[3][1]];
};
const warmPath = (yo: number): Pt[] => [[0, 230 + yo], [260, 230 + yo], [470, 130 + yo * 0.5], [700, 120 + yo * 0.25]];
const coldPath = (yo: number): Pt[] => [[0, 230 + yo], [260, 230 + yo], [320, 300 + yo], [300, 352 + yo * 0.4]];

/**
 * Today's pipe, kept (owner, 20 Nov 2026: "the previous animation style was good"), simplified (21 Nov): a month's enquiries sit in the pipe from the left; the ones called back in time run on to the end of the pipe, the missed share peels off
 * into the drain and turns grey. Few moving dots, no glow, a short tail. Drawn in the design's 764 x 400 space and scaled to the canvas (the box keeps that shape at every width); the dots are drawn larger on a narrow canvas so they read on a phone.
 * STILL (owner, 21 Nov: only the phone demo and the radar's slow sweep move on this page): one frame, drawn again when a slider or the size changes. Its three labels (the start, the end, the drain, with their live counts) are DOM over the drawing. Colours: green is called back, grey is gone cold. The dots never move.
 */
function drawLeak(ctx: CanvasRenderingContext2D, W: number, H: number, t: number, look: Look, s: { enq: number; miss: number }): void {
  const k = W / 764;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, W, H);
  ctx.setTransform(k, 0, 0, k, 0, 0);
  const ink = inkOf(look);
  const green = look.dark ? "74,222,128" : "22,128,61";
  // a narrow canvas draws its dots bigger (a dot about 3 px across on screen)
  const ds = Math.max(1, 0.9 / (k / look.dpr));
  ctx.lineCap = "round";
  ctx.strokeStyle = `rgba(${ink},.07)`;
  ctx.lineWidth = 64;
  const w0 = warmPath(0);
  ctx.beginPath();
  ctx.moveTo(w0[0][0], w0[0][1]);
  ctx.bezierCurveTo(w0[1][0], w0[1][1], w0[2][0], w0[2][1], w0[3][0], w0[3][1]);
  ctx.stroke();
  const c0 = coldPath(0);
  ctx.strokeStyle = `rgba(${ink},.05)`;
  ctx.beginPath();
  ctx.moveTo(c0[1][0], c0[1][1]);
  ctx.bezierCurveTo(c0[1][0] + 30, c0[1][1], c0[2][0], c0[2][1], c0[3][0], c0[3][1]);
  ctx.stroke();
  ctx.fillStyle = `rgb(${green})`;
  ctx.beginPath();
  ctx.arc(712, 120, 8 * Math.min(ds, 1.6), 0, TAU);
  ctx.fill();
  // enquiries: a few more as the month gets busier; one speed for all; the missed share peels off and turns grey
  const n = Math.round(10 + (s.enq / 1000) * 14);
  for (let i = 0; i < n; i++) {
    const yo = (hsh(i, 1) - 0.5) * 46;
    const isCold = hsh(i, 2) * 100 < s.miss;
    const path = isCold ? coldPath(yo) : warmPath(yo);
    const u0 = (t * 0.1 + hsh(i, 4)) % 1;
    for (let j = 3; j >= 0; j--) {
      const u = u0 - j * 0.014;
      if (u < 0) continue;
      const p = B(path, u);
      let al = 1 - j / 4;
      if (isCold) {
        const fade = Math.max(0, (u - 0.35) / 0.65);
        al *= 1 - fade * 0.85;
        ctx.fillStyle = fade > 0 ? `rgba(140,135,130,${al})` : `rgba(${green},${al})`;
      } else ctx.fillStyle = `rgba(${green},${al})`;
      ctx.beginPath();
      ctx.arc(p[0], p[1], (j === 0 ? 3.4 : 3 - j * 0.45) * ds, 0, TAU);
      ctx.fill();
    }
  }
}

type Slider = { id: string; label: string; value: number; show: string; set: (v: number) => void; min: number; max: number; step: number };

/**
 * "How much are late call-backs costing you?" (the page's own words: h3.leak.*; the section's heading is drawn by the page, the island below it). On a phone: two sliders (enquiries a month, the average sale) and a "More settings" disclosure
 * with the other two (the share not called back in 5 minutes, how many of those might have bought), today's pipe at the full width, ONE big rupee result ("48,000 rupees a month slipping away") that updates live, and the contrast: with the product every enquiry gets an answer in seconds. The estimate is the visitor's own, never a promise, and the page says so. Real range inputs with labels.
 */
export function LeakCalc({ w }: { w: W }) {
  const [enq, setEnq] = React.useState(150);
  const [miss, setMiss] = React.useState(40);
  const [buy, setBuy] = React.useState(10);
  const [avg, setAvg] = React.useState(8000);
  const canvas = React.useRef<HTMLCanvasElement>(null);
  // ONE still frame (no loop): drawn again when the sliders, the size or the theme change
  React.useEffect(() => {
    const el = canvas.current;
    const ctx = el?.getContext("2d");
    if (!el || !ctx) return;
    const paint = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = Math.round((el.clientWidth || 1) * dpr);
      const h = Math.round((el.clientHeight || 1) * dpr);
      if (el.width !== w || el.height !== h) {
        el.width = w;
        el.height = h;
      }
      drawLeak(ctx, w, h, 1.3, { dark: isDark(el), calm: true, dpr }, { enq, miss });
    };
    paint();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(paint) : undefined;
    ro?.observe(el);
    const root = el.closest('[data-ui="v2"]');
    const mo = typeof MutationObserver !== "undefined" && root ? new MutationObserver(paint) : undefined;
    if (root) mo?.observe(root, { attributes: true, attributeFilter: ["data-theme"] });
    const mq = window.matchMedia?.("(prefers-color-scheme: dark)");
    mq?.addEventListener("change", paint);
    return () => {
      ro?.disconnect();
      mo?.disconnect();
      mq?.removeEventListener("change", paint);
    };
  }, [enq, miss]);
  const cold = Math.round((enq * miss) / 100);
  const warm = enq - cold;
  const buyers = Math.round((cold * buy) / 100);
  const lost = buyers * avg;
  const slider = (x: Slider) => (
    <div className="h4-slider" key={x.id}>
      <div className="h4-slider-row">
        <label htmlFor={x.id}>{x.label}</label>
        <output htmlFor={x.id}>{x.show}</output>
      </div>
      {/* the filled part is the ink up to the value, the rest the light track (home2.css .h2-range); the share filled comes in as --p on this wrapper */}
      <div style={{ "--p": `${((x.value - x.min) / (x.max - x.min)) * 100}%` } as React.CSSProperties}>
        <input id={x.id} type="range" min={x.min} max={x.max} step={x.step} value={x.value} onChange={(e) => x.set(Number(e.target.value))} className="h2-range block h-11 w-full" />
      </div>
    </div>
  );
  return (
    <div className="h4-leak" data-part="leak">
      <div className="h4-panel h4-sliders">
        {slider({ id: "h2-enq", label: w["h2.leak.enq"], value: enq, show: num(enq), set: setEnq, min: 20, max: 1000, step: 10 })}
        {slider({ id: "h2-avg", label: w["h2.leak.avg"], value: avg, show: inr(avg), set: setAvg, min: 500, max: 50000, step: 500 })}
        <details className="h4-more" data-part="more-settings">
          <summary>{w["h4.leak.more"]}</summary>
          <div className="h4-more-in">
            {slider({ id: "h2-miss", label: w["h2.leak.miss"], value: miss, show: `${miss}%`, set: setMiss, min: 0, max: 90, step: 5 })}
            {slider({ id: "h2-buy", label: w["h2.leak.buy"], value: buy, show: `${buy}%`, set: setBuy, min: 1, max: 50, step: 1 })}
          </div>
        </details>
      </div>
      <div className="h4-card h4-leak-card">
        <div className="h4-flow" data-part="leak-flow">
          <canvas ref={canvas} aria-hidden="true" className="absolute inset-0 block size-full" />
          <p className="h4-flow-lab h4-flow-in" aria-live="polite" data-part="enq-in">
            <span>{w["h2.leak.in"]}</span>
            <span className="h4-flow-n">{num(enq)}</span>
          </p>
          <p className="h4-flow-lab h4-flow-warm" aria-live="polite" data-part="warm">
            <span>{w["h3.leak.warm"]}</span>
            <span className="h4-flow-n">{num(warm)}</span>
          </p>
          <p className="h4-flow-lab h4-flow-cold" aria-live="polite" data-part="cold">
            <span>{w["h3.leak.cold"]}</span>
            <span className="h4-flow-n">{num(cold)}</span>
          </p>
        </div>
        <div className="h4-result" aria-live="polite" data-part="steps">
          <p className="h4-result-n h4-hot" data-part="at-stake">
            {inr(lost)}
          </p>
          <p className="h4-result-d">{w["h4.leak.slip"]}</p>
        </div>
        <div className="h4-with" data-part="leak-with">
          <p>{w["h4.leak.with"].replace(/\{n\}/g, num(enq))}</p>
          <div className="h4-bar" aria-hidden="true">
            <span />
          </div>
        </div>
        <p className="h4-small">{w["h3.leak.note"]}</p>
      </div>
    </div>
  );
}
