import { describe, expect, it } from "vitest";

import type { OwlMood } from "./owl-mood";
import {
  HEAD_PIVOT,
  REDUCED_SCALE,
  REST_POSE,
  WING_COLS,
  WING_LEFT,
  WING_RIGHT,
  WING_ROWS,
  beakTarget,
  bendWeight,
  followOf,
  flutterAngle,
  meshFor,
  motionScale,
  nextBlinkIn,
  pointerLook,
  poseTarget,
  triangleMatrix,
  wingGrid,
  wingTargets,
  wingTriangles,
} from "./plush-rig";

const MOODS: OwlMood[] = ["idle", "listening", "thinking", "answering", "resting"];
const LOOK = { x: 0.8, y: -0.5 };

describe("the five moods, as the prototype and the rig sheet have them", () => {
  it("idle follows the pointer fully, listening 40 %, answering 35 %, thinking and resting not at all", () => {
    expect(MOODS.map(followOf)).toEqual([1, 0.4, 0, 0.35, 0]);
  });
  it("idle: neutral pose that moves to where it looks", () => {
    const p = poseTarget("idle", LOOK, 0);
    expect(p.lid).toBe(0);
    expect(p.dx).toBeCloseTo(0.8 * 14);
    expect(p.dy).toBeCloseTo(-0.5 * 7);
    expect(p.tilt).toBeCloseTo(0.8 * 4);
  });
  it("listening: head tilted 6 deg and leaning in, follows 40 %", () => {
    const p = poseTarget("listening", LOOK, 0);
    expect(p.lean).toBe(0.012);
    expect(p.tilt).toBeCloseTo(6 + 0.8 * 4 * 0.4);
    expect(p.dx).toBeCloseTo(0.8 * 14 * 0.4);
  });
  it("thinking: lids at 0.32, head up and tilted -6 deg, looks up and to one side whatever the pointer does, slower breath", () => {
    const a = poseTarget("thinking", { x: -1, y: 1 }, 0);
    const b = poseTarget("thinking", { x: 1, y: -1 }, 0);
    expect(a).toEqual(b); // the pointer is ignored
    expect(a.lid).toBe(0.32);
    expect(a.tilt).toBe(-6);
    expect(a.dy).toBeLessThan(-6); // up: -6 and a look of -0.6 on top
    expect(a.dx).toBeGreaterThan(0);
    expect(a.brF).toBe(1.1);
  });
  it("answering: hops, follows 35 %", () => {
    const p = poseTarget("answering", LOOK, 0);
    expect(p.bob).toBe(0.012);
    expect(p.dx).toBeCloseTo(0.8 * 14 * 0.35);
  });
  it("resting: both lids shut, head droops 10 px and tilts 3 deg, a deeper slower breath, ignores the pointer", () => {
    const p = poseTarget("resting", LOOK, 0);
    expect(p).toMatchObject({ lid: 1, lidLo: 1, dy: 10, tilt: 3, breathe: 0.02, brF: 0.9, dx: 0 });
    expect(poseTarget("resting", { x: -1, y: 1 }, 5)).toEqual(p);
  });
  it("a mood is the pose it is, not a motion: with reduced motion the tilt, the lids and the droop are the same", () => {
    for (const mood of ["listening", "thinking", "resting"] as const) {
      const full = poseTarget(mood, { x: 0, y: 0 }, 0, 1);
      const less = poseTarget(mood, { x: 0, y: 0 }, 0, REDUCED_SCALE);
      expect(less.lid).toBe(full.lid);
      expect(less.tilt).toBe(full.tilt);
    }
  });
});

describe("prefers-reduced-motion: movement x 0.35 and no flutter", () => {
  it("the scale is 0.35 with it and 1 without", () => {
    expect(motionScale(true)).toBe(0.35);
    expect(motionScale(false)).toBe(1);
  });
  it("what follows the pointer is a third as big", () => {
    const full = poseTarget("idle", LOOK, 0, 1);
    const less = poseTarget("idle", LOOK, 0, REDUCED_SCALE);
    expect(less.dx).toBeCloseTo(full.dx * 0.35);
    expect(less.dy).toBeCloseTo(full.dy * 0.35);
    expect(less.tilt).toBeCloseTo(full.tilt * 0.35);
  });
  it("a flutter burst is 18 deg at most, and nothing at all at scale 0", () => {
    const peak = Math.max(...Array.from({ length: 200 }, (_, i) => flutterAngle(i / 200)));
    expect(peak).toBeLessThanOrEqual(18);
    expect(peak).toBeGreaterThan(10);
    expect(flutterAngle(0.5, 0)).toBe(0);
    expect(flutterAngle(-1)).toBe(0);
    expect(flutterAngle(1)).toBe(0);
  });
});

