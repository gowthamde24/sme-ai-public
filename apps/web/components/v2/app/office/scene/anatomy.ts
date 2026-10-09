/**
 * Measurements and pure maths for the seated characters. Everything is in metres, in the person's
 * local frame: origin on the floor under the chair, +y up, +z forward (toward the table centre),
 * +x toward the person's LEFT. No three.js in here, so it is trivially testable.
 */
import { TABLE_HEIGHT } from "./seats";

export type V3 = [number, number, number];
export const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const scale = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
export const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const len = (a: V3) => Math.hypot(a[0], a[1], a[2]);
export const norm = (a: V3): V3 => {
  const l = len(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
export const smoothstep = (e0: number, e1: number, x: number) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};

export type Build = "m" | "f";

/** Adult proportions (about 1.70 m standing). Head width : shoulder width is about 0.37, as in life. */
export const BODY = {
  seatY: 0.47,
  hipY: 0.52,
  shoulderY: 1.045,
  shoulderX: { m: 0.205, f: 0.185 } as Record<Build, number>,
  upperArm: 0.285,
  forearm: 0.255,
  neckBaseY: 1.085,
  headCenter: [0, 1.298, 0.03] as V3,
  headWidth: 0.154,
};

/** A 13-inch laptop on the table, close to its person. z is measured forward from the chair centre. */
export const LAPTOP = {
  z: 0.52,
  width: 0.3,
  depth: 0.21,
  base: 0.018,
  keyH: 0.008,
  screenH: 0.2,
  /** Lean of the screen back from vertical (radians): it faces the person's face. */
  screenTilt: 0.42,
};
export const DECK_Y = TABLE_HEIGHT + LAPTOP.base;
export const KEY_Y = DECK_Y + LAPTOP.keyH;
/** The key area, front to back (the palm rest is in front of it). */
export const KEYBOARD_Z: [number, number] = [LAPTOP.z - LAPTOP.depth / 2 + 0.055, LAPTOP.z + LAPTOP.depth / 2 - 0.02];

/** Where each wrist hovers: just in front of the keys, a little above the palm rest. x is the person's LEFT hand. */
export const WRIST = { x: 0.1, y: 0.918, z: 0.4 };
export const HAND_PITCH = 0.1; // fingers tilt down toward the keys (radians)
export const HAND_YAW = 0.07; // hands angle in toward the middle (radians)

/* ------------------------------------------------------------- two-bone arm */
/**
 * Where the elbow goes so that the upper arm (a) and forearm (b) both keep their length while the
 * hand sits at W. `pole` says which way the elbow points (down and out for a seated typist).
 */
export function solveArm(S: V3, W: V3, a: number, b: number, pole: V3): V3 {
  const toW = sub(W, S);
  const d = clamp(len(toW), Math.abs(a - b) + 1e-4, a + b - 1e-4);
  const u = norm(toW);
  const along = (a * a - b * b + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, a * a - along * along));
  // the part of the pole perpendicular to the shoulder-wrist line
  const p = sub(pole, scale(u, dot(pole, u)));
  const perp = norm(len(p) < 1e-6 ? [0, -1, 0] : p);
  return add(add(S, scale(u, along)), scale(perp, h));
}

/* ---------------------------------------------------------------- the hand */
export const HAND = { palmLen: 0.094, palmHalfW: 0.042, palmThick: 0.03 };

export interface FingerSpec {
  name: "index" | "middle" | "ring" | "pinky";
  /** Knuckle position in the hand frame (x toward the thumb side, z forward from the wrist). */
  x: number;
  z: number;
  lengths: [number, number, number];
  radii: [number, number, number];
  /** Splay (radians about y). */
  yaw: number;
}
export const FINGERS: FingerSpec[] = [
  { name: "index", x: 0.031, z: 0.094, lengths: [0.04, 0.024, 0.02], radii: [0.0088, 0.008, 0.0072], yaw: 0.04 },
  { name: "middle", x: 0.01, z: 0.097, lengths: [0.044, 0.027, 0.022], radii: [0.0092, 0.0084, 0.0075], yaw: 0 },
  { name: "ring", x: -0.011, z: 0.093, lengths: [0.04, 0.025, 0.02], radii: [0.0086, 0.0078, 0.007], yaw: -0.035 },
  { name: "pinky", x: -0.03, z: 0.085, lengths: [0.031, 0.019, 0.017], radii: [0.0076, 0.0068, 0.006], yaw: -0.09 },
];
export const THUMB = {
  /** Base of the thumb, on the side of the palm. */
  base: [0.04, -0.01, 0.026] as V3,
  lengths: [0.04, 0.03, 0.025] as [number, number, number],
  radii: [0.0118, 0.0102, 0.009] as [number, number, number],
  yaw: 0.4,
};
/** How a curl amount s spreads over the three finger joints (knuckle, middle, tip). */
export const CURL_SHAPE: [number, number, number] = [0.55, 1.0, 0.6];

/** Height (hand frame, y up) and reach (z forward) of a finger tip centre for a curl amount s. */
export function fingerTip(f: Pick<FingerSpec, "lengths" | "radii" | "z">, s: number): { y: number; z: number } {
  let y = 0;
  let z = f.z;
  let ang = 0;
  for (let j = 0; j < 3; j++) {
    ang += CURL_SHAPE[j] * s;
    y -= f.lengths[j] * Math.sin(ang);
    z += f.lengths[j] * Math.cos(ang);
  }
  // the capsule cap carries on a little way past the last joint
  y -= f.radii[2] * 0.0;
  return { y, z };
}

/** World height of the underside of a fingertip: wrist height plus the hand's pitch applied to the tip. */
export function fingerContactY(f: FingerSpec, s: number, wristY = WRIST.y, pitch = HAND_PITCH): number {
  const t = fingerTip(f, s);
  return wristY + t.y * Math.cos(pitch) - t.z * Math.sin(pitch) - f.radii[2];
}

/** The curl amount that puts the fingertip exactly on the key tops (bisection; contact height falls as s rises). */
export function solveCurl(f: FingerSpec, targetY = KEY_Y, wristY = WRIST.y, pitch = HAND_PITCH): number {
  let lo = 0;
  let hi = 2.2;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (fingerContactY(f, mid, wristY, pitch) > targetY) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/** Thumb: rests on the deck beside the space bar. */
export function solveThumbCurl(targetY = DECK_Y + 0.012, wristY = WRIST.y, pitch = HAND_PITCH): number {
  const f = { lengths: THUMB.lengths, radii: THUMB.radii, z: THUMB.base[2] } as FingerSpec;
  const base = THUMB.base[1];
  let lo = 0;
  let hi = 1.8;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    const t = fingerTip(f, mid);
    const y = wristY + (base + t.y) * Math.cos(pitch) - t.z * Math.sin(pitch) - THUMB.radii[2];
    if (y > targetY) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}
