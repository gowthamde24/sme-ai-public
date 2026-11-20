"use client";

import * as React from "react";

import { addScene, inkOf, type Look } from "./scene";

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
const coldPath = (yo: number): Pt[] => [[0, 230 + yo], [260, 230 + yo], [320, 360 + yo], [300, 470 + yo * 0.4]];

/**
 * Today's pipe, kept (owner, 20 Nov 2026: "the previous animation style was good"): a month's enquiries flow in from the left; the ones called back in time run on to the end of the pipe, the missed share peels off into the drain and
 * turns grey. Drawn in the design's 764 x 520 space and scaled to the canvas (the box keeps that shape at every width); its three labels (the start, the end, the drain, with their live counts) are DOM over the drawing. More dots as the
 * month gets busier. Colours: green is called back, grey is gone cold. With "reduce motion" the dots stand still.
 */
function drawLeak(ctx: CanvasRenderingContext2D, W: number, H: number, t: number, look: Look, s: { enq: number; miss: number }): void {
  const k = W / 764;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, W, H);
  ctx.setTransform(k, 0, 0, k, 0, 0);
  const ink = inkOf(look);
  const green = look.dark ? "74,222,128" : "22,128,61";
  ctx.lineCap = "round";
  ctx.strokeStyle = `rgba(${ink},.06)`;
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
  ctx.arc(712, 120, 8, 0, TAU);
  ctx.fill();
  // enquiries: more of them as the month gets busier; the missed share peels off and turns grey
  const n = Math.round(12 + (s.enq / 1000) * 30);
  for (let i = 0; i < n; i++) {
    const yo = (hsh(i, 1) - 0.5) * 46;
    const isCold = hsh(i, 2) * 100 < s.miss;
    const path = isCold ? coldPath(yo) : warmPath(yo);
    const u0 = (t * (0.09 + hsh(i, 3) * 0.05) + hsh(i, 4)) % 1;
    for (let j = 5; j >= 0; j--) {
      const u = u0 - j * 0.012;
      if (u < 0) continue;
      const p = B(path, u);
      let al = 1 - j / 6;
      if (isCold) {
        const fade = Math.max(0, (u - 0.35) / 0.65);
        al *= 1 - fade * 0.85;
        ctx.fillStyle = fade > 0 ? `rgba(140,135,130,${al})` : `rgba(${green},${al})`;
      } else ctx.fillStyle = `rgba(${green},${al})`;
      ctx.beginPath();
      ctx.arc(p[0], p[1], j === 0 ? 3.4 : 3 - j * 0.3, 0, TAU);
      ctx.fill();
    }
  }
}

/**
 * "How much are late call-backs costing you?" (home page, owner 20 Nov 2026: "make it easier to understand"): the visitor's four sliders (enquiries a month, the share not called back in 5 minutes, how many of those might have bought,
 * the average sale), today's pipe with its three labelled counts, the maths as four plain steps in one row that update live (150 enquiries a month, 60 not called back in 5 minutes, 6 of them might have bought, 48,000 rupees a month
 * walking away), and the contrast: with the product every enquiry gets an answer in seconds. The estimate is the visitor's own, never a promise, and the page says so. Real range inputs with labels.
 */
