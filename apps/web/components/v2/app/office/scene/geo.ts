/**
 * Procedural geometry for the characters: heads, hair, torsos, clothing. Built only from three.js
 * primitives that are already installed (no models, no textures, nothing downloaded), shaped by
 * vertex maths and given soft shading (smooth normals, vertex-colour blush). Geometry is cached.
 */
import * as THREE from "three";
import { mergeGeometries, mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { clamp, smoothstep as ss, type Build } from "./anatomy";

export type Detail = "high" | "medium" | "low";

export const SEGS: Record<Detail, { head: [number, number]; round: number; cap: number; torso: number }> = {
  high: { head: [64, 44], round: 12, cap: 4, torso: 32 },
  medium: { head: [40, 28], round: 8, cap: 3, torso: 20 },
  low: { head: [24, 16], round: 6, cap: 2, torso: 12 },
};

const gauss = (x: number, s: number) => Math.exp(-(x * x) / (2 * s * s));
const mix = (a: number, b: number, t: number) => a + (a === b ? 0 : (b - a) * t);

/* ======================================================================== head */
// Half extents of the cranium ellipsoid (metres): 15.4 cm wide, 22.4 cm tall, 20 cm deep.
const A = 0.077;
const B = 0.112;
const C = 0.098;

/** A point on the unit sphere -> the head surface. Jaw, chin, cheekbones, brow and a sloping forehead. */
export function headPoint(ux: number, uy: number, uz: number, build: Build): [number, number, number] {
  let x = ux * A;
  let y = uy * B;
  let z = uz * C;
  const male = build === "m";
  const low = ss(0.12, -0.95, uy); // 0 at the eyes, 1 at the chin
  x *= 1 - (male ? 0.2 : 0.3) * low * low - 0.07 * low; // the jaw narrows to the chin
  if (uz < 0) z *= 1.08; // fuller back of the skull
  const front = ss(0.25, 0.85, uz) * (1 - ss(0.5, 0.95, Math.abs(ux)));
  z -= front * 0.005; // a gently flat face
  z *= 1 - 0.075 * ss(0.15, 1, uy) * ss(0, 0.6, uz); // the forehead slopes back
  const chin = ss(-0.6, -1, uy) * ss(0.1, 0.7, uz);
  z += chin * (male ? 0.014 : 0.009);
  y -= chin * 0.004;
  x += Math.sign(ux) * 0.0045 * gauss(uy + 0.12, 0.22) * gauss(uz - 0.45, 0.3); // cheekbones
  z += (male ? 0.0055 : 0.003) * gauss(uy - 0.33, 0.1) * front; // brow ridge
  return [x, y, z];
}

/** Depth of the face at (x, y) in head coordinates: where eyes, nose and mouth sit. */
export function surfaceZ(x: number, y: number, build: Build): number {
  let ux = clamp(x / A, -0.97, 0.97);
  let uy = clamp(y / B, -0.97, 0.97);
  let p: [number, number, number] = [0, 0, 0];
  for (let i = 0; i < 8; i++) {
    const uz = Math.sqrt(Math.max(0, 1 - ux * ux - uy * uy));
    p = headPoint(ux, uy, uz, build);
    ux = clamp(ux + ((x - p[0]) / A) * 0.9, -0.97, 0.97);
    uy = clamp(uy + ((y - p[1]) / B) * 0.9, -0.97, 0.97);
  }
  return p[2];
}

export function headDims() {
  return { width: A * 2, height: B * 2, depth: C * 2 };
}

const FACE = {
  eyeX: 0.034,
  eyeY: 0.014,
  browY: 0.041,
  noseTipY: -0.027,
  mouthY: -0.066,
  chinY: -0.112,
};
export { FACE };

const cache = new Map<string, THREE.BufferGeometry>();
const cached = (key: string, make: () => THREE.BufferGeometry) => {
  let g = cache.get(key);
  if (!g) {
    g = make();
    cache.set(key, g);
  }
  return g;
};

export function makeHeadGeometry(build: Build, detail: Detail, skin: THREE.Color): THREE.BufferGeometry {
  return cached(`head:${build}:${detail}:${skin.getHexString()}`, () => {
    const [w, h] = SEGS[detail].head;
    const g = new THREE.SphereGeometry(1, w, h);
    g.deleteAttribute("uv");
    g.deleteAttribute("normal");
    const pos = g.attributes.position as THREE.BufferAttribute;
    const colors = new Float32Array(pos.count * 3);
    const blush = skin.clone().lerp(new THREE.Color("#c4505a"), 0.32);
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const ux = pos.getX(i);
      const uy = pos.getY(i);
      const uz = pos.getZ(i);
      const p = headPoint(ux, uy, uz, build);
      pos.setXYZ(i, p[0], p[1], p[2]);
      const cheek = 0.5 * gauss(uy + 0.12, 0.2) * gauss(Math.abs(ux) - 0.55, 0.22) * ss(0.1, 0.6, uz);
      const brow = 0.14 * gauss(uy - 0.12, 0.09) * gauss(Math.abs(ux) - 0.42, 0.15) * ss(0.2, 0.7, uz);
      // soft shading baked into the skin: eye sockets, beside the nose, under the lip, under the jaw, temples
      const sockets = 0.2 * gauss(uy - 0.1, 0.1) * gauss(Math.abs(ux) - 0.44, 0.13) * ss(0.2, 0.7, uz);
      const nose = 0.1 * gauss(uy + 0.2, 0.12) * gauss(Math.abs(ux) - 0.2, 0.07) * ss(0.4, 0.8, uz);
      const lip = 0.09 * gauss(uy + 0.72, 0.06) * gauss(ux, 0.22) * ss(0.4, 0.8, uz);
      const jaw = 0.18 * ss(-0.78, -1, uy);
      const temple = 0.06 * gauss(uy - 0.2, 0.2) * ss(0.82, 1, Math.abs(ux));
      const ao = Math.min(0.4, brow + sockets + nose + lip + jaw + temple);
      c.copy(skin).lerp(blush, cheek).multiplyScalar(1 - ao);
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }
    g.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    const welded = mergeVertices(g, 1e-5); // closes the seam and the poles so the shading is continuous
    welded.computeVertexNormals();
    return welded;
  });
}

