"use client";

import * as React from "react";

import { Orb, type OrbState } from "@/components/v2/Orb";
import { addScene, spectrum } from "@/components/v2/site/home2/scene";

type Motion = "idle" | "listening" | "speaking";

/**
 * The orange tick ring of the public landing page's hero, drawn around the product's own orb: a thin ring, 72 ticks (a longer one every sixth) and the voice spectrum standing out from the orb, taller while it listens or speaks. Same painter loop as the landing page (`addScene`, still with reduced motion).
 * The ring is only a drawing around the circle; the circle itself is always `components/v2/Orb`.
 */
export function tickRingDrawer(get: () => { motion: Motion }) {
  return (ctx: CanvasRenderingContext2D, W: number, H: number, t: number, look: { dpr: number }) => {
    const k = look.dpr;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.setTransform(k, 0, 0, k, 0, 0);
    const w = W / k;
    const h = H / k;
    if (w < 30 || h < 30) return;
    const cx = w / 2;
    const cy = h / 2;
    const R = Math.min(w, h) / 2 - 7;
    const mo = get().motion;
    ctx.lineWidth = 1.4;
    ctx.strokeStyle = "rgba(194,65,12,.3)";
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, 6.2832);
    ctx.stroke();
    ctx.lineWidth = 1;
    for (let i = 0; i < 72; i++) {
      const a = (i * 6.2832) / 72 - Math.PI / 2;
      const r1 = i % 6 === 0 ? R + 6 : R + 3;
      ctx.strokeStyle = `rgba(194,65,12,${i % 6 === 0 ? 0.42 : 0.18})`;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R);
      ctx.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
      ctx.stroke();
    }
    spectrum(ctx, cx, cy, R - 10, mo === "speaking" ? 6 : mo === "listening" ? 3.5 : 2, t, 72, 1);
  };
}

const SIZES = { lg: { box: "size-[104px]", orb: 64 } } as const;

/** The real orb inside the landing page's tick ring. */
export function OrbRing({ state = "ambient", size = "lg" }: { state?: OrbState; size?: keyof typeof SIZES }) {
  const canvas = React.useRef<HTMLCanvasElement>(null);
  const motion = React.useRef<Motion>("idle");
  React.useEffect(() => {
    motion.current = state === "speak" ? "speaking" : state === "listen" || state === "think" ? "listening" : "idle";
  }, [state]);
  React.useEffect(() => {
    const el = canvas.current;
    return el ? addScene(el, tickRingDrawer(() => ({ motion: motion.current }))) : undefined;
  }, []);
  const s = SIZES[size];
  return (
    <span data-part="orb-ring" className={`relative grid shrink-0 place-items-center ${s.box}`}>
      <canvas ref={canvas} aria-hidden="true" className="absolute inset-0 block size-full" />
      <Orb px={s.orb} state={state} />
    </span>
  );
}
