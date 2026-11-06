"use client";

import * as React from "react";

import { BRAND_NAME } from "@/design/brand";

import { addScene, fontOf, isCalm, type Look } from "./scene";

const TAU = 6.2832;
type Dot = { x: number; y: number; sx: number; sy: number; dl: number; o: boolean; light: boolean };

/** The wordmark as dots (the page's own dot grid): the three bars and the brand name drawn once on a hidden canvas, then sampled every 7 px. Each dot gets a place to fly in from. */
function brandDots(family: string): Dot[] {
  const W = 1240;
  const H = 300;
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const x = c.getContext("2d");
  if (!x) return [];
  x.lineCap = "round";
  x.lineWidth = 46;
  const bars: [number, number, number, string][] = [
    [40, 112, 70, "#ff773c"],
    [40, 168, 150, "#1e1e24"],
    [96, 168, 230, "#ff9a6b"],
  ];
  for (const [x1, x2, y, col] of bars) {
    x.strokeStyle = col;
    x.beginPath();
    x.moveTo(x1, y);
    x.lineTo(x2, y);
    x.stroke();
  }
  x.fillStyle = "#1e1e24";
  x.font = `800 268px ${family}`;
  try {
    (x as unknown as { letterSpacing: string }).letterSpacing = "-14px";
  } catch {
    // an older browser draws the name with its normal spacing
  }
  x.fillText(BRAND_NAME, 236, 262);
  const d = x.getImageData(0, 0, W, H).data;
  const pts: Dot[] = [];
  let seed = 11;
  const rnd = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  for (let yy = 3; yy < H; yy += 7)
    for (let xx = 3; xx < W; xx += 7) {
      const i = (yy * W + xx) * 4;
      if (d[i + 3] < 128) continue;
      const orange = d[i] > 180 && d[i + 2] < 140;
      const ang = rnd() * TAU;
      const r = 160 + rnd() * 420;
      pts.push({ x: xx, y: yy, sx: xx + Math.cos(ang) * r, sy: yy + Math.sin(ang) * r * 0.6 + 120, dl: (xx / W) * 0.7 + rnd() * 0.35, o: orange, light: orange && d[i + 1] > 140 });
    }
  return pts;
}

/**
 * The footer's wordmark (landing v2 part B.13): the brand name with its three bars, built from the page's own dots. It assembles the first time it is seen, stands on a reflecting floor with a light that travels along it; the cursor pushes
 * the dots away and lights them; a click (or Enter on the button) builds it again. One image to a screen reader (its name). Reduced motion: it simply stands there. No cursor play on touch screens (nothing follows a finger).
 */