/* ======================================================================== hair */
export type HairStyle = "crop" | "bob" | "long" | "bun" | "curly" | "puff";

interface CapOpts {
  thick: (ux: number, uy: number, uz: number) => number;
  /** Height (unit sphere y) of the hairline at a given direction; the shell thins to nothing there. */
  edge?: (ux: number, uz: number) => number;
  /** Alternatively a smooth 0..1 weight over the skull (facial hair). */
  weight?: (ux: number, uy: number, uz: number) => number;
}

/** Soft grey streaks (per vertex) that read as strands once multiplied by the hair colour. */
function streak(x: number, y: number, z: number, k = 1): number {
  const a = Math.atan2(x, z);
  return 0.8 + 0.2 * (0.5 + 0.5 * Math.sin(a * 41 + y * 9 + Math.sin(a * 7) * 2)) * k;
}
function paint(g: THREE.BufferGeometry, fn: (x: number, y: number, z: number) => number) {
  const pos = g.attributes.position as THREE.BufferAttribute;
  const c = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const v = fn(pos.getX(i), pos.getY(i), pos.getZ(i));
    c[i * 3] = c[i * 3 + 1] = c[i * 3 + 2] = v;
  }
  g.setAttribute("color", new THREE.BufferAttribute(c, 3));
}

