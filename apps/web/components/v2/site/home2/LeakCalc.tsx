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
const B = (p: Pt[], u: number): Pt => {
  const v = 1 - u;
  return [v * v * v * p[0][0] + 3 * v * v * u * p[1][0] + 3 * v * u * u * p[2][0] + u * u * u * p[3][0], v * v * v * p[0][1] + 3 * v * v * u * p[1][1] + 3 * v * u * u * p[2][1] + u * u * u * p[3][1]];
};
const warmPath = (yo: number): Pt[] => [[0, 230 + yo], [260, 230 + yo], [470, 130 + yo * 0.5], [700, 120 + yo * 0.25]];
const coldPath = (yo: number): Pt[] => [[0, 230 + yo], [260, 230 + yo], [320, 360 + yo], [300, 470 + yo * 0.4]];

function drawLeak(ctx: CanvasRenderingContext2D, W: number, H: number, t: number, look: Look, s: { enq: number; miss: number }): void {
  const k = W / 764;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, W, H);
  ctx.setTransform(k, 0, 0, k, 0, 0);
  const ink = inkOf(look);
  ctx.lineCap = "round";
  ctx.strokeStyle = "rgba(255,119,60,.07)";
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
  const g = ctx.createRadialGradient(712, 120, 0, 712, 120, 46);
  g.addColorStop(0, "rgba(255,119,60,.55)");
  g.addColorStop(1, "rgba(255,119,60,0)");
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(712, 120, 46, 0, TAU);
  ctx.fill();
  ctx.fillStyle = "#ff773c";
  ctx.beginPath();
  ctx.arc(712, 120, 8, 0, TAU);
  ctx.fill();
  // enquiries: more of them as the month gets busier; the missed share peels off and turns grey
  const n = Math.round(16 + (s.enq / 1000) * 70);
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
        ctx.fillStyle = fade > 0 ? `rgba(140,135,130,${al})` : `rgba(255,119,60,${al})`;
      } else ctx.fillStyle = `rgba(255,119,60,${al})`;
      if (j === 0 && !isCold) {
        ctx.shadowColor = "rgba(255,119,60,.8)";
        ctx.shadowBlur = 8;
      }
      ctx.beginPath();
      ctx.arc(p[0], p[1], j === 0 ? 3.4 : 3 - j * 0.3, 0, TAU);
      ctx.fill();
      ctx.shadowBlur = 0;
    }
  }
}

const inr = (v: number) => `₹${Math.round(v).toLocaleString("en-IN")}`;

/**
 * "Watch your enquiries leak" (landing v2 part B.9): the stream of a month's enquiries, the share nobody called back in time peeling off and turning grey, the visitor's own sliders (enquiries a month, not called back in 5 minutes,
 * how many might have bought, the average sale) and the big rupee estimate. It is the visitor's own estimate from their own numbers, never a promise, and the page says so. Real range inputs with labels; the canvas only draws.
 */
