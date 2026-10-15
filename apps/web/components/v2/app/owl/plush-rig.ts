import rigData from "../../../../public/owl/v4/rig.json";

import type { OwlMood } from "./owl-mood";
import { LAYER_PX } from "./owl-files";

export * from "./owl-files";

/**
 * The numbers and the pure maths of the plush owlet (job CI). Ported from the approved prototype (owlet-prototype.html) and the rig sheet (owlet-assets/README.md): every figure is in the 1024 x 1024 canvas of the
 * layer images unless it says percent. No DOM, no timers, no random numbers in here: the component (PlushOwl.tsx) owns the clock, the pointer and the canvas, and calls these.
 */

/** With prefers-reduced-motion every movement is a third as big (x 0.35) and there are no wing flutter bursts. */
export const REDUCED_SCALE = 0.35;
export const motionScale = (reduced: boolean): number => (reduced ? REDUCED_SCALE : 1);

// ---- the numbers of the art: all from /owl/v4/rig.json ------------------------------------------------------------------------------------------------------------------------------------------------------
type Box = { left: number; top: number; width: number; height: number };
const RIG = rigData as unknown as {
  canvas: number;
  head_pivot_pct: [number, number];
  breathing_pivot: [number, number];
  eyelids: { left: Box; right: Box };
  eye_centres: { left: [number, number]; right: [number, number] };
  mouth: Box;
  beak_box: [number, number, number, number];
  wing_left: { box: [number, number, number, number]; inner_edge: number; pivot: [number, number] };
  wing_right: { box: [number, number, number, number]; inner_edge: number; pivot: [number, number] };
};
// (a test checks that rig.json is for the LAYER_PX canvas: a statement here would keep the whole file in every page that uses a still)

/** The head turns about this point (percent of the owl's box); the body breathes about BREATHING_PIVOT (percent). design/owl.css carries the same figures. */
export const HEAD_PIVOT = { x: RIG.head_pivot_pct[0], y: RIG.head_pivot_pct[1] } as const;
export const BREATHING_PIVOT = { x: (RIG.breathing_pivot[0] / LAYER_PX) * 100, y: Math.round((RIG.breathing_pivot[1] / LAYER_PX) * 1000) / 10 } as const;
/** The mouth behind the beak (percent of the owl's box); it opens (scaleY) while the owl talks and the beak lifts a little. */
export const MOUTH = RIG.mouth;
/** The beak in the 1024 space (x0, y0, x1, y1): the mouth sits at its lower edge. */
export const BEAK_BOX = RIG.beak_box;
/** While the owl talks the beak lifts by up to this much (percent of the owl's box) and shows the mouth under it. */
export const BEAK_LIFT_PCT = 0.35;

/** Eyelid boxes (left, top, width, height in percent of the owl's box), the left eye then the right. */
export const EYES = [RIG.eyelids.left, RIG.eyelids.right] as const;
/** The eyes' centres in the 1024 space, the left eye then the right: the closed-eye arc is drawn about them. */
export const EYE_CENTRES = [RIG.eye_centres.left, RIG.eye_centres.right] as const;
/** The closed-eye arc of eye `i`, in the eye box's own 100 x 100 space: a smile-shaped curve 52 wide about the centre of that eye (the numbers come from rig.json, so the arc sits on the eye whatever the art). */
export function shutArc(i: number): string {
  const box = EYES[i];
  const [ex, ey] = EYE_CENTRES[i];
  const cx = ((ex / LAYER_PX) * 100 - box.left) / (box.width / 100);
  const cy = ((ey / LAYER_PX) * 100 - box.top) / (box.height / 100);
  const f = (n: number) => Math.round(n * 10) / 10;
  return `M${f(cx - 26)} ${f(cy)} Q${f(cx)} ${f(cy + 20)} ${f(cx + 26)} ${f(cy)}`;
}