describe("wings, beak, blink, pointer", () => {
  it("wing angles per mood", () => {
    expect(wingTargets("listening", 0, 0, 1.6)).toEqual({ l: 7, r: 11 });
    expect(wingTargets("thinking", 0, 0, 1.6)).toEqual({ l: 2, r: -16 }); // the right wing taps
    const idle = wingTargets("idle", 0, 0, 1.6);
    expect(idle.l).toBeCloseTo(1.5);
    expect(idle.r).toBe(idle.l);
    const rest = wingTargets("resting", 0.3, 0, 0.9);
    expect(Math.abs(rest.l)).toBeLessThan(1);
    const talk = wingTargets("answering", 0, 3, 1.6);
    expect(talk.l).not.toBe(talk.r); // alternating
  });
  it("the beak opens only while answering", () => {
    for (const m of MOODS.filter((x) => x !== "answering")) expect(beakTarget(m, 1.2, 0.5)).toBe(0);
    expect(beakTarget("answering", Math.PI / 2, 0)).toBeGreaterThan(0);
    expect(beakTarget("answering", -Math.PI / 2, 0)).toBe(0);
  });
  it("a blink comes every 2.4 to 5.9 s, sometimes a quick second one", () => {
    expect(nextBlinkIn(0, 0.9)).toBeCloseTo(2.4);
    expect(nextBlinkIn(1, 0.9)).toBeCloseTo(5.9);
    expect(nextBlinkIn(0.5, 0.1)).toBe(0.3);
  });
  it("the pointer is read from the owl's box and kept between -1 and 1", () => {
    const box = { left: 100, top: 100, width: 200, height: 200 };
    expect(pointerLook(100 + (200 * HEAD_PIVOT.x) / 100, 100 + 200 * 0.3, box)).toEqual({ x: 0, y: 0 }); // the head is where the art turns it (rig.json)
    expect(pointerLook(9999, -9999, box)).toEqual({ x: 1, y: -1 });
  });
});

describe("the wing mesh: 6 x 14 cells of affine triangles, the root stays attached", () => {
  it("is 6 x 14 cells, two triangles each", () => {
    const g = wingGrid(WING_LEFT, 10);
    expect(g).toHaveLength(WING_ROWS + 1);
    expect(g[0]).toHaveLength(WING_COLS + 1);
    expect(wingTriangles(g)).toHaveLength(WING_COLS * WING_ROWS * 2);
  });
  it("a small owl draws the same bend from fewer, bigger triangles; a big one gets the prototype's 6 x 14", () => {
    expect(meshFor(448)).toEqual({ cols: 4, rows: 10 });
    expect(meshFor(240)).toEqual({ cols: 3, rows: 7 });
    expect(meshFor(1024)).toEqual({ cols: WING_COLS, rows: WING_ROWS });
    for (const px of [240, 448, 1024]) {
      const mesh = meshFor(px);
      const g = wingGrid(WING_LEFT, 18, mesh);
      expect(wingTriangles(g)).toHaveLength(mesh.cols * mesh.rows * 2);
      const root = g[0][mesh.cols]; // the root stays attached at every density
      expect(root.dst[0]).toBeCloseTo(root.src[0]);
      expect(root.dst[1]).toBeCloseTo(root.src[1]);
    }
  });
  it("at rest (0 deg) every point is where it is in the picture", () => {
    for (const wing of [WING_LEFT, WING_RIGHT])
      for (const row of wingGrid(wing, 0))
        for (const p of row) {
          expect(p.dst[0]).toBeCloseTo(p.src[0]);
          expect(p.dst[1]).toBeCloseTo(p.src[1]);
        }
  });
  it("the top of the inner edge (the root) does not move at 18 deg, and the tip moves most", () => {
    for (const wing of [WING_LEFT, WING_RIGHT]) {
      const g = wingGrid(wing, 18);
      const root = wing.left ? g[0][WING_COLS] : g[0][0]; // inner edge, top row
      expect(root.dst[0]).toBeCloseTo(root.src[0]);
      expect(root.dst[1]).toBeCloseTo(root.src[1]);
      const tip = wing.left ? g[WING_ROWS][0] : g[WING_ROWS][WING_COLS]; // outer edge, bottom row
      const moved = Math.hypot(tip.dst[0] - tip.src[0], tip.dst[1] - tip.src[1]);
      const mid = g[WING_ROWS / 2][wing.left ? WING_COLS / 2 : WING_COLS / 2];
      expect(moved).toBeGreaterThan(Math.hypot(mid.dst[0] - mid.src[0], mid.dst[1] - mid.src[1]));
      expect(moved).toBeGreaterThan(20);
    }
  });
  it("the outward angle goes the other way on the right wing (mirrored)", () => {
    const l = wingGrid(WING_LEFT, 18)[WING_ROWS][0];
    const r = wingGrid(WING_RIGHT, 18)[WING_ROWS][WING_COLS];
    expect(Math.sign(l.dst[0] - l.src[0])).toBe(-Math.sign(r.dst[0] - r.src[0]));
  });
  it("the bend weight is 0 at the root and grows to the tip", () => {
    expect(bendWeight(0, 0)).toBe(0);
    expect(bendWeight(1, 1)).toBeCloseTo(0.62 + 0.38 + 0.22);
  });
  it("an affine triangle matrix sends each corner of the picture triangle to the drawn one", () => {
    const s: [number, number][] = [[0, 0], [10, 0], [0, 10]];
    const d: [number, number][] = [[5, 5], [25, 5], [5, 15]];
    const m = triangleMatrix(s[0], s[1], s[2], d[0], d[1], d[2])!;
    const apply = ([x, y]: [number, number]) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
    s.forEach((pt, i) => {
      const [x, y] = apply(pt);
      expect(x).toBeCloseTo(d[i][0]);
      expect(y).toBeCloseTo(d[i][1]);
    });
    expect(triangleMatrix([0, 0], [1, 1], [2, 2], d[0], d[1], d[2])).toBeNull(); // no area
  });
  it("the rest pose is a plain neutral", () => {
    expect(REST_POSE).toMatchObject({ tilt: 0, lid: 0, lidLo: 0, bob: 0, lean: 0 });
  });
});