/** A shell hugging the skull (thicker where hair has volume), thinning to nothing along a hairline. */
function capGeometry(build: Build, detail: Detail, o: CapOpts, noise = 0.0025): THREE.BufferGeometry {
  const [w, h] = SEGS[detail].head;
  const g = new THREE.SphereGeometry(1, w, h);
  g.deleteAttribute("uv");
  g.deleteAttribute("normal");
  const pos = g.attributes.position as THREE.BufferAttribute;
  const u = new Float32Array(pos.count * 3);
  const inside = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    const ux = pos.getX(i);
    const uy = pos.getY(i);
    const uz = pos.getZ(i);
    u.set([ux, uy, uz], i * 3);
    const taper = o.weight ? o.weight(ux, uy, uz) : ss(0, 0.13, uy - (o.edge as (a: number, b: number) => number)(ux, uz));
    inside[i] = taper > 0.02 ? 1 : 0;
    const p = headPoint(ux, uy, uz, build);
    const t = (o.thick(ux, uy, uz) + noise * Math.sin(ux * 9 + uy * 6) * Math.cos(uz * 7 - uy * 3)) * taper + 0.0008;
    pos.setXYZ(i, p[0] + ux * t, p[1] + uy * t, p[2] + uz * t);
  }
  g.setAttribute("u", new THREE.BufferAttribute(u, 3));
  g.setAttribute("inside", new THREE.BufferAttribute(inside, 1));
  paint(g, streak);
  const welded = mergeVertices(g, 1e-5);
  const index = welded.index as THREE.BufferAttribute;
  const inA = welded.attributes.inside as THREE.BufferAttribute;
  const kept: number[] = [];
  for (let i = 0; i < index.count; i += 3) {
    const a = index.getX(i);
    const b = index.getX(i + 1);
    const c = index.getX(i + 2);
    if (inA.getX(a) + inA.getX(b) + inA.getX(c) >= 1) kept.push(a, b, c);
  }
  welded.setIndex(kept);
  welded.deleteAttribute("u");
  welded.deleteAttribute("inside");
  welded.computeVertexNormals();
  return welded;
}

const hairlineFront = (ux: number) => 0.74 - 0.3 * ss(0.3, 0.95, Math.abs(ux));
function hairline(ux: number, uz: number, back: number, front = hairlineFront(ux)) {
  const base = mix(back, front, ss(-0.15, 0.45, uz));
  const side = ss(0.55, 0.92, Math.abs(ux)) * (1 - ss(0.1, 0.45, uz));
  return mix(base, Math.min(base, 0.2), side);
}

/** Clusters of spheres that read as curls or a puff, merged into one mesh. */
function curls(build: Build, detail: Detail, radius: number, count: number, lift: number, keep: (ux: number, uy: number, uz: number) => boolean) {
  const parts: THREE.BufferGeometry[] = [];
  const golden = Math.PI * (3 - Math.sqrt(5));
  const n = detail === "high" ? count : detail === "medium" ? Math.round(count * 0.65) : Math.round(count * 0.4);
  for (let i = 0, k = 0; k < n * 3 && i < n; k++) {
    const uy = 1 - ((k + 0.5) / (n * 3)) * 2;
    const r = Math.sqrt(Math.max(0, 1 - uy * uy));
    const th = golden * k;
    const ux = Math.cos(th) * r;
    const uz = Math.sin(th) * r;
    if (!keep(ux, uy, uz)) continue;
    const p = headPoint(ux, uy, uz, build);
    const jitter = 1 + 0.18 * Math.sin(k * 12.9898);
    const s = new THREE.SphereGeometry(radius * jitter, detail === "low" ? 6 : 10, detail === "low" ? 4 : 7);
    s.translate(p[0] + ux * lift, p[1] + uy * lift, p[2] + uz * lift);
    s.deleteAttribute("uv"); // every merged part must carry the same attributes
    const shade = 0.72 + 0.28 * (0.5 + 0.5 * Math.sin(k * 7.31));
    paint(s, () => shade);
    parts.push(s);
    i++;
  }
  return mergeGeometries(parts, false) ?? new THREE.BufferGeometry();
}