export function LeakCalc({ w }: { w: W }) {
  const [enq, setEnq] = React.useState(150);
  const [miss, setMiss] = React.useState(40);
  const [buy, setBuy] = React.useState(10);
  const [avg, setAvg] = React.useState(8000);
  const [seen, setSeen] = React.useState(false);
  const live = React.useRef({ enq, miss });
  React.useEffect(() => {
    live.current = { enq, miss };
  });
  const canvas = React.useRef<HTMLCanvasElement>(null);
  React.useEffect(() => (canvas.current ? addScene(canvas.current, (c, W2, H, t, look) => drawLeak(c, W2, H, t, look, live.current)) : undefined), []);
  const box = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    const el = box.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      setSeen(true);
      return;
    }
    const io = new IntersectionObserver((es) => {
      if (es.some((e) => e.isIntersecting)) {
        setSeen(true);
        io.disconnect();
      }
    });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  const cold = Math.round((enq * miss) / 100);
  const warm = enq - cold;
  const buyers = Math.round((cold * buy) / 100);
  const lost = buyers * avg;
  const slider = (id: string, label: string, value: number, show: string, set: (v: number) => void, min: number, max: number, step: number) => (
    <div className="flex flex-col gap-1.5">
      <div className="flex justify-between gap-3">
        <label htmlFor={id} className="font-bold">
          {label}
        </label>
        <span className="font-display text-xl font-extrabold tabular-nums">{show}</span>
      </div>
      {/* the filled part is the ink up to the value, the rest the light track (home2.css .h2-range); the share filled comes in as --p on this wrapper */}
      <div style={{ "--p": `${((value - min) / (max - min)) * 100}%` } as React.CSSProperties}>
        <input id={id} type="range" min={min} max={max} step={step} value={value} onChange={(e) => set(Number(e.target.value))} className="h2-range block h-11 w-full" />
      </div>
    </div>
  );
  const steps: { n: string; label: string; hot?: boolean }[] = [
    { n: num(enq), label: w["h3.leak.s1"] },
    { n: num(cold), label: w["h3.leak.s2"] },
    { n: num(buyers), label: w["h3.leak.s3"] },
    { n: inr(lost), label: w["h3.leak.s4"], hot: true },
  ];
  return (
    <div className="h3-leak" data-part="leak" ref={box}>
      <header className="h3-head">
        <h2 id="calc-title" className="h3-h2">
          {w["h3.leak.q"].split(/(\S+-\S+)/).map((part, i) => (i % 2 ? <span key={i} className="whitespace-nowrap">{part}</span> : part))}
        </h2>
        <p className="h3-lead">{w["h3.leak.sub"]}</p>
      </header>
      <div className="h3-leak-sliders">
        {slider("h2-enq", w["h2.leak.enq"], enq, num(enq), setEnq, 20, 1000, 10)}
        {slider("h2-miss", w["h2.leak.miss"], miss, `${miss}%`, setMiss, 0, 90, 5)}
        {slider("h2-buy", w["h2.leak.buy"], buy, `${buy}%`, setBuy, 1, 50, 1)}
        {slider("h2-avg", w["h2.leak.avg"], avg, inr(avg), setAvg, 500, 50000, 500)}
      </div>
      <div className="h3-leak-flow" data-part="leak-flow">
        <canvas ref={canvas} aria-hidden="true" className="absolute inset-0 block size-full" />
        <p className="h3-leak-lab h3-leak-lab-in" aria-live="polite" data-part="enq-in">
          <span>{w["h2.leak.in"]}</span>
          <span className="h3-leak-n">{num(enq)}</span>
        </p>
        <p className="h3-leak-lab h3-leak-lab-warm" aria-live="polite" data-part="warm">
          <span>{w["h3.leak.warm"]}</span>
          <span className="h3-leak-n">{num(warm)}</span>
        </p>
        <p className="h3-leak-lab h3-leak-lab-cold" aria-live="polite" data-part="cold">
          <span>{w["h3.leak.cold"]}</span>
          <span className="h3-leak-n">{num(cold)}</span>
        </p>
      </div>
      <ol className="h3-leak-steps" aria-live="polite" data-part="steps">
        {steps.map((s, i) => (
          <li key={i} className="h3-leak-step" data-leak-step={i + 1}>
            <span className={`h3-leak-big ${s.hot ? "h3-leak-hot" : ""}`} data-part={s.hot ? "at-stake" : undefined}>
              {s.n}
            </span>
            <span className="h3-leak-cap">{s.label}</span>
          </li>
        ))}
      </ol>
      <div className="h3-leak-with" data-part="leak-with">
        <p className="h3-leak-with-t">
          {w["h3.leak.with"]} <b>{w["h3.leak.of"].replace(/\{n\}/g, num(enq))}</b>
        </p>
        <div className="h3-leak-bar" aria-hidden="true">
          <span className="h3-leak-bar-in" data-on={seen ? "" : undefined} />
        </div>
      </div>
      <p className="h3-small">{w["h3.leak.note"]}</p>
    </div>
  );
}
