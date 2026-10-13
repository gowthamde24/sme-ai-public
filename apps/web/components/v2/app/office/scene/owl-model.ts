/**
 * The 3D owl, built in code (no model, no texture file): a round glossy clay body, a cap with a V point, brows, curled ear tufts and wings in the agent's colour, big eyes in orange rings,
 * a cream scalloped chest, rosy cheeks, ^^ happy eyes, an orange beak and feet; five moods. Ported from the approved reference (~/Desktop/v2-overnight/owl3d.html, three r128) to the three this
 * app ships (r186): colours go through the colour-space API, and the lights are multiplied by PI because r155 dropped the old "legacy" light scale.
 * This is code that imports three: it is only ever reached through next/dynamic (a test and `npm run audit:3d` keep it that way).
 * The geometries and the two canvas textures are shared by every owl on the page (reference counted); each owl has its own materials, so its colours are its own.
 */
import * as THREE from "three";

import { OWL_BODY, type OwlPalette } from "../../owl/owl-colors";
import type { OwlMood } from "../../owl/owl-mood";

export type Detail = "high" | "medium" | "low";

/** The pose a mood asks for at time `t`: pure numbers, so it can be tested without WebGL. */
export type MoodTargets = { tilt: number; tuft: number; lean: number; open: number; ringOp: number; hop: number; sway: number; wide: number; brow: number; happy: boolean; gaze: "free" | "up" | "down" };

export function moodTargets(mood: OwlMood, t: number): MoodTargets {
  const v: MoodTargets = { tilt: 0, tuft: 0, lean: 0, open: 1, ringOp: 0, hop: 0, sway: 0, wide: 1, brow: 0, happy: false, gaze: "free" };
  if (mood === "listening") Object.assign(v, { tuft: 0.35, lean: 0.25, ringOp: 0.35 + 0.35 * Math.sin(t * 6), wide: 1.1, brow: 0.08 });
  if (mood === "thinking") Object.assign(v, { tilt: Math.sin(t * 1.6) * 0.14, brow: Math.sin(t * 1.6) * 0.06, gaze: "up" });
  if (mood === "answering") Object.assign(v, { hop: Math.max(0, Math.sin(t * 6)) * 0.08, ringOp: 0.55 + 0.25 * Math.sin(t * 3), happy: t % 3.2 < 1.4, brow: 0.06 });
  if (mood === "resting") Object.assign(v, { open: 0.3, sway: Math.sin(t * 0.9) * 0.05, tuft: -0.2, gaze: "down" });
  return v;
}

export interface OwlRig {
  /** The owl and its extras (ring, thinking dots, soft shadow); add this one object to a scene. The owl stands on y = 0, about 3.3 units tall. */
  root: THREE.Group;
  /** Move to the pose of `mood`; `t` is seconds since the start, `dt` the frame time. */
  update(mood: OwlMood, t: number, dt: number): void;
  /** A still pose of `mood`, applied at once (no blink, no breathing): for reduced motion, and for an owl that is doing nothing. */
  snap(mood: OwlMood): void;
  /** Where to look, -1..1 on both axes (a pointer); null = look around by itself. */
  setLook(x: number | null, y?: number): void;
  dispose(): void;
}

export type OwlOptions = { detail?: Detail; /** the ring and the thinking dots */ extras?: boolean; /** a soft contact shadow under the feet */ shadow?: boolean };

/* ------------------------------------------------------------------ shared geometry */
const SEG = {
  high: { big: [64, 40], small: [24, 16], tube: [64, 20], torus: 72, cap: [72, 40] },
  medium: { big: [40, 26], small: [16, 12], tube: [40, 12], torus: 44, cap: [44, 26] },
  low: { big: [24, 16], small: [12, 8], tube: [24, 8], torus: 28, cap: [28, 16] },
} as const;

const R = 1.45;
const C = new THREE.Vector3(0, 1.62, 0);

type Shared = {
  big: THREE.SphereGeometry;
  small: THREE.SphereGeometry;
  cap: THREE.SphereGeometry;
  half: THREE.SphereGeometry;
  ring: THREE.TorusGeometry;
  smile: THREE.TorusGeometry;
  halo: THREE.TorusGeometry;
  tubeL: THREE.TubeGeometry;
  tubeR: THREE.TubeGeometry;
  plane: THREE.PlaneGeometry;
  iris: THREE.CanvasTexture;
  shadow: THREE.CanvasTexture;
};
const pool = new Map<Detail, { shared: Shared; refs: number }>();