/** The curtain of a bob or long hair: open at the front, wavy, with a little strand-like ripple. */
function curtain(detail: Detail, profile: [number, number][], half: number, wave: number): THREE.BufferGeometry {
  const pts = profile.map(([r, y]) => new THREE.Vector2(r, y));
  const g = new THREE.LatheGeometry(pts, detail === "high" ? 64 : detail === "medium" ? 40 : 24, Math.PI - half, half * 2);
  const pos = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    let x = pos.getX(i);
    let z = pos.getZ(i);
    const y = pos.getY(i);
    const phi = Math.atan2(x, z);
    const rip = 1 + 0.025 * Math.sin(phi * 23) + wave * Math.sin(phi * 7 + y * 22);
    x *= 0.86 * rip;
    z *= 1.14 * rip;
    pos.setXYZ(i, x, y, z);
  }
  g.deleteAttribute("uv");
  paint(g, streak);
  g.computeVertexNormals();
  return g;
}

export interface HairParts {
  main: THREE.BufferGeometry;
  /** Extra pieces (bun, tie) that share the hair material. */
  extra: THREE.BufferGeometry[];
}

export function makeHairGeometry(style: HairStyle, build: Build, detail: Detail): HairParts {
  const key = `hair:${style}:${build}:${detail}`;
  const main = cached(key, () => {
    switch (style) {
      case "crop":
        return capGeometry(
          build,
          detail,
          {
            thick: (_ux, uy, uz) => 0.006 + 0.011 * ss(0, 0.9, uy) * (0.6 + 0.4 * ss(-0.3, 0.6, uz)) + 0.01 * gauss(uy - 0.78, 0.2) * ss(0.2, 0.9, uz),
            edge: (ux, uz) => hairline(ux, uz, -0.34),
          },
          0.003,
        );
      case "bun":
        return capGeometry(build, detail, {
          thick: (_ux, uy) => 0.0045 + 0.004 * ss(0.2, 1, uy),
          edge: (ux, uz) => hairline(ux, uz, -0.2, 0.7 - 0.25 * ss(0.3, 0.95, Math.abs(ux))),
        });
      case "bob":
        return mergeGeometries(
          [
            capGeometry(build, detail, {
              thick: (_ux, uy) => 0.007 + 0.009 * ss(0.2, 1, uy),
              edge: (ux, uz) => hairline(ux, uz, -0.5, 0.6 - 0.2 * ss(0.3, 0.95, Math.abs(ux))),
            }),
            curtain(detail, [[0.092, 0.05], [0.099, 0.0], [0.1, -0.04], [0.094, -0.085], [0.084, -0.1]], 2.0, 0.004),
          ],
          false,
        )!;
      case "long":
        return mergeGeometries(
          [
            capGeometry(build, detail, {
              thick: (_ux, uy) => 0.007 + 0.008 * ss(0.2, 1, uy),
              edge: (ux, uz) => hairline(ux, uz, -0.5, 0.64 - 0.22 * ss(0.3, 0.95, Math.abs(ux))),
            }),
            curtain(detail, [[0.092, 0.05], [0.1, -0.02], [0.105, -0.1], [0.108, -0.19], [0.1, -0.27], [0.085, -0.33]], 2.3, 0.01),
          ],
          false,
        )!;
      case "curly":
        return mergeGeometries(
          [
            capGeometry(build, detail, {
              thick: () => 0.006,
              edge: (ux, uz) => hairline(ux, uz, -0.3, 0.7 - 0.25 * ss(0.3, 0.95, Math.abs(ux))),
            }),
            curls(build, detail, 0.0185, 170, 0.01, (ux, uy, uz) => uy > hairline(ux, uz, -0.28, 0.68 - 0.25 * ss(0.3, 0.95, Math.abs(ux)))),
          ],
          false,
        )!;
      case "puff":
        return mergeGeometries(
          [
            capGeometry(build, detail, {
              thick: () => 0.006,
              edge: (ux, uz) => hairline(ux, uz, -0.2, 0.72 - 0.25 * ss(0.3, 0.95, Math.abs(ux))),
            }),
            curls(build, detail, 0.027, 110, 0.016, (ux, uy, uz) => uy > 0.12 && (uy > 0.35 || uz < 0.1) && hairline(ux, uz, -0.15) < uy + 0.05),
          ],
          false,
        )!;
    }
  });
  const extra: THREE.BufferGeometry[] = [];
  if (style === "bun") {
    extra.push(cached(`bun:${detail}`, () => {
      const s = new THREE.SphereGeometry(0.05, detail === "low" ? 8 : 18, detail === "low" ? 6 : 12);
      s.scale(1, 0.9, 1);
      s.translate(0, 0.07, -0.082);
      s.deleteAttribute("uv");
      paint(s, streak);
      return s;
    }));
  }
  return { main, extra };
}