export function BrandDots({ label, rebuild }: { label: string; rebuild: string }) {
  const canvas = React.useRef<HTMLCanvasElement>(null);
  const state = React.useRef<{ pts: Dot[] | null; font: boolean; start: number | null; mx: number; my: number; seen: boolean }>({ pts: null, font: false, start: null, mx: -9999, my: -9999, seen: false });
  React.useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const s = state.current;
    const io = typeof IntersectionObserver === "undefined" ? null : new IntersectionObserver((es) => void (s.seen = s.seen || es[0].isIntersecting));
    io?.observe(el);
    const fine = window.matchMedia?.("(hover: hover) and (pointer: fine)").matches === true;
    const move = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      s.mx = ((e.clientX - r.left) / r.width) * 1240;
      s.my = ((e.clientY - r.top) / r.width) * 1240;
    };
    const leave = () => {
      s.mx = s.my = -9999;
    };
    if (fine) {
      el.addEventListener("pointermove", move);
      el.addEventListener("pointerleave", leave);
    }
    const off = addScene(el, (ctx: CanvasRenderingContext2D, W: number, H: number, t: number, look: Look) => {
      const family = fontOf(el, "display");
      const fontReady = document.fonts?.check?.(`800 40px ${family}`) === true;
      if (!s.pts || (!s.font && fontReady)) {
        s.font = fontReady;
        s.pts = brandDots(family);
      }
      const k = W / 1240;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, W, H);
      ctx.setTransform(k, 0, 0, k, 0, 0);
      if (s.start === null) {
        if (s.seen || look.calm) s.start = t;
        else return;
      }
      const age = look.calm ? 99 : t - s.start;
      const ink = look.dark ? "244,242,238" : "30,30,36";
      for (const p of s.pts) {
        const u = Math.max(0, Math.min(1, (age - p.dl) / 1.3));
        const e = 1 - (1 - u) ** 4;
        let x = p.sx + (p.x - p.sx) * e;
        let y = p.sy + (p.y - p.sy) * e;
        const wv = 0.5 + 0.5 * Math.sin(p.x * 0.011 - t * 2.1 + p.y * 0.004);
        const dx = x - s.mx;
        const dy = y - s.my;
        const dd = Math.sqrt(dx * dx + dy * dy);
        let heat = 0;
        if (dd < 120 && u === 1) {
          heat = (1 - dd / 120) ** 2;
          x += (dx / (dd || 1)) * heat * 30;
          y += (dy / (dd || 1)) * heat * 30;
        }
        let col: string;
        let rad = 2.6;
        if (p.o) col = p.light ? `rgba(255,154,107,${0.75 + 0.25 * wv})` : `rgba(255,119,60,${0.8 + 0.2 * wv})`;
        else if (heat > 0.05) col = `rgba(${Math.round(30 + 225 * heat)},${Math.round(30 + 89 * heat)},${Math.round(36 + 24 * heat)},.95)`;
        else if (wv > 0.965 && !look.calm) col = "rgba(255,119,60,.9)";
        else col = `rgba(${ink},${0.5 + 0.45 * wv})`;
        if (u < 1) {
          col = p.o ? `rgba(255,119,60,${0.3 + 0.7 * e})` : `rgba(${ink},${0.15 + 0.8 * e})`;
          rad = 1.4 + 1.2 * e;
        }
        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.arc(x, y, rad + heat * 1.6, 0, TAU);
        ctx.fill();
        // its reflection on the glass floor
        if (u > 0.6) {
          const ry = 2 * 268 - y;
          const fall = 1 - (ry - 268) / 128;
          if (fall > 0) {
            ctx.globalAlpha = fall * fall * 0.22 * Math.min(1, (u - 0.6) / 0.4);
            ctx.beginPath();
            ctx.arc(x, ry + 4, rad * 0.9, 0, TAU);
            ctx.fill();
            ctx.globalAlpha = 1;
          }
        }
      }
      const fl = ctx.createLinearGradient(0, 0, 1240, 0);
      fl.addColorStop(0, "rgba(255,119,60,0)");
      fl.addColorStop(0.5, "rgba(255,119,60,.55)");
      fl.addColorStop(1, "rgba(255,119,60,0)");
      ctx.fillStyle = fl;
      ctx.fillRect(0, 271, 1240, 1.5);
      if (!look.calm) {
        const lx = ((t * 0.18) % 1) * 1400 - 80;
        // a soft glow travelling along the floor: an ellipse filled with a radial light, no hard edges
        ctx.save();
        ctx.translate(lx, 272);
        ctx.scale(1, 0.14);
        const lg = ctx.createRadialGradient(0, 0, 0, 0, 0, 90);
        lg.addColorStop(0, "rgba(255,119,60,.55)");
        lg.addColorStop(1, "rgba(255,119,60,0)");
        ctx.fillStyle = lg;
        ctx.beginPath();
        ctx.arc(0, 0, 90, 0, TAU);
        ctx.fill();
        ctx.restore();
      }
    });
    return () => {
      off();
      io?.disconnect();
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerleave", leave);
    };
  }, []);
  const again = () => {
    if (isCalm()) return;
    state.current.start = null;
    state.current.seen = true;
  };
  return (
    <div className="relative mx-auto mt-5 h-[116px] max-w-[1240px] lg:h-[400px]">
      <canvas ref={canvas} role="img" aria-label={label} onClick={again} className="absolute inset-0 block size-full cursor-pointer" data-part="brand-dots" />
      <button type="button" onClick={again} className="sr-only focus:not-sr-only focus:absolute focus:right-0 focus:top-0 focus:rounded-lg focus:bg-surface focus:px-3 focus:py-2">
        {rebuild}
      </button>
    </div>
  );
}