export function LeakCalc({ w }: { w: W }) {
  const [enq, setEnq] = React.useState(150);
  const [miss, setMiss] = React.useState(40);
  const [buy, setBuy] = React.useState(10);
  const [avg, setAvg] = React.useState(8000);
  const live = React.useRef({ enq, miss });
  React.useEffect(() => {
    live.current = { enq, miss };
  });
  const canvas = React.useRef<HTMLCanvasElement>(null);
  React.useEffect(() => (canvas.current ? addScene(canvas.current, (c, W, H, t, look) => drawLeak(c, W, H, t, look, live.current)) : undefined), []);
  const cold = Math.round((enq * miss) / 100);
  const atStake = inr(((cold * buy) / 100) * avg);
  const slider = (id: string, label: string, value: number, show: string, set: (v: number) => void, min: number, max: number, step: number) => (
    <div className="flex flex-col gap-1.5">
      <div className="flex justify-between gap-3">
        <label htmlFor={id} className="font-bold">
          {label}
        </label>
        <span className="font-display text-xl font-extrabold tabular-nums">{show}</span>
      </div>
      {/* the filled part is orange up to the value, the rest the light neutral track (home2.css .h2-range); the share filled comes in as --p on this wrapper */}
      <div style={{ "--p": `${((value - min) / (max - min)) * 100}%` } as React.CSSProperties}>
        <input id={id} type="range" min={min} max={max} step={step} value={value} onChange={(e) => set(Number(e.target.value))} className="h2-range block h-11 w-full" />
      </div>
    </div>
  );
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] items-center gap-8 lg:grid-cols-[420px_minmax(0,1fr)] lg:gap-14" data-part="leak">
      <div className="flex flex-col gap-6">
        <h2 id="calc-title" className="m-0 font-display text-[34px] font-extrabold leading-[1.04] tracking-[-0.04em] lg:text-5xl lg:leading-[1.02]">
          {w["h2.leak.title"]}
        </h2>
        <p className="m-0 text-base leading-relaxed text-muted">{w["h2.leak.sub"]}</p>
        <div className="flex flex-col gap-5">
          {slider("h2-enq", w["h2.leak.enq"], enq, enq.toLocaleString("en-IN"), setEnq, 20, 1000, 10)}
          {slider("h2-miss", w["h2.leak.miss"], miss, `${miss}%`, setMiss, 0, 90, 5)}
          {slider("h2-buy", w["h2.leak.buy"], buy, `${buy}%`, setBuy, 1, 50, 1)}
          <div className="flex items-center justify-between gap-4 border-b-[1.5px] border-line pb-1.5">
            <label htmlFor="h2-avg" className="font-bold">
              {w["h2.leak.avg"]}
            </label>
            {/* "₹8,000": the sign is part of the field's text, right next to the number and right-aligned like the other values; only the digits are read back */}
            <input id="h2-avg" type="text" inputMode="numeric" autoComplete="off" value={`₹${avg.toLocaleString("en-IN")}`} onChange={(e) => setAvg(Math.min(10_000_000, Number(e.target.value.replace(/[^\d]/g, "")) || 0))} className="min-h-11 w-[150px] border-0 bg-transparent text-right font-display text-xl font-extrabold tabular-nums text-ink" />
          </div>
        </div>
      </div>
      <div className="relative">
        <div className="relative h-[250px] lg:h-[520px]">
          <canvas ref={canvas} aria-hidden="true" className="absolute inset-0 block size-full" />
          <div className="absolute right-0 top-0 text-right lg:right-[14%]">
            <p className="m-0 text-[13px] font-bold text-muted lg:text-[15px]">{w["h2.leak.warm"]}</p>
            <p className="m-0 mt-0.5 font-display text-[28px] font-extrabold tabular-nums tracking-[-0.03em] lg:text-[44px]" data-part="warm">
              {(enq - cold).toLocaleString("en-IN")}
            </p>
          </div>
          {/* above the stream: on a phone the stream runs at about 40% of the drawing's height, on a wide screen at about 44% */}
          <p className="absolute left-0 top-[22%] m-0 text-[13px] font-bold text-muted lg:top-[34%]">{w["h2.leak.in"]}</p>
        </div>
        <div className="lg:absolute lg:bottom-2 lg:left-[44%]" aria-live="polite">
          <p className="m-0 text-sm font-bold text-muted lg:text-[15px]">{w["h2.leak.cold"]}</p>
          <p className="m-0 bg-[linear-gradient(90deg,#c2410c,#ff773c_50%,#ec486e)] bg-clip-text font-display text-[56px] font-extrabold leading-none tracking-[-0.05em] tabular-nums text-transparent lg:text-[92px]" data-part="at-stake">
            {atStake}
          </p>
          <p className="m-0 mt-1 text-[13px] text-muted lg:text-[15px]">{w["h2.leak.note"]}</p>
        </div>
      </div>
    </div>
  );
}