function tuftTube(sd: number, tubular: number, radial: number): THREE.TubeGeometry {
  const pts = [
    [0, 0, 0],
    [sd * 0.32, 0.1, 0],
    [sd * 0.6, 0.2, -0.02],
    [sd * 0.74, 0.38, -0.03],
    [sd * 0.66, 0.52, -0.04],
    [sd * 0.52, 0.5, -0.04],
  ].map((p) => new THREE.Vector3(p[0], p[1], p[2]));
  const curve = new THREE.CatmullRomCurve3(pts);
  const tube = new THREE.TubeGeometry(curve, tubular, 0.24, radial, false);
  // taper the tube toward the tip
  const pos = tube.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    const seg = Math.floor(i / (radial + 1)) / tubular;
    v.fromBufferAttribute(pos, i);
    const c = curve.getPoint(Math.min(seg, 1));
    v.sub(c).multiplyScalar(1 - 0.5 * seg).add(c);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  tube.computeVertexNormals();
  return tube;
}

function canvasTexture(size: number, draw: (g: CanvasRenderingContext2D) => void, srgb: boolean): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d");
  if (g) draw(g);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function build(detail: Detail): Shared {
  const s = SEG[detail];
  const iris = canvasTexture(
    256,
    (g) => {
      const grd = g.createRadialGradient(128, 96, 10, 128, 128, 128);
      grd.addColorStop(0, "#6fc4f5");
      grd.addColorStop(0.55, "#2f8fe0");
      grd.addColorStop(0.9, "#1a4f9c");
      grd.addColorStop(1, "#10325f");
      g.fillStyle = grd;
      g.fillRect(0, 0, 256, 256);
    },
    true,
  );
  const shadow = canvasTexture(
    128,
    (g) => {
      const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
      grd.addColorStop(0, "rgba(0,0,0,.35)");
      grd.addColorStop(1, "rgba(0,0,0,0)");
      g.fillStyle = grd;
      g.fillRect(0, 0, 128, 128);
    },
    false,
  );
  return {
    big: new THREE.SphereGeometry(1, s.big[0], s.big[1]),
    small: new THREE.SphereGeometry(1, s.small[0], s.small[1]),
    cap: new THREE.SphereGeometry(R * 1.018, s.cap[0], s.cap[1], 0, Math.PI * 2, 0, 1.02),
    half: new THREE.SphereGeometry(1, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2),
    ring: new THREE.TorusGeometry(0.52, 0.085, 24, s.torus),
    smile: new THREE.TorusGeometry(0.2, 0.045, 12, 40, Math.PI),
    halo: new THREE.TorusGeometry(2.25, 0.03, 10, 140),
    tubeL: tuftTube(-1, s.tube[0], s.tube[1]),
    tubeR: tuftTube(1, s.tube[0], s.tube[1]),
    plane: new THREE.PlaneGeometry(3.6, 3.6),
    iris,
    shadow,
  };
}

function acquire(detail: Detail): Shared {
  let e = pool.get(detail);
  if (!e) {
    e = { shared: build(detail), refs: 0 };
    pool.set(detail, e);
  }
  e.refs++;
  return e.shared;
}

function release(detail: Detail): void {
  const e = pool.get(detail);
  if (!e || --e.refs > 0) return;
  pool.delete(detail);
  for (const x of Object.values(e.shared)) (x as { dispose(): void }).dispose();
}

