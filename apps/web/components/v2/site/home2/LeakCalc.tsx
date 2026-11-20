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

/**
 * The flow of a month's enquiries (drawn in fractions of the canvas, so one drawing serves a wide box and a narrow one): dots come in from the left, and at the split each goes one way: the ones called back in time stay solid green
 * and run to the upper group, the ones that went cold turn grey, fade and run to the lower group. Each group has its label and count (DOM, over the drawing). One dot stands for about four enquiries. With "reduce motion" the dots stand still.
 */
function drawFlow(ctx: CanvasRenderingContext2D, W: number, H: number, t: number, look: Look, s: { enq: number; miss: number }): void {
  const tall = W / H < 1.2;
  const split = tall ? 0.3 : 0.34;
  const end = tall ? 0.55 : 0.6;
  const yw = 0.22;
  const yc = 0.78;
  const ink = inkOf(look);
  const green = look.dark ? "74,222,128" : "22,128,61";
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, W, H);
  const P = (p: Pt): Pt => [p[0] * W, p[1] * H];
  const bez = (a: Pt, b: Pt, c: Pt, d: Pt, u: number): Pt => {
    const v = 1 - u;
    return P([v * v * v * a[0] + 3 * v * v * u * b[0] + 3 * v * u * u * c[0] + u * u * u * d[0], v * v * v * a[1] + 3 * v * v * u * b[1] + 3 * v * u * u * c[1] + u * u * u * d[1]]);
  };
  // the two branches (faint guides, each ends at its label)
  ctx.lineCap = "round";
  ctx.setLineDash([2, 7]);
  ctx.lineWidth = 1.2;
  ctx.strokeStyle = `rgba(${ink},.14)`;
  for (const y of [yw, yc]) {
    ctx.beginPath();
    ctx.moveTo(0, H * 0.5);
    ctx.lineTo(split * W, H * 0.5);
    ctx.bezierCurveTo((split + 0.1) * W, H * 0.5, (split + 0.04) * W, y * H, (split + 0.14) * W, y * H);
    ctx.lineTo(end * W, y * H);
    ctx.stroke();
  }
  ctx.setLineDash([]);
  const n = Math.max(16, Math.min(56, Math.round(s.enq / 4)));
  const cut = 0.38; // the share of the way where the dots reach the split
  for (let i = 0; i < n; i++) {
    const cold = hsh(i, 2) * 100 < s.miss;
    const yo = (hsh(i, 1) - 0.5) * 0.16;
    const u0 = (t * (0.05 + hsh(i, 3) * 0.015) + hsh(i, 4)) % 1;
    for (let j = 2; j >= 0; j--) {
      const u = u0 - j * 0.012;
      if (u < 0) continue;
      let p: Pt;
      let col: string;
      let al: number;
      if (u < cut) {
        p = P([(u / cut) * split, 0.5 + yo]);
        col = ink;
        al = 0.55;
      } else {
        const v = (u - cut) / (1 - cut);
        const y1 = (cold ? yc : yw) + yo * 0.6;
        p = bez([split, 0.5 + yo], [split + 0.1, 0.5 + yo], [split + 0.04, y1], [end, y1], v);
        col = cold ? "140,135,130" : green;
        al = cold ? 0.85 * (1 - v * 0.8) : 0.9 * (v > 0.9 ? 1 - (v - 0.9) * 10 : 1);
      }
      ctx.fillStyle = `rgba(${col},${al * (1 - j * 0.3)})`;
      ctx.beginPath();
      ctx.arc(p[0], p[1], (4 - j * 0.8) * look.dpr, 0, TAU);
      ctx.fill();
    }
  }
}

/**
 * "How much are late call-backs costing you?" (home page, owner 20 Nov 2026: "make it easier to understand"): the visitor's four sliders (enquiries a month, the share not called back in 5 minutes, how many of those might have bought,
 * the average sale), the flow of dots splitting into two labelled groups, the maths as four plain steps in one row that update live (150 enquiries a month, 60 not called back in 5 minutes, 6 of them might have bought, 48,000 rupees a month
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
  React.useEffect(() => (canvas.current ? addScene(canvas.current, (c, W2, H, t, look) => drawFlow(c, W2, H, t, look, live.current)) : undefined), []);
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
        <p className="h3-leak-lab h3-leak-lab-warm" aria-live="polite" data-part="warm">
          <span className="h3-leak-n">{num(warm)}</span>
          <span>{w["h3.leak.warm"]}</span>
        </p>
        <p className="h3-leak-lab h3-leak-lab-cold" aria-live="polite" data-part="cold">
          <span className="h3-leak-n">{num(cold)}</span>
          <span>{w["h3.leak.cold"]}</span>
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
