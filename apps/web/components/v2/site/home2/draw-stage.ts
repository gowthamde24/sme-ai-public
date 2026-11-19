import { OUT_Y, SRC_Y, STAGE_W } from "./lines";
import { bez, inkOf, spectrum, type Look, type Pt } from "./scene";

/**
 * The hero's stage (landing v2, ported from the approved design's drawStage): six streams of sparks from the sources into the orb, the Lead Finder's radar sweep around it with blips that are pulled in, a voice spectrum ring
 * that is tall while the assistant speaks, sparks out to the three outcomes, a start-up sequence (the ring draws itself, then the streams come on), and a source that flares as it sends and an outcome that flares as one arrives.
 * The visitor's own enquiry ("Try it") is a big spark from its source, then, once the reply is said, a big spark out to its outcome. Drawn in the design's 1240-wide space and scaled to the canvas. Pure drawing: the state comes in.
 */
export type StageState = {
  motion: "idle" | "listening" | "speaking";
  /** The visitor's enquiry: when it was sent (scene seconds), its source and outcome, and the seconds the reply takes to say. */
  custom: { at: number; src: number; out: number; replySecs: number } | null;
  /** A blip has been pulled into the orb: the "new businesses found" counter goes up. */
  onFound: () => void;
};

export function stageDrawer(get: () => StageState) {
    const cx = 620;
  const cy = 270;
  const R = 210;
  const paths: [Pt, Pt, Pt, Pt][] = SRC_Y.map((y, i) => [[262 + (i === 0 || i === 5 ? -38 : i === 1 || i === 4 ? 0 : 30), y], [400, y], [430, cy], [cx - 140, cy]]);
  const outs: [Pt, Pt, Pt, Pt][] = OUT_Y.map((y) => [[cx + 140, cy], [820, cy], [850, y + 22], [990, y + 22]]);
  return (ctx: CanvasRenderingContext2D, W: number, H: number, t: number, look: Look) => {
    const k = W / STAGE_W;
    const s = get();
    const ink = inkOf(look);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.setTransform(k, 0, 0, k, 0, 0);
    const boot = look.calm ? 1 : Math.min(1, t / 1.6);
    const bootE = 1 - (1 - boot) ** 3;
    // the ring draws itself, with its ticks
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = "rgba(194,65,12,.22)";
    ctx.beginPath();
    ctx.arc(cx, cy, R, -Math.PI / 2, -Math.PI / 2 + 6.2832 * bootE);
    ctx.stroke();
    ctx.lineWidth = 1;
    for (let d = 0; d < 120; d++) {
      if (d / 120 > bootE) break;
      const ang = (d * 6.2832) / 120 - Math.PI / 2;
      const r1 = d % 10 === 0 ? R + 10 : R + 5;
      ctx.strokeStyle = `rgba(194,65,12,${d % 10 === 0 ? 0.35 : 0.14})`;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(ang) * R, cy + Math.sin(ang) * R);
      ctx.lineTo(cx + Math.cos(ang) * r1, cy + Math.sin(ang) * r1);
      ctx.stroke();
    }
    spectrum(ctx, cx, cy, 150, s.motion === "speaking" ? 24 : s.motion === "listening" ? 10 : 4, t, 120, bootE);
    ctx.setLineDash([2, 7]);
    ctx.strokeStyle = "rgba(194,65,12,.25)";
    ctx.beginPath();
    ctx.arc(cx, cy, R - 46, 0, 6.2832);
    ctx.stroke();
    ctx.setLineDash([]);
    // guide lines
    ctx.setLineDash([2, 6]);
    ctx.lineWidth = 1.2;
    ctx.strokeStyle = `rgba(${ink},.14)`;
    for (const p of [...paths, ...outs]) {
      ctx.beginPath();
      ctx.moveTo(p[0][0], p[0][1]);
      ctx.bezierCurveTo(p[1][0], p[1][1], p[2][0], p[2][1], p[3][0], p[3][1]);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    if (!(look.calm || t > 0.9)) return;
    const run = (list: [Pt, Pt, Pt, Pt][], speed: number, col: string) => {
      list.forEach((p, i) => {
        for (let q = 0; q < 1; q++) {
          const u0 = (((t * speed + i * 0.23 + q * 0.5) % 1) + 1) % 1;
          for (let j = 5; j >= 0; j--) {
            const u = u0 - j * 0.016;
            if (u < 0) continue;
            const pt = bez(p[0], p[1], p[2], p[3], u);
            ctx.fillStyle = `rgba(${col},${(1 - j / 6) * 0.85})`;
            ctx.beginPath();
            ctx.arc(pt[0], pt[1], 3 - j * 0.22, 0, 6.2832);
            ctx.fill();
          }
        }
      });
      ctx.shadowBlur = 0;
    };
    const flare = (x: number, y: number, f: number, col: string) => {
      const g = ctx.createRadialGradient(x, y, 0, x, y, 34);
      g.addColorStop(0, `rgba(${col},${0.25 * f})`);
      g.addColorStop(1, `rgba(${col},0)`);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, 34, 0, 6.2832);
      ctx.fill();
    };
    ctx.globalAlpha = look.calm ? 1 : Math.min(1, (t - 0.9) / 0.8);
    paths.forEach((p, i) => {
      for (let q = 0; q < 1; q++) {
        const u0 = (((t * 0.12 + i * 0.23 + q * 0.5) % 1) + 1) % 1;
        if (u0 < 0.12) flare(p[0][0], p[0][1], 1 - u0 / 0.12, "194,65,12");
      }
    });
    outs.forEach((p, i) => {
      for (let q = 0; q < 1; q++) {
        const u0 = (((t * 0.1 + i * 0.23 + q * 0.5) % 1) + 1) % 1;
        if (u0 > 0.86) flare(p[3][0], p[3][1], (u0 - 0.86) / 0.14, "194,65,12");
      }
    });
    run(paths, 0.12, "194,65,12");
    run(outs, 0.1, "194,65,12");
    ctx.globalAlpha = 1;
    // the visitor's own enquiry: a big spark in from its source, then out to its outcome
    const c = s.custom;
    if (!c) return;
    const age = t - c.at;
    const big = (p: [Pt, Pt, Pt, Pt], u: number, col: string) => {
      for (let j = 14; j >= 0; j--) {
        const pt = bez(p[0], p[1], p[2], p[3], Math.max(0, u - j * 0.02));
        ctx.fillStyle = `rgba(${col},${(1 - j / 15) * 0.9})`;
        if (j === 0) {
          ctx.shadowColor = `rgba(${col},1)`;
          ctx.shadowBlur = 26;
        }
        ctx.beginPath();
        ctx.arc(pt[0], pt[1], j === 0 ? 8 : 6 - j * 0.3, 0, 6.2832);
        ctx.fill();
        ctx.shadowBlur = 0;
      }
    };
    const ease = (u: number) => 1 - (1 - u) ** 3;
    if (age < 1.1) {
      const u = ease(Math.min(1, age / 1.1));
      big(paths[c.src], u, "194,65,12");
      flare(paths[c.src][0][0], paths[c.src][0][1], 1 - u, "194,65,12");
    }
    const outAt = 1.1 + c.replySecs + 0.4;
    if (age > outAt && age < outAt + 1.1) big(outs[c.out], ease((age - outAt) / 1.1), "194,65,12");
    if (age >= outAt + 1.0 && age < outAt + 4) flare(outs[c.out][3][0], outs[c.out][3][1], 1 - (age - outAt - 1) / 3, "194,65,12");
  };
}

/** The phone's hero: the orb's spectrum ring only (the design's drawHeroRing, in a 250-wide space). */
export function heroRingDrawer(get: () => { motion: "idle" | "listening" | "speaking" }) {
  return (ctx: CanvasRenderingContext2D, W: number, _H: number, t: number) => {
    const k = W / 250;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W, W);
    ctx.setTransform(k, 0, 0, k, 0, 0);
    const mo = get().motion;
    ctx.strokeStyle = "rgba(194,65,12,.22)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(125, 125, 122, 0, 6.2832);
    ctx.stroke();
    spectrum(ctx, 125, 125, 100, mo === "speaking" ? 20 : mo === "listening" ? 9 : 3, t, 96, 1);
  };
}
