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
  return (ctx: CanvasRenderingContext2D, W: number, H: number, t: number, look: { dpr: number; dark?: boolean }) => {
    const k = look.dpr;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.setTransform(k, 0, 0, k, 0, 0);
    const w = W / k;
    const h = H / k;
    if (w < 30 || h < 30) return;
    const cx = w / 2;
    const cy = h / 2;
    const mo = get().motion;
    // the approved design: a thin pale ring at 47% of the box, and the orange spectrum bars standing out from the circle (a circle of 60% of the box), longer while it listens or speaks
    ctx.lineWidth = 1;
    ctx.strokeStyle = look.dark ? "#6b3518" : "#f1c7aa";
    ctx.beginPath();
    ctx.arc(cx, cy, w * 0.47, 0, 6.2832);
    ctx.stroke();
    spectrum(ctx, cx, cy, w * 0.3 + 2, mo === "speaking" ? 9 : mo === "listening" ? 6 : 3.5, t, 72, 1);
  };
}

const SIZES = { xl: { box: "size-[132px]", orb: 78 }, lg: { box: "size-[104px]", orb: 62 }, md: { box: "size-[80px]", orb: 48 }, sm: { box: "size-[64px]", orb: 38 } } as const;

/** The real orb inside the landing page's tick ring. */
export function OrbRing({ state = "ambient", size = "lg", analyser = null }: { state?: OrbState; size?: keyof typeof SIZES; analyser?: AnalyserNode | null }) {
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
      <Orb px={s.orb} state={state} analyser={analyser} />
    </span>
  );
}