/** Facial hair: a thin shell over the lower face, with the mouth left clear and a moustache above it. */
export function makeBeardGeometry(build: Build, detail: Detail, thickness: number): THREE.BufferGeometry {
  return cached(`beard:${build}:${detail}:${thickness}`, () =>
    capGeometry(
      build,
      detail,
      {
        thick: (_ux, uy) => thickness * (0.75 + 0.25 * ss(-0.6, -1, uy)),
        weight: (ux, uy, uz) => {
          const ax = Math.abs(ux);
          // the beard line: low on the cheeks, rising to the sideburns beside the ears
          const top = -0.3 - 0.18 * ss(0.3, 0.8, ax) + 0.4 * ss(0.8, 0.98, ax);
          const lower = ss(top, top - 0.12, uy);
          const front = ss(-0.15, 0.3, uz);
          const m = (ux * A) ** 2 / 0.029 ** 2 + (uy * B + 0.066) ** 2 / 0.0135 ** 2;
          const hole = ss(0.8, 1.4, m);
          return lower * front * hole;
        },
      },
      0.0012,
    ),
  );
}

/* ====================================================================== torso */
function torsoProfile(build: Build): [number, number][] {
  return build === "m"
    ? [[0.15, 0.5], [0.168, 0.54], [0.156, 0.62], [0.15, 0.68], [0.162, 0.8], [0.176, 0.93], [0.172, 1.02], [0.15, 1.062], [0.1, 1.085], [0.058, 1.1], [0.0, 1.104]]
    : [[0.16, 0.5], [0.172, 0.54], [0.15, 0.62], [0.132, 0.68], [0.146, 0.8], [0.162, 0.93], [0.156, 1.02], [0.138, 1.06], [0.095, 1.083], [0.055, 1.098], [0.0, 1.102]];
}
const TORSO_X: Record<Build, number> = { m: 1.12, f: 1.04 };
const TORSO_Z: Record<Build, number> = { m: 0.68, f: 0.62 };

/** Front surface depth (z) of the torso at height y. */
export function torsoFront(y: number, build: Build): number {
  const pr = torsoProfile(build);
  for (let i = 0; i < pr.length - 1; i++) {
    const [r0, y0] = pr[i];
    const [r1, y1] = pr[i + 1];
    if (y >= y0 && y <= y1) return (r0 + ((r1 - r0) * (y - y0)) / (y1 - y0)) * TORSO_Z[build];
  }
  return 0.1;
}

export function makeTorsoGeometry(build: Build, detail: Detail): THREE.BufferGeometry {
  return cached(`torso:${build}:${detail}`, () => {
    const pts = torsoProfile(build).map(([r, y]) => new THREE.Vector2(r, y));
    const g = new THREE.LatheGeometry(pts, SEGS[detail].torso);
    const pos = g.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      let x = pos.getX(i) * TORSO_X[build];
      let z = pos.getZ(i) * TORSO_Z[build];
      const y = pos.getY(i);
      // soft folds at the waist, and a slight bust for the f build
      const ang = Math.atan2(x, z);
      const r = Math.hypot(x, z);
      const fold = 1 + 0.012 * Math.sin(ang * 4 + y * 38) * gauss(y - 0.66, 0.1);
      x *= fold;
      z *= fold;
      if (build === "f" && z > 0) z += 0.013 * gauss(y - 0.93, 0.07) * gauss(Math.abs(x) - 0.075, 0.055) * (r > 0 ? 1 : 0);
      pos.setXYZ(i, x, y, z);
    }
    g.computeVertexNormals();
    return g;
  });
}

