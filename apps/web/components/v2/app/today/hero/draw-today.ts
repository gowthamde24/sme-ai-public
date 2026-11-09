import { bez, spectrum, type Look, type Pt } from "@/components/v2/site/home2/scene";

/**
 * Today's hero (app v4 part 2, ported from drawToday() in the app-v4 design, owner 6 Nov 2026: the landing hero's style, no orbiting helpers, no rings of helpers): round the assistant's orb, a ring with ticks that draws
 * itself, the live spectrum (taller while the assistant listens or speaks), a dashed inner ring and a soft sweep; then, from the sources on the left, the enquiries streaming in as glowing comets with trails (a source flares when
 * it sends), and, to the results on the right, what came of them streaming out. Only the paths of the real sources and results the page shows are drawn (`yin`, `yout`: their rows' middles; none = only the ring). Geometry in
 * CSS pixels of the canvas. Reduced motion: one still frame, everything drawn.
 */
export type HeroGeo = { cx: number; cy: number; R: number; ri: number; sx: number; ox: number; yin: readonly number[]; yout: readonly number[] };
export type HeroLive = { motion: "idle" | "listening" | "speaking"; geo: (cssW: number, cssH: number) => HeroGeo };

const TAU = 6.2832;

export function drawToday(ctx: CanvasRenderingContext2D, W: number, H: number, t: number, look: Look, live: HeroLive): void {
  const k = look.dpr;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, W, H);
  ctx.setTransform(k, 0, 0, k, 0, 0);
  // a hidden canvas (the phone's ring on a desktop, the desktop's stage on a phone) has no size: nothing to draw (and a negative radius would throw)
  if (W / k < 40 || H / k < 40) return;
  const { cx, cy, R, ri, sx, ox, yin, yout } = live.geo(W / k, H / k);
  if (R <= ri + 8) return;
  const ink = look.dark ? "244,242,238" : "30,30,36";
  const bend = (cx - sx) * 0.45;
  const paths: Pt[][] = yin.map((y) => [[sx, y], [sx + bend, y], [cx - ri - bend * 0.4, cy], [cx - ri, cy]]);
  const outs: Pt[][] = yout.map((y) => [[cx + ri, cy], [cx + ri + bend * 0.4, cy], [ox - bend, y], [ox, y]]);
  const boot = look.calm ? 1 : Math.min(1, t / 1.6);
  const bootE = 1 - Math.pow(1 - boot, 3);
  // the ring draws itself, with ticks
  ctx.lineWidth = 1.4;
  ctx.strokeStyle = "rgba(194,65,12,.24)";
  ctx.beginPath();
  ctx.arc(cx, cy, R, -Math.PI / 2, -Math.PI / 2 + TAU * bootE);
  ctx.stroke();
  ctx.lineWidth = 1;
  for (let i = 0; i < 96; i++) {
    if (i / 96 > bootE) break;
    const ang = (i * TAU) / 96 - Math.PI / 2;
    const r1 = i % 8 === 0 ? R + 8 : R + 4;
    ctx.strokeStyle = `rgba(194,65,12,${i % 8 === 0 ? 0.34 : 0.13})`;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(ang) * R, cy + Math.sin(ang) * R);
    ctx.lineTo(cx + Math.cos(ang) * r1, cy + Math.sin(ang) * r1);
    ctx.stroke();
  }
  spectrum(ctx, cx, cy, ri + 12, live.motion === "speaking" ? 18 : live.motion === "listening" ? 9 : 3, t, 96, bootE);
  ctx.setLineDash([2, 7]);
  ctx.strokeStyle = "rgba(194,65,12,.22)";
  ctx.beginPath();
  ctx.arc(cx, cy, R - 22, 0, TAU);
  ctx.stroke();
  ctx.setLineDash([]);
  // a soft radar sweep around the orb
  const a = t * 1.1;
  if ("createConicGradient" in ctx) {
    const g = ctx.createConicGradient(a - 1.1, cx, cy);
    g.addColorStop(0, "rgba(255,119,60,0)");
    g.addColorStop(0.17, "rgba(255,119,60,.16)");
    g.addColorStop(0.175, "rgba(255,119,60,0)");
    g.addColorStop(1, "rgba(255,119,60,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, TAU);
    ctx.arc(cx, cy, ri + 4, 0, TAU, true);
    ctx.fill();
  }
  // guide lines from each source and to each result
  ctx.setLineDash([2, 6]);
  ctx.lineWidth = 1.1;
  ctx.strokeStyle = `rgba(${ink},.13)`;
  for (const p of paths.concat(outs)) {
    ctx.beginPath();
    ctx.moveTo(p[0][0], p[0][1]);
    ctx.bezierCurveTo(p[1][0], p[1][1], p[2][0], p[2][1], p[3][0], p[3][1]);
    ctx.stroke();
  }
  ctx.setLineDash([]);
  if (!(look.calm || t > 0.9)) return;
  ctx.globalAlpha = look.calm ? 1 : Math.min(1, (t - 0.9) / 0.8);
  const flare = (x: number, y: number, s: number, col: string) => {
    const g = ctx.createRadialGradient(x, y, 0, x, y, 28);
    g.addColorStop(0, `rgba(${col},${0.45 * s})`);
    g.addColorStop(1, `rgba(${col},0)`);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, 28, 0, TAU);
    ctx.fill();
  };
  if (!look.calm) {
    paths.forEach((p, i) => {
      const u0 = (((t * 0.3 + i * 0.31) % 1) + 1) % 1;
      if (u0 < 0.12) flare(p[0][0], p[0][1], 1 - u0 / 0.12, "255,119,60");
    });
    outs.forEach((p, i) => {
      const u0 = (((t * 0.26 + i * 0.31) % 1) + 1) % 1;
      if (u0 > 0.86) flare(p[3][0], p[3][1], (u0 - 0.86) / 0.14, "236,72,110");
    });
  }
  const run = (list: Pt[][], speed: number, col: string) => {
    list.forEach((p, i) => {
      const u0 = (((t * speed + i * 0.31) % 1) + 1) % 1;
      for (let j = 9; j >= 0; j--) {
        const u = u0 - j * 0.016;
        if (u < 0) continue;
        const pt = bez(p[0], p[1], p[2], p[3], u);
        ctx.fillStyle = `rgba(${col},${(1 - j / 10) * 0.9})`;
        if (j === 0) {
          ctx.shadowColor = `rgba(${col},.9)`;
          ctx.shadowBlur = 12;
        } else ctx.shadowBlur = 0;
        ctx.beginPath();
        ctx.arc(pt[0], pt[1], 3 - j * 0.22, 0, TAU);
        ctx.fill();
      }
    });
    ctx.shadowBlur = 0;
  };
  run(paths, 0.3, "255,119,60");
  run(outs, 0.26, "236,72,110");
  ctx.globalAlpha = 1;
}