/** What the head, the lids and the body are doing, in the units the component writes to the DOM. dx and dy are canvas pixels; tilt is degrees; lid and lidLo 0 (open) to 1 (shut); the rest are fractions. */
export type Pose = { tilt: number; dx: number; dy: number; lid: number; lidLo: number; bob: number; breathe: number; brF: number; lean: number };
export const REST_POSE: Pose = { tilt: 0, dx: 0, dy: 0, lid: 0, lidLo: 0, bob: 0, breathe: 0.012, brF: 1.6, lean: 0 };

/** How much of the pointer (or the owl's own wandering look) the head follows: idle all of it, listening 40 %, answering 35 % (the prototype's code; the rig sheet says about 30), thinking and resting none (they look where the mood says). */
export function followOf(mood: OwlMood): number {
  switch (mood) {
    case "listening":
      return 0.4;
    case "answering":
      return 0.35;
    case "thinking":
    case "resting":
      return 0;
    default:
      return 1;
  }
}

/**
 * Where the pose wants to be for a mood. `look` is where the owl is looking, -1 to 1 on each axis (the pointer, or its own wandering); `t` is the clock in seconds; `scale` is motionScale().
 * idle: breathes, follows the look | listening: head tilted 6 deg, leans in, follows 40 % | thinking: lids 0.32, head up and tilted -6 deg, looks up and to the side, slow breath
 * answering: hops, follows 35 % | resting: lids shut, head droops 10 px and tilts 3 deg, deeper slower breath.
 * `scale` shrinks only what moves (the follow, the thinking glance, the breath); the pose of a mood (tilt, lids, droop) is the same.
 */
export function poseTarget(mood: OwlMood, look: { x: number; y: number }, t: number, scale = 1): Pose {
  const T: Pose = { ...REST_POSE };
  let { x: lx, y: ly } = look;
  let follow = followOf(mood);
  if (mood === "listening") {
    T.tilt = 6;
    T.lean = 0.012;
  } else if (mood === "thinking") {
    T.tilt = -6;
    T.dy = -6;
    T.lid = 0.32;
    lx = 0.5 + Math.sin(t * 0.6) * 0.15 * scale;
    ly = -0.6;
    T.brF = 1.1;
  } else if (mood === "answering") {
    T.bob = 0.012;
  } else if (mood === "resting") {
    T.lid = 1;
    T.lidLo = 1;
    T.dy = 10;
    T.tilt = 3;
    T.breathe = 0.02;
    T.brF = 0.9;
    lx = 0;
    ly = 0.2;
    follow = 0;
  }
  T.dx += lx * (mood === "thinking" ? 10 : 14 * follow) * scale;
  T.dy += ly * 7 * (follow || mood === "thinking" ? 1 : 0) * scale;
  T.tilt += lx * 4 * follow * scale;
  return T;
}

/** The wing angles (degrees, outward positive) a mood wants, before the flutter burst. `talk` is the talking phase (radians); `brF` the breathing rate. */
export function wingTargets(mood: OwlMood, t: number, talk: number, brF: number): { l: number; r: number } {
  let l = 1.5 + Math.sin(t * brF * 1.3) * 1.2;
  let r = l;
  if (mood === "listening") {
    l = 7;
    r = 11 + Math.sin(t * 2) * 1.5;
  } else if (mood === "thinking") {
    l = 2;
    r = -16 + Math.sin(t * 2.4) * 3;
  } else if (mood === "answering") {
    const g = Math.sin(talk * 0.35);
    l = 9 + g * 9;
    r = 9 - g * 9 + Math.max(0, Math.sin(t * 3.1)) * 6;
  } else if (mood === "resting") {
    l = r = Math.sin(t * brF * 1.3) * 0.8;
  }
  return { l, r };
}

/**
 * The Office (job CJ): a helper that is working sits at its laptop. The head is down toward the screen, the body bobs a little (WORK_BOB, half the answering hop) and the wings type, one after the other, about
 * 1.7 times a second; with reduced motion the Office draws the still poses instead (the owl is not given `working`).
 */