/** A colour as the reference showed it in r128, where a MeshBasicMaterial colour was written to the screen without conversion: the hex values are taken as linear. */
const rawColor = (hex: number) => new THREE.Color().setRGB(((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255, THREE.LinearSRGBColorSpace);

const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

/* ----------------------------------------------------------------------- the owl */
export function createOwl(palette: OwlPalette, opts: OwlOptions = {}): OwlRig {
  const detail = opts.detail ?? "high";
  const sh = acquire(detail);
  const mats: THREE.Material[] = [];
  const track = <T extends THREE.Material>(m: T): T => {
    mats.push(m);
    return m;
  };
  // the clay: glossy (clearcoat) on a capable device, a plain standard material at the lowest detail
  const clay = (hex: string, roughness = 0.42, clearcoat = 0.55) =>
    track<THREE.Material>(
      detail === "low"
        ? new THREE.MeshStandardMaterial({ color: new THREE.Color(hex), roughness: Math.max(roughness, 0.45), metalness: 0 })
        : new THREE.MeshPhysicalMaterial({ color: new THREE.Color(hex), roughness, metalness: 0, clearcoat, clearcoatRoughness: 0.35 }),
    );
  const M = {
    cream: clay(OWL_BODY.cream),
    creamLight: clay(OWL_BODY.creamLight),
    creamDeep: clay(OWL_BODY.creamDeep),
    cap: clay(palette.cap),
    capDeep: clay(palette.capDeep),
    orange: clay(OWL_BODY.accent, 0.3, 0.8),
    socket: clay(OWL_BODY.socket, 0.5),
    pupil: track(new THREE.MeshPhysicalMaterial({ color: new THREE.Color(OWL_BODY.pupil), roughness: 0.08, clearcoat: 1, clearcoatRoughness: 0.02 })),
    iris: track(new THREE.MeshPhysicalMaterial({ map: sh.iris, roughness: 0.12, clearcoat: 1, clearcoatRoughness: 0.05 })),
    white: track(new THREE.MeshBasicMaterial({ color: rawColor(0xfff6ec) })),
    cheek: track(new THREE.MeshBasicMaterial({ color: rawColor(0xff9d8c), transparent: true, opacity: 0.75 })),
  };

  const root = new THREE.Group();
  const owl = new THREE.Group();
  const bob = new THREE.Group();
  root.add(owl);
  owl.add(bob);
  const ball = (mat: THREE.Material, r: number, sx = 1, sy = 1, sz = 1, small = false) => {
    const m = new THREE.Mesh(small ? sh.small : sh.big, mat);
    m.scale.set(r * sx, r * sy, r * sz);
    return m;
  };

  // body: one round, glossy form
  const body = ball(M.cream, R, 1, 0.98, 0.94);
  body.position.copy(C);
  bob.add(body);
  // cap with a V point between the eyes
  const cap = new THREE.Mesh(sh.cap, M.cap);
  cap.position.copy(C);
  cap.scale.set(1, 0.98, 0.94);
  bob.add(cap);
  const peak = ball(M.cap, 1, 0.2, 0.42, 0.12);
  peak.position.set(0, 2.12, 1.24);
  peak.rotation.x = -0.42;
  bob.add(peak);
  // brows sweeping out from the peak along the cap edge
  const brows: THREE.Mesh[] = [];
  for (const sd of [-1, 1]) {
    const b = ball(M.cap, 1, 0.55, 0.15, 0.15);
    b.position.set(sd * 0.56, 2.4, 1.0);
    b.rotation.z = sd * 0.16;
    b.rotation.y = sd * 0.45;
    bob.add(b);
    brows.push(b);
  }
  // curled ear tufts
  const tufts: THREE.Group[] = [];
  for (const sd of [-1, 1]) {
    const g = new THREE.Group();
    g.position.set(sd * 0.62, 2.72, 0.05);
    bob.add(g);
    g.add(new THREE.Mesh(sd < 0 ? sh.tubeL : sh.tubeR, M.cap));
    const tip = ball(M.cap, 0.12, 1, 1, 1, true);
    tip.position.set(sd * 0.52, 0.5, -0.04);
    g.add(tip);
    g.add(ball(M.cap, 0.26, 1, 1, 1, true));
    tufts.push(g);
  }
  // eyes in orange rings
  const eyes: { g: THREE.Group; inner: THREE.Group }[] = [];
  const smiles: THREE.Mesh[] = [];
  for (const sd of [-1, 1]) {
    const g = new THREE.Group();
    g.position.set(sd * 0.58, 1.86, 1.2);
    g.rotation.y = sd * 0.4;
    bob.add(g);
    g.add(new THREE.Mesh(sh.ring, M.orange));
    const socket = ball(M.socket, 1, 0.5, 0.5, 0.16);
    socket.position.z = -0.02;
    g.add(socket);
    const inner = new THREE.Group();
    inner.position.z = 0.05;
    g.add(inner);
    const iris = ball(M.iris, 0.4, 0.42, 1, 1);
    iris.rotation.y = -Math.PI / 2;
    inner.add(iris);
    const pupil = ball(M.pupil, 0.31, 1, 1, 0.42);
    pupil.position.set(0, 0.03, 0.1);
    inner.add(pupil);
    const h1 = ball(M.white, 0.115, 1, 1, 0.3, true);
    h1.position.set(0.11, 0.14, 0.25);
    inner.add(h1);
    const h2 = ball(M.white, 0.045, 1, 1, 0.3, true);
    h2.position.set(-0.12, -0.1, 0.24);
    inner.add(h2);
    // the happy closed-eye arc (^ ^), shown when the owl smiles
    const arc = new THREE.Mesh(sh.smile, M.pupil);
    arc.position.z = 0.12;
    arc.visible = false;
    g.add(arc);
    smiles.push(arc);
    eyes.push({ g, inner });
  }
  // rosy cheeks
  for (const sd of [-1, 1]) {
    const c = ball(M.cheek, 1, 0.22, 0.13, 0.05);
    c.position.set(sd * 0.86, 1.3, 1.13);
    c.rotation.y = sd * 0.62;
    bob.add(c);
  }
  // beak
  const beak = ball(M.orange, 1, 0.17, 0.24, 0.15);
  beak.position.set(0, 1.5, 1.42);
  beak.rotation.x = 0.25;
  bob.add(beak);
  // cream scalloped chest feathers
  const scallops = new THREE.Group();
  bob.add(scallops);
  const rows: [number, number][] = [
    [1.12, 6],
    [0.86, 7],
    [0.6, 6],
    [0.36, 5],
  ];
  rows.forEach(([y, n], ri) => {
    for (let i = 0; i < n; i++) {
      const x = (i - (n - 1) / 2) * 0.3;
      const dy = y - C.y;
      const zz2 = R * R * 0.94 * 0.94 - x * x - (dy * dy) / (0.98 * 0.98);
      if (zz2 <= 0.1) continue;
      const z = Math.sqrt(zz2);
      const n3 = new THREE.Vector3(x, dy, z).normalize();
      const m = new THREE.Mesh(sh.half, (i + ri) % 3 === 0 ? M.creamDeep : i % 2 ? M.cream : M.creamLight);
      m.position.set(x, y, z).addScaledVector(n3, -0.015);
      m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), n3);
      m.scale.set(0.2, 0.09, 0.16);
      m.rotateX(0.25);
      scallops.add(m);
    }
  });
  // wings: layered, in the agent's colour
  const wings: THREE.Group[] = [];
  for (const sd of [-1, 1]) {
    const g = new THREE.Group();
    g.position.set(sd * 1.22, 1.3, 0.15);
    g.rotation.z = sd * 0.3;
    bob.add(g);
    g.add(ball(M.cap, 1, 0.26, 0.6, 0.42));
    const b = ball(M.capDeep, 1, 0.22, 0.42, 0.36);
    b.position.set(sd * 0.08, -0.38, 0.04);
    b.rotation.z = sd * 0.2;
    g.add(b);
    const c = ball(M.cap, 1, 0.18, 0.3, 0.3);
    c.position.set(sd * 0.13, -0.66, 0.06);
    c.rotation.z = sd * 0.35;
    g.add(c);
    wings.push(g);
  }
  // orange round feet
  for (const sd of [-1, 1])
    for (let k = -1; k <= 1; k++) {
      const t = ball(M.orange, 0.14, 0.9, 0.75, 1.15, true);
      t.position.set(sd * 0.46 + k * 0.17, 0.14, 0.72 + (k === 0 ? 0.06 : 0));
      bob.add(t);
    }

  // ring, thinking dots, soft shadow
  let haloMat: THREE.MeshBasicMaterial | null = null;
  const dots: THREE.Mesh[] = [];
  if (opts.extras !== false) {
    haloMat = track(new THREE.MeshBasicMaterial({ color: rawColor(0xff773c), transparent: true, opacity: 0 }));
    const halo = new THREE.Mesh(sh.halo, haloMat);
    halo.position.set(0, 1.75, -1.3);
    root.add(halo);
    for (let i = 0; i < 3; i++) {
      const d = ball(M.orange, 0.09, 1, 1, 1, true);
      d.position.set(1.55 + i * 0.3, 3.55, 0.2);
      d.visible = false;
      root.add(d);
      dots.push(d);
    }
  }
  if (opts.shadow !== false) {
    const plane = new THREE.Mesh(sh.plane, track(new THREE.MeshBasicMaterial({ map: sh.shadow, transparent: true, depthWrite: false })));
    plane.rotation.x = -Math.PI / 2;
    plane.position.y = 0.01;
    root.add(plane);
  }

  /* ---------------------------------------------------------------- motion */
  const V = { tilt: 0, tuft: 0, lean: 0, open: 1, wide: 1, brow: 0 };
  const look = { x: 0, y: 0 };
  const target = { x: 0, y: 0 };
  let pointer = false;
  let lastPointer = 0;
  let sacc = { x: 0, y: 0 };
  let nextSacc = 0;
  let blinkT = 2;
  let ringOp = 0;

  const pose = (mood: OwlMood, m: MoodTargets, t: number, breathe: boolean, lid: number) => {
    const br = breathe ? Math.sin(t * 2.1) * 0.012 : 0;
    bob.scale.set(1 + br, 1 - br, 1 + br);
    bob.position.y = m.hop;
    bob.position.z = V.lean * 0.4;
    owl.rotation.y = look.x * 0.38;
    owl.rotation.x = -look.y * 0.06;
    owl.rotation.z = V.tilt + m.sway;
    eyes.forEach((e, i) => {
      e.inner.visible = !m.happy;
      smiles[i].visible = m.happy;
      e.inner.scale.set(V.wide, lid * V.wide, 1);
      e.inner.position.x = look.x * 0.07;
      e.inner.position.y = look.y * 0.06;
    });
    brows.forEach((b) => {
      b.position.y = 2.4 + V.brow;
    });
    tufts.forEach((g, i) => {
      const sd = i ? 1 : -1;
      g.rotation.z = sd * V.tuft + (mood === "listening" && breathe ? sd * 0.05 * Math.sin(t * 8) : 0);
    });
    wings.forEach((g, i) => {
      const sd = i ? 1 : -1;
      g.rotation.z = sd * (0.3 + (mood === "answering" ? 0.1 * Math.max(0, Math.sin(t * 6)) : 0));
    });
    dots.forEach((d, i) => {
      d.visible = mood === "thinking";
      d.position.y = 3.55 + (breathe ? Math.max(0, Math.sin(t * 5 - i * 0.7)) * 0.18 : 0);
    });
    if (haloMat) haloMat.opacity = ringOp;
  };

  return {
    root,
    setLook(x, y = 0) {
      if (x === null) {
        pointer = false;
        return;
      }
      target.x = Math.max(-1, Math.min(1, x));
      target.y = Math.max(-1, Math.min(1, y));
      pointer = true;
      lastPointer = performance.now();
    },
    update(mood, t, dt) {
      const m = moodTargets(mood, t);
      const k = 1 - Math.pow(0.001, dt);
      V.tilt = lerp(V.tilt, m.tilt, k);
      V.tuft = lerp(V.tuft, m.tuft, k);
      V.lean = lerp(V.lean, m.lean, k);
      V.open = lerp(V.open, m.open, k);
      V.wide = lerp(V.wide, m.wide, k);
      V.brow = lerp(V.brow, m.brow, k);
      ringOp = lerp(ringOp, m.ringOp, k);
      // gaze: the pointer, else a glance around every second or two
      if (!pointer || performance.now() - lastPointer > 2500) {
        if (t > nextSacc) {
          sacc = { x: (Math.random() * 2 - 1) * 0.6, y: (Math.random() * 2 - 1) * 0.35 };
          nextSacc = t + 1.2 + Math.random() * 2.2;
        }
        target.x = sacc.x;
        target.y = sacc.y;
      }
      let gx = target.x;
      let gy = target.y;
      if (m.gaze === "up") {
        gx = Math.sin(t * 1.6) * 0.5;
        gy = 0.8;
      }
      if (m.gaze === "down") {
        gx *= 0.2;
        gy = -0.4;
      }
      const kl = 1 - Math.pow(0.02, dt);
      look.x = lerp(look.x, gx, kl);
      look.y = lerp(look.y, gy, kl);
      // blink
      blinkT -= dt;
      let lid = V.open;
      if (blinkT < 0) {
        const ph = -blinkT;
        lid = ph < 0.07 ? lerp(V.open, 0.06, ph / 0.07) : ph < 0.16 ? lerp(0.06, V.open, (ph - 0.07) / 0.09) : V.open;
        if (ph > 0.16) blinkT = 2.4 + Math.random() * 3.6;
      }
      pose(mood, m, t, true, lid);
    },
    snap(mood) {
      const m = moodTargets(mood, 0.5);
      Object.assign(V, { tilt: m.tilt, tuft: m.tuft, lean: m.lean, open: m.open, wide: m.wide, brow: m.brow });
      ringOp = m.ringOp;
      look.x = look.y = 0;
      target.x = target.y = 0;
      if (m.gaze === "up") look.y = 0.8;
      if (m.gaze === "down") look.y = -0.4;
      pose(mood, m, 0.5, false, V.open);
    },
    dispose() {
      for (const m of mats) m.dispose();
      mats.length = 0;
      release(detail);
    },
  };
}