/** A tapered limb of unit height along +y (scale y by the length). Optional creases near the low end. */
export function makeLimbGeometry(rTop: number, rBot: number, detail: Detail, creases = 0): THREE.BufferGeometry {
  return cached(`limb:${rTop.toFixed(4)}:${rBot.toFixed(4)}:${detail}:${creases}`, () => {
    const radial = SEGS[detail].round + 4;
    const g = new THREE.CylinderGeometry(rTop, rBot, 1, radial, creases ? 10 : 1, false);
    if (creases) {
      const pos = g.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < pos.count; i++) {
        const y = pos.getY(i) + 0.5; // 0 at the bottom (elbow end), 1 at the top
        const x = pos.getX(i);
        const z = pos.getZ(i);
        const ang = Math.atan2(x, z);
        const k = 1 + creases * Math.sin(y * 42) * gauss(y - 0.12, 0.16) * (0.55 + 0.45 * Math.cos(ang));
        pos.setXYZ(i, x * k, pos.getY(i), z * k);
      }
    }
    g.computeVertexNormals();
    return g;
  });
}

/** A capsule lying along +z from the origin (for fingers, thighs): length L between the joint centres. */
export function makeCapsuleZ(r: number, L: number, detail: Detail): THREE.BufferGeometry {
  return cached(`capz:${r.toFixed(4)}:${L.toFixed(4)}:${detail}`, () => {
    const g = new THREE.CapsuleGeometry(r, L, SEGS[detail].cap, SEGS[detail].round);
    g.rotateX(Math.PI / 2);
    g.translate(0, 0, L / 2);
    return g;
  });
}

export function makeEllipsoid(rx: number, ry: number, rz: number, detail: Detail): THREE.BufferGeometry {
  return cached(`ell:${rx.toFixed(4)}:${ry.toFixed(4)}:${rz.toFixed(4)}:${detail}`, () => {
    const g = new THREE.SphereGeometry(1, detail === "high" ? 24 : detail === "medium" ? 16 : 10, detail === "high" ? 16 : detail === "medium" ? 11 : 7);
    g.scale(rx, ry, rz);
    return g;
  });
}

/** An office chair merged into one geometry: seat, back, post, five-star base. */
export function makeChairGeometry(): THREE.BufferGeometry {
  return cached("chair", () => {
    const parts: THREE.BufferGeometry[] = [];
    const seat = new THREE.CapsuleGeometry(0.055, 0.4, 3, 12);
    seat.rotateZ(Math.PI / 2);
    seat.scale(1, 0.55, 1.18);
    seat.translate(0, 0.435, 0);
    parts.push(seat);
    const back = new THREE.CylinderGeometry(0.28, 0.28, 0.46, 20, 1, true, Math.PI - 0.9, 1.8);
    back.scale(1, 1, 0.45);
    back.rotateX(-0.12);
    back.translate(0, 0.77, -0.27);
    parts.push(back);
    const post = new THREE.CylinderGeometry(0.035, 0.04, 0.34, 10);
    post.translate(0, 0.25, 0);
    parts.push(post);
    for (let i = 0; i < 5; i++) {
      const leg = new THREE.BoxGeometry(0.04, 0.03, 0.32);
      leg.translate(0, 0, 0.16);
      leg.rotateY((i / 5) * Math.PI * 2);
      leg.translate(0, 0.055, 0);
      parts.push(leg);
      const caster = new THREE.SphereGeometry(0.03, 8, 6);
      caster.translate(0, 0.03, 0.31);
      caster.rotateY((i / 5) * Math.PI * 2);
      parts.push(caster);
    }
    // an indexed geometry may carry different attributes; keep position + normal only
    for (const p of parts) {
      p.deleteAttribute("uv");
      if (!p.index) continue;
    }
    const merged = mergeGeometries(parts, false)!;
    merged.computeVertexNormals();
    return merged;
  });
}