export const WORK_BOB = 0.006;
export const WORK_LOOK = { x: 0, y: 0.8 } as const;
export function workWings(t: number): { l: number; r: number } {
  const k = t * 10.8;
  return { l: 7 + Math.sin(k) * 7, r: 7 + Math.sin(k + Math.PI) * 7 };
}

/** The beak's opening, 0 to 1: only while answering (the talking phase `talk` runs at about 10 radians a second). */
export function beakTarget(mood: OwlMood, talk: number, t: number): number {
  if (mood !== "answering") return 0;
  return Math.max(0, Math.sin(talk)) * (0.5 + 0.5 * Math.abs(Math.sin(t * 2.1)));
}

/** How fast the talking phase advances at time t (radians a second). */
export const talkRate = (t: number): number => 10 + Math.sin(t * 1.6) * 3;

/** A flutter burst (a short quick flap, up to 18 deg): `p` is how far through the burst it is, 0 to 1. None with reduced motion (the caller passes scale 0 then). */
export function flutterAngle(p: number, scale = 1): number {
  if (p < 0 || p >= 1) return 0;
  return Math.abs(Math.sin(p * Math.PI * 3)) * 18 * Math.sin(p * Math.PI) * scale;
}
export const FLUTTER_SECONDS = 0.9;
/** A blink lasts 0.2 s; the next is 2.4 to 5.9 s later (and one time in five a quick second blink 0.3 s after); never while resting. */
export const BLINK_SECONDS = 0.2;
export const nextBlinkIn = (r1: number, r2: number): number => (r2 < 0.2 ? 0.3 : 2.4 + r1 * 3.5);
/** Where the owl wanders when nobody is pointing at it: a new look every 1.8 to 4.3 s. */
export const wanderLook = (r1: number, r2: number): { x: number; y: number } => ({ x: (r1 * 2 - 1) * 0.6, y: (r2 * 2 - 1) * 0.3 });

/** The pointer, as the owl sees it: -1 to 1 on each axis, measured from the owl's box (the head is in the middle and a little above it). */
export function pointerLook(clientX: number, clientY: number, box: { left: number; top: number; width: number; height: number }): { x: number; y: number } {
  const clamp = (v: number) => Math.max(-1, Math.min(1, v));
  return { x: clamp((clientX - (box.left + (box.width * HEAD_PIVOT.x) / 100)) / (box.width * 0.6)), y: clamp((clientY - (box.top + box.height * 0.3)) / (box.height * 0.6)) };
}

export const ease = (cur: number, target: number, k: number): number => cur + (target - cur) * k;

// ---- the wings: a bending mesh, not a stiff rotation, so the root stays attached to the body ---------------------------------------------------------------------------------------------------------

export type Wing = { x0: number; x1: number; y0: number; y1: number; inner: number; px: number; py: number; left: boolean };
/** The wing source boxes, inner edges and pivots, from rig.json (1024 space): the left wing's box x 172..286 with its inner edge at 286 and pivot (280, 540); the right x 749..860, inner edge 749, pivot (755, 538). */
const wingOf = (w: { box: [number, number, number, number]; inner_edge: number; pivot: [number, number] }, left: boolean): Wing => ({ x0: w.box[0], y0: w.box[1], x1: w.box[2], y1: w.box[3], inner: w.inner_edge, px: w.pivot[0], py: w.pivot[1], left });
export const WING_LEFT: Wing = /* @__PURE__ */ wingOf(RIG.wing_left, true);
export const WING_RIGHT: Wing = /* @__PURE__ */ wingOf(RIG.wing_right, false);
export const WING_COLS = 6;
export const WING_ROWS = 14;
export type MeshSize = { cols: number; rows: number };
/**
 * How fine the wing mesh is for a canvas of this many pixels across. The prototype's 6 x 14 (168 triangles a wing) is what a big owl gets; a small one (every owl in the app is 120 to 224 CSS pixels, 240 to 448 canvas
 * pixels) draws the same bend from fewer, bigger triangles: at that size the cells are 15 to 25 pixels and the bend cannot be told apart, and a phone at a quarter of the speed draws it in a third of the time.
 */
export function meshFor(canvasPx: number): MeshSize {
  if (canvasPx >= 640) return { cols: WING_COLS, rows: WING_ROWS };
  if (canvasPx >= 300) return { cols: 4, rows: 10 };
  return { cols: 3, rows: 7 };
}

/** Bend weight: u is the distance from the inner edge (0..1), v from the top to the bottom (0..1). The top of the inner edge does not move at all. */
export const bendWeight = (u: number, v: number): number => 0.62 * u + 0.38 * v * v * u + 0.22 * v * v;

/** A point of the mesh: where it is in the picture (src) and where the bend puts it (dst), both in canvas pixels. */
export type MeshPoint = { src: [number, number]; dst: [number, number] };
export function wingGrid(wing: Wing, deg: number, { cols = WING_COLS, rows: nRows = WING_ROWS }: Partial<MeshSize> = {}): MeshPoint[][] {
  const { x0, x1, y0, y1, inner, px, py, left } = wing;
  const th = ((left ? 1 : -1) * deg * Math.PI) / 180;
  const rows: MeshPoint[][] = [];
  for (let j = 0; j <= nRows; j++) {
    const row: MeshPoint[] = [];
    for (let i = 0; i <= cols; i++) {
      const x = x0 + ((x1 - x0) * i) / cols;
      const y = y0 + ((y1 - y0) * j) / nRows;
      const u = Math.max(0, Math.min(1, left ? (inner - x) / (inner - x0) : (x - inner) / (x1 - inner)));
      const v = Math.max(0, Math.min(1, (y - y0) / (y1 - y0)));
      const a = th * bendWeight(u, v);
      const dx = x - px;
      const dy = y - py;
      row.push({ src: [x, y], dst: [px + dx * Math.cos(a) - dy * Math.sin(a), py + dx * Math.sin(a) + dy * Math.cos(a)] });
    }
    rows.push(row);
  }
  return rows;
}

/** The two triangles of every cell of the grid (6 x 14 cells: 168 triangles a wing, at full size). */
export function wingTriangles(grid: MeshPoint[][]): [MeshPoint, MeshPoint, MeshPoint][] {
  const out: [MeshPoint, MeshPoint, MeshPoint][] = [];
  const rows = grid.length - 1;
  const cols = grid[0].length - 1;
  for (let j = 0; j < rows; j++)
    for (let i = 0; i < cols; i++) {
      const p = grid[j][i];
      const q = grid[j][i + 1];
      const r = grid[j + 1][i];
      const s = grid[j + 1][i + 1];
      out.push([p, q, r], [q, s, r]);
    }
  return out;
}

/** The affine map that sends the picture triangle (s0, s1, s2) onto the drawn one (d0, d1, d2), as canvas setTransform arguments; null for a triangle with no area. */
export function triangleMatrix(s0: [number, number], s1: [number, number], s2: [number, number], d0: [number, number], d1: [number, number], d2: [number, number]): [number, number, number, number, number, number] | null {
  const [x0, y0] = s0;
  const [x1, y1] = s1;
  const [x2, y2] = s2;
  const den = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
  if (!den) return null;
  const a = ((d1[0] - d0[0]) * (y2 - y0) - (d2[0] - d0[0]) * (y1 - y0)) / den;
  const b = ((d1[1] - d0[1]) * (y2 - y0) - (d2[1] - d0[1]) * (y1 - y0)) / den;
  const c = ((d2[0] - d0[0]) * (x1 - x0) - (d1[0] - d0[0]) * (x2 - x0)) / den;
  const d = ((d2[1] - d0[1]) * (x1 - x0) - (d1[1] - d0[1]) * (x2 - x0)) / den;
  return [a, b, c, d, d0[0] - a * x0 - c * y0, d0[1] - b * x0 - d * y0];
}
