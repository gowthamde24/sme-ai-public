/**
 * One seated, animated person, built procedurally from three.js primitives (no models, no textures).
 * Invented people only: nobody here is modelled on a real person.
 *
 * Anatomy: believable proportions (see anatomy.ts), a head with jaw, cheekbones, brow, nose, lips,
 * ears, eyes with whites / irises / pupils / highlights and blinking lids, brows, hair with volume,
 * shaped collars and sleeves, hands with four fingers (three joints each) and a thumb. The hands
 * rest on a laptop keyboard: fingertips are solved onto the key tops, the laptop sits at a believable
 * desk distance and its screen leans toward the face.
 */
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import {
  BODY,
  CURL_SHAPE,
  FINGERS,
  HAND_PITCH,
  HAND_YAW,
  KEYBOARD_Z,
  LAPTOP,
  THUMB,
  WRIST,
  clamp,
  fingerTip,
  smoothstep,
  solveArm,
  solveCurl,
  solveThumbCurl,
  type Build,
  type V3,
} from "./anatomy";
import {
  FACE,
  makeBeardGeometry,
  makeCapsuleZ,
  makeChairGeometry,
  makeEllipsoid,
  makeHairGeometry,
  makeHeadGeometry,
  makeLimbGeometry,
  makeTorsoGeometry,
  surfaceZ,
  torsoFront,
  type Detail,
  type HairStyle,
} from "./geo";
import { TABLE_HEIGHT } from "./seats";

export interface CharacterSpec {
  build: Build;
  skin: string;
  hair: string;
  hairStyle: HairStyle;
  beard?: "stubble" | "beard";
  eye: string;
  top: string;
  /** A second cloth colour: lapels, cardigan edge, cuffs. */
  trim: string;
  bottom: string;
  outfit: "blazer" | "crew" | "collar" | "cardigan";
  /** Tie / scarf / pocket accent. */
  accent?: string;
  glasses?: boolean;
  watch?: boolean;
  /** Fraction of the forearm covered by the sleeve (1 = long sleeves, 0.55 = rolled up). */
  sleeve: number;
  /** Overall size (the main agent is a little larger). */
  size?: number;
}

export interface PoseParams {
  /** 0..1: how busy the hands are. */
  typing: number;
  speaking: boolean;
  /** Where the head wants to point, as radians away from straight ahead (already clamped by the caller). */
  headYaw: number;
  /** A still pose: nothing moves. */
  reduced: boolean;
}

const UP = new THREE.Vector3(0, 1, 0);
const v3 = (a: V3) => new THREE.Vector3(a[0], a[1], a[2]);

/** Stretch a unit-height (+y) mesh so it runs from a to b. */
function placeBetween(m: THREE.Object3D, a: THREE.Vector3, b: THREE.Vector3) {
  const d = new THREE.Vector3().subVectors(b, a);
  const l = d.length();
  m.position.copy(a).addScaledVector(d, 0.5);
  m.quaternion.setFromUnitVectors(UP, d.normalize());
  m.scale.set(1, l, 1);
}

/* ------------------------------------------------------------------ the hand */
interface FingerRig {
  joints: [THREE.Object3D, THREE.Object3D, THREE.Object3D];
  /** Curl amount that rests the tip on the key tops. */
  rest: number;
  tipRadius: number;
  tipLength: number;
  /** Low detail only: the single segment's resting angle. */
  alpha: number;
}
export interface HandRig {
  group: THREE.Group;
  fingers: FingerRig[];
  thumb: FingerRig;
}

function buildHand(skin: THREE.Material, nail: THREE.Material | null, detail: Detail): HandRig {
  const group = new THREE.Group();
  const mesh = (g: THREE.BufferGeometry, m: THREE.Material) => {
    const o = new THREE.Mesh(g, m);
    return o;
  };

  // the palm, the wrist and the pad at the base of the thumb
  const palm = mesh(makeEllipsoid(0.044, 0.0135, 0.05, detail), skin);
  palm.position.set(0, 0, 0.05);
  group.add(palm);
  const wrist = mesh(makeEllipsoid(0.03, 0.013, 0.03, detail), skin);
  wrist.position.set(0, -0.001, 0.004);
  group.add(wrist);
  const thenar = mesh(makeEllipsoid(0.017, 0.012, 0.034, detail), skin);
  thenar.position.set(0.027, -0.005, 0.03);
  thenar.rotation.y = 0.35;
  group.add(thenar);

  const chain = (
    origin: V3,
    yaw: number,
    lengths: [number, number, number],
    radii: [number, number, number],
    withNail: boolean,
    low: { len: number; alpha: number } | null,
  ): FingerRig => {
    const base = new THREE.Group();
    base.position.set(origin[0], origin[1], origin[2]);
    base.rotation.order = "YXZ";
    base.rotation.y = yaw;
    group.add(base);
    if (low) {
      // low detail: a single capsule from the knuckle to the resting tip
      base.add(mesh(makeCapsuleZ(radii[1], low.len, detail), skin));
      return { joints: [base, base, base], rest: 0, tipRadius: radii[1], tipLength: low.len, alpha: low.alpha };
    }
    const joints: THREE.Object3D[] = [base];
    let parent: THREE.Object3D = base;
    for (let j = 0; j < 3; j++) {
      const seg = mesh(makeCapsuleZ(radii[j], lengths[j], detail), skin);
      parent.add(seg);
      if (j === 2 && withNail && nail) {
        const n = mesh(makeEllipsoid(radii[2] * 0.62, 0.0013, lengths[2] * 0.36, detail), nail);
        n.position.set(0, radii[2] * 0.92, lengths[2] * 0.62);
        n.rotation.x = -0.12;
        seg.add(n);
      }
      if (j < 2) {
        const next = new THREE.Group();
        next.position.set(0, 0, lengths[j]);
        parent.add(next);
        joints.push(next);
        parent = next;
      }
    }
    return { joints: joints as FingerRig["joints"], rest: 0, tipRadius: radii[2], tipLength: lengths[2], alpha: 0 };
  };

  const fingers = FINGERS.map((f) => {
    const rest = solveCurl(f);
    let low: { len: number; alpha: number } | null = null;
    if (detail === "low") {
      const tip = fingerTip(f, rest);
      low = { len: Math.hypot(tip.y, tip.z - f.z), alpha: Math.atan2(-tip.y, tip.z - f.z) };
    }
    const rig = chain([f.x, 0, f.z], f.yaw, f.lengths, f.radii, true, low);
    rig.rest = rest;
    return rig;
  });
  const thumbRest = solveThumbCurl();
  let thumbLow: { len: number; alpha: number } | null = null;
  if (detail === "low") {
    const tip = fingerTip({ lengths: THUMB.lengths, radii: THUMB.radii, z: THUMB.base[2] }, thumbRest);
    thumbLow = { len: Math.hypot(tip.y, tip.z - THUMB.base[2]), alpha: Math.atan2(-tip.y, tip.z - THUMB.base[2]) };
  }
  const thumb = chain(THUMB.base, THUMB.yaw, THUMB.lengths, THUMB.radii, true, thumbLow);
  thumb.rest = thumbRest;
  return { group, fingers, thumb };
}

/** Set a finger's joint angles from a curl amount (all joints bend about their x axis, positive = down). */
function curlFinger(rig: FingerRig, s: number) {
  if (rig.joints[1] === rig.joints[0]) {
    rig.joints[0].rotation.x = rig.alpha + (s - rig.rest) * 1.6; // low detail: one segment
    return;
  }
  rig.joints[0].rotation.x = CURL_SHAPE[0] * s;
  rig.joints[1].rotation.x = CURL_SHAPE[1] * s;
  rig.joints[2].rotation.x = CURL_SHAPE[2] * s;
}

/* ------------------------------------------------------------------- laptop */
function buildLaptop(): { group: THREE.Group; screen: THREE.MeshStandardMaterial; dispose: () => void } {
  const group = new THREE.Group();
  group.position.set(0, TABLE_HEIGHT, LAPTOP.z);
  const metal = new THREE.MeshStandardMaterial({ color: "#aeb0b3", roughness: 0.38, metalness: 0.7 });
  const dark = new THREE.MeshStandardMaterial({ color: "#26272b", roughness: 0.55 });
  const screen = new THREE.MeshStandardMaterial({ color: "#14151a", emissive: "#ff9a5c", emissiveIntensity: 0.3, roughness: 0.25 });

  const base = new THREE.Mesh(new THREE.BoxGeometry(LAPTOP.width, LAPTOP.base, LAPTOP.depth), metal);
  base.position.y = LAPTOP.base / 2;
  base.castShadow = true;
  group.add(base);

  // keys: a block of small keys merged into one mesh
  const keys: THREE.BufferGeometry[] = [];
  const rows = 5;
  const cols = 13;
  const zFront = KEYBOARD_Z[0] - LAPTOP.z + 0.008;
  const zBack = KEYBOARD_Z[1] - LAPTOP.z - 0.004;
  const pitchZ = (zBack - zFront) / rows;
  const pitchX = (LAPTOP.width - 0.03) / cols;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (r === rows - 1 && (c < 3 || c > 9)) continue; // the space bar row is shorter
      const wide = r === rows - 1 && c === 3;
      const k = new THREE.BoxGeometry(wide ? pitchX * 6.5 : pitchX * 0.86, LAPTOP.keyH, pitchZ * 0.82);
      k.translate(
        wide ? -(LAPTOP.width - 0.03) / 2 + pitchX * (c + 3.2) : -(LAPTOP.width - 0.03) / 2 + pitchX * (c + 0.5),
        LAPTOP.base + LAPTOP.keyH / 2,
        zFront + pitchZ * (r + 0.5),
      );
      keys.push(k);
      if (wide) c += 6;
    }
  }
  const keyMesh = new THREE.Mesh(mergeGeometries(keys, false)!, dark);
  group.add(keyMesh);
  const pad = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.0015, 0.055), new THREE.MeshStandardMaterial({ color: "#9a9ca0", roughness: 0.3, metalness: 0.5 }));
  pad.position.set(0, LAPTOP.base + 0.0008, -LAPTOP.depth / 2 + 0.032);
  group.add(pad);

  // the lid hinges at the back and leans toward the person's face
  const hinge = new THREE.Group();
  hinge.position.set(0, LAPTOP.base, LAPTOP.depth / 2);
  hinge.rotation.x = LAPTOP.screenTilt;
  const lid = new THREE.Mesh(new THREE.BoxGeometry(LAPTOP.width, LAPTOP.screenH, 0.008), metal);
  lid.position.set(0, LAPTOP.screenH / 2, 0);
  lid.castShadow = true;
  hinge.add(lid);
  const face = new THREE.Mesh(new THREE.PlaneGeometry(LAPTOP.width - 0.016, LAPTOP.screenH - 0.016), screen);
  face.position.set(0, LAPTOP.screenH / 2, -0.0042);
  face.rotation.y = Math.PI; // the glowing side faces the person (-z)
  hinge.add(face);
  group.add(hinge);
  return {
    group,
    screen,
    dispose: () => {
      metal.dispose();
      dark.dispose();
      screen.dispose();
      pad.material.dispose();
    },
  };
}

/* ---------------------------------------------------------------- character */
export class Character {
  readonly root = new THREE.Group();
  readonly detail: Detail;
  readonly spec: CharacterSpec;
  readonly hands: [HandRig, HandRig]; // person's LEFT (+x) then RIGHT (-x)
  private readonly mats: THREE.Material[] = [];
  private readonly size: number;

  // animated parts
  private readonly torso: THREE.Mesh;
  private readonly deltoids: THREE.Mesh[] = [];
  private readonly headPivot = new THREE.Group();
  private readonly lids: THREE.Mesh[] = [];
  private readonly eyes: THREE.Group[] = [];
  private lowerLip: THREE.Mesh | null = null;
  private lipBaseY = 0;
  private readonly upperArm: THREE.Mesh[] = [];
  private readonly foreArm: THREE.Group[] = [];
  private readonly elbows: THREE.Mesh[] = [];
  private readonly handMounts: THREE.Group[] = [];
  private readonly screen: THREE.MeshStandardMaterial;
  private readonly disposeLaptop: () => void;
  private readonly shoulderBase: THREE.Vector3[];
  private readonly phase: number;

  // animation state
  private typing = 0;
  private headYaw = 0;
  private headPitch = 0;
  private nextBlink = 1.5;
  private blinkAt = -10;
  private nextSaccade = 1;
  private gaze = { x: 0, y: 0 };
  private gazeTarget = { x: 0, y: 0 };
  private mouthOpen = 0;

  constructor(spec: CharacterSpec, detail: Detail, seed = 0) {
    this.spec = spec;
    this.detail = detail;
    this.size = spec.size ?? 1;
    this.phase = seed * 1.7;
    const hi = detail === "high";
    const mid = detail !== "low";
    const b = spec.build;

    const std = (color: string | THREE.Color, o: THREE.MeshStandardMaterialParameters = {}) => {
      const m = new THREE.MeshStandardMaterial({ color, roughness: 0.8, ...o });
      this.mats.push(m);
      return m;
    };
    const skinColor = new THREE.Color(spec.skin);
    const lift = skinColor.clone().multiplyScalar(0.05); // a hint of light bleeding through skin in shade
    const skin = std(skinColor, { roughness: 0.58, emissive: lift });
    // the nose is a separate mesh: tint it like the shaded head so there is no visible seam
    const noseMat = std(skinColor.clone().lerp(new THREE.Color("#c4505a"), 0.06).multiplyScalar(0.94), { roughness: 0.56, emissive: lift });
    const headMat = std("#ffffff", { roughness: 0.56, vertexColors: true, emissive: lift });
    const hairColor = new THREE.Color(spec.hair);
    const hair = hi
      ? (() => {
          const m = new THREE.MeshPhysicalMaterial({ color: hairColor, roughness: 0.6, sheen: 1, sheenRoughness: 0.45, sheenColor: hairColor.clone().lerp(new THREE.Color("#ffffff"), 0.4), vertexColors: true, side: THREE.DoubleSide });
          this.mats.push(m);
          return m;
        })()
      : std(hairColor, { roughness: 0.75, vertexColors: true, side: THREE.DoubleSide });
    const cloth = std(spec.top, { roughness: 0.88 });
    const trim = std(spec.trim, { roughness: 0.85 });
    const bottom = std(spec.bottom, { roughness: 0.85 });
    const accent = std(spec.accent ?? spec.trim, { roughness: 0.6 });
    const shoe = std("#1d1b1b", { roughness: 0.5 });
    const chairMat = std("#37353a", { roughness: 0.7 });
    const white = std("#f6f2ee", { roughness: 0.22 });
    const nail = hi ? std(skinColor.clone().lerp(new THREE.Color("#f5d5cf"), 0.55), { roughness: 0.3 }) : null;
    const lipColor = skinColor.clone().lerp(new THREE.Color("#a34650"), spec.build === "f" ? 0.5 : 0.34);
    const lips = std(lipColor, { roughness: 0.4 });
    const dark = std("#1e1e24", { roughness: 0.4 });
    const metal = std("#2b2b30", { roughness: 0.35, metalness: 0.6 });

    const add = (parent: THREE.Object3D, g: THREE.BufferGeometry, m: THREE.Material, p?: V3, cast = false) => {
      const o = new THREE.Mesh(g, m);
      if (p) o.position.set(p[0], p[1], p[2]);
      o.castShadow = cast;
      parent.add(o);
      return o;
    };
    const between = (parent: THREE.Object3D, a: V3, c: V3, r: number, m: THREE.Material, cast = false) => {
      const o = new THREE.Mesh(makeLimbGeometry(r, r, detail), m);
      placeBetween(o, v3(a), v3(c));
      o.castShadow = cast;
      parent.add(o);
      return o;
    };

    /* chair and legs */
    add(this.root, makeChairGeometry(), chairMat, undefined, true);
    for (const sx of [-1, 1]) {
      const th = add(this.root, makeCapsuleZ(0.072, 0.3, detail), bottom, [sx * 0.095, 0.53, -0.06], true);
      th.rotation.x = -0.02;
      const shin = add(this.root, makeCapsuleZ(0.051, 0.34, detail), bottom, [sx * 0.098, 0.5, 0.385], true);
      shin.rotation.x = Math.PI / 2 - 0.1;
      const foot = add(this.root, makeEllipsoid(0.05, 0.042, 0.12, detail), shoe, [sx * 0.1, 0.055, 0.5]);
      foot.rotation.x = 0.04;
    }

    /* torso, neck, shoulders */
    this.torso = add(this.root, makeTorsoGeometry(b, detail), cloth, undefined, true);
    const neck = new THREE.Mesh(makeLimbGeometry(0.047, 0.058, detail), skin);
    placeBetween(neck, new THREE.Vector3(0, 1.06, -0.004), new THREE.Vector3(0, 1.225, 0.03));
    this.root.add(neck);
    const sx0 = BODY.shoulderX[b];
    this.shoulderBase = [new THREE.Vector3(sx0, BODY.shoulderY, 0), new THREE.Vector3(-sx0, BODY.shoulderY, 0)];
    for (const sx of [1, -1]) {
      const d = add(this.root, makeEllipsoid(0.058, 0.062, 0.058, detail), cloth, [sx * sx0, BODY.shoulderY - 0.012, 0], true);
      this.deltoids.push(d);
    }

    /* clothing details: collars, lapels, tie, cardigan edge */
    const zN = 0.014;
    if (spec.outfit === "crew" || spec.outfit === "cardigan") {
      const neck = new THREE.Mesh(new THREE.TorusGeometry(0.058, 0.0115, 8, hi ? 28 : 16), spec.outfit === "cardigan" ? std("#efe6da") : trim);
      neck.rotation.x = Math.PI / 2 - 0.12;
      neck.position.set(0, 1.093, zN);
      this.root.add(neck);
    }
    if (spec.outfit === "collar" || spec.outfit === "blazer") {
      const band = new THREE.Mesh(new THREE.TorusGeometry(0.058, 0.01, 8, 20), spec.outfit === "blazer" ? std("#f3efe9") : trim);
      band.rotation.x = Math.PI / 2 - 0.12;
      band.position.set(0, 1.096, zN);
      this.root.add(band);
      for (const s of [-1, 1]) {
        const flap = new THREE.Mesh(new THREE.BoxGeometry(0.052, 0.003, 0.05), spec.outfit === "blazer" ? std("#f3efe9") : trim);
        flap.position.set(s * 0.034, 1.083, zN + 0.052);
        flap.rotation.set(0.85, s * -0.38, s * -0.42);
        this.root.add(flap);
      }
    }
    if (spec.outfit === "blazer") {
      const zf = (y: number) => torsoFront(y, b);
      // the shirt showing in the V, then the lapels, then a tie
      const vShape = new THREE.Shape();
      vShape.moveTo(-0.055, 1.07);
      vShape.lineTo(0.055, 1.07);
      vShape.lineTo(0.0, 0.84);
      const vMesh = new THREE.Mesh(new THREE.ShapeGeometry(vShape), std("#f3efe9"));
      vMesh.position.set(0, 0, zf(0.95) + 0.004);
      this.root.add(vMesh);
      for (const s of [-1, 1]) {
        const lapel = new THREE.Mesh(new THREE.BoxGeometry(0.052, 0.27, 0.006), trim);
        lapel.position.set(s * 0.082, 0.95, zf(0.95) + 0.001);
        lapel.rotation.z = s * 0.2;
        lapel.rotation.y = s * -0.35;
        this.root.add(lapel);
      }
      const tie = new THREE.Shape();
      tie.moveTo(-0.014, 1.06);
      tie.lineTo(0.014, 1.06);
      tie.lineTo(0.02, 0.92);
      tie.lineTo(0.0, 0.84);
      tie.lineTo(-0.02, 0.92);
      const tieMesh = new THREE.Mesh(new THREE.ShapeGeometry(tie), accent);
      tieMesh.position.set(0, 0, zf(0.95) + 0.0075);
      this.root.add(tieMesh);
    }
    if (spec.outfit === "cardigan") {
      for (const s of [-1, 1]) {
        const edge = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.4, 0.007), trim);
        edge.position.set(s * 0.034, 0.87, torsoFront(0.87, b) + 0.003);
        edge.rotation.z = s * -0.05;
        this.root.add(edge);
      }
      const inner = new THREE.Mesh(new THREE.PlaneGeometry(0.06, 0.4), std("#efe6da"));
      inner.position.set(0, 0.87, torsoFront(0.87, b) + 0.001);
      this.root.add(inner);
    }

    /* the laptop */
    const laptop = buildLaptop();
    this.screen = laptop.screen;
    this.disposeLaptop = laptop.dispose;
    this.root.add(laptop.group);
    // soft light on the table from the screen and a contact shadow under the laptop are added by the scene

    /* head */
    this.headPivot.position.set(0, 1.165, 0.012);
    this.root.add(this.headPivot);
    const head = new THREE.Group();
    head.position.set(0, BODY.headCenter[1] - 1.165, BODY.headCenter[2] - 0.012);
    this.headPivot.add(head);
    add(head, makeHeadGeometry(b, detail, skinColor), headMat, undefined, true);

    const hairParts = makeHairGeometry(spec.hairStyle, b, detail);
    add(head, hairParts.main, hair, undefined, true);
    for (const e of hairParts.extra) add(head, e, hair, undefined, true);
    if (spec.beard) {
      const beardMat = std(spec.beard === "stubble" ? new THREE.Color(spec.hair).lerp(skinColor, 0.6) : spec.hair, { roughness: 0.85, vertexColors: true, side: THREE.DoubleSide });
      add(head, makeBeardGeometry(b, detail, spec.beard === "stubble" ? 0.0018 : 0.0075), beardMat);
    }

    // ears
    for (const s of [-1, 1]) {
      const ear = add(head, makeEllipsoid(0.0072, 0.026, 0.0175, detail), skin, [s * 0.0765, -0.006, -0.012]);
      ear.rotation.y = s * 0.38;
    }

    // eyes: ball, iris with a darker rim, pupil, a catch-light, and lids that blink
    const irisCol = new THREE.Color(spec.eye);
    const irisMat = std(irisCol, { roughness: 0.3 });
    const rimMat = std(irisCol.clone().multiplyScalar(0.45), { roughness: 0.4 });
    const light = std("#ffffff", { roughness: 0.1, emissive: new THREE.Color("#ffffff"), emissiveIntensity: 1 });
    for (const s of [-1, 1]) {
      const ex = s * FACE.eyeX;
      const ez = surfaceZ(ex, FACE.eyeY, b) - 0.0092;
      const eye = new THREE.Group();
      eye.position.set(ex, FACE.eyeY, ez);
      eye.rotation.y = s * 0.07;
      head.add(eye);
      if (mid) {
        const ballGroup = new THREE.Group();
        eye.add(ballGroup);
        this.eyes.push(ballGroup);
        add(ballGroup, makeEllipsoid(0.0142, 0.0142, 0.0142, detail), white);
        const iris = add(ballGroup, new THREE.CircleGeometry(0.0079, hi ? 28 : 16), irisMat, [0, 0, 0.0145]);
        iris.renderOrder = 1;
        if (hi) add(ballGroup, new THREE.RingGeometry(0.0066, 0.008, 28), rimMat, [0, 0, 0.01455]);
        add(ballGroup, new THREE.CircleGeometry(0.0036, hi ? 18 : 12), dark, [0, 0, 0.01465]);
        add(ballGroup, makeEllipsoid(0.002, 0.002, 0.0013, detail), light, [0.0032, 0.004, 0.0148]);
        // upper and lower lids: skin domes around the eyeball
        const upper = new THREE.Mesh(new THREE.SphereGeometry(0.0152, hi ? 20 : 12, hi ? 12 : 8, 0, Math.PI * 2, 0, Math.PI / 2), skin);
        upper.rotation.x = 0.0;
        eye.add(upper);
        this.lids.push(upper);
        if (hi) {
          const lower = new THREE.Mesh(new THREE.SphereGeometry(0.015, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), skin);
          lower.rotation.x = Math.PI - 0.2;
          eye.add(lower);
        }
      } else {
        add(eye, makeEllipsoid(0.0105, 0.0105, 0.0105, detail), dark, [0, 0, 0.002]);
      }
    }

    // brows
    if (mid) {
      const browMat = std(new THREE.Color(spec.hair).lerp(new THREE.Color("#1a1412"), 0.25), { roughness: 0.8 });
      for (const s of [-1, 1]) {
        const pts: THREE.Vector3[] = [];
        for (let i = 0; i <= 4; i++) {
          const t = i / 4;
          const x = s * (0.013 + 0.046 * t);
          const y = FACE.browY + 0.008 * Math.sin(Math.PI * t * 0.9) - 0.006 * t * t + (b === "m" ? -0.002 : 0.002);
          pts.push(new THREE.Vector3(x, y, surfaceZ(x, y, b) + 0.0025));
        }
        const tube = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 12, b === "m" ? 0.0038 : 0.0029, 6);
        add(head, tube, browMat);
      }
    }

    // nose: a bridge that widens into the tip, with wings and nostrils
    const zn = (y: number) => surfaceZ(0, y, b);
    const bridge = add(head, makeEllipsoid(0.0092, 0.017, 0.0105, detail), noseMat, [0, -0.006, zn(-0.006) + 0.0032]);
    bridge.rotation.x = 0.4;
    add(head, makeEllipsoid(0.0118, 0.0105, 0.0125, detail), noseMat, [0, FACE.noseTipY, zn(FACE.noseTipY) + 0.0072]);
    for (const s of [-1, 1]) {
      add(head, makeEllipsoid(0.0078, 0.0072, 0.0082, detail), noseMat, [s * 0.0128, FACE.noseTipY - 0.0025, zn(FACE.noseTipY) + 0.0028]);
      if (hi) add(head, makeEllipsoid(0.003, 0.0017, 0.0026, detail), dark, [s * 0.0062, FACE.noseTipY - 0.0108, zn(FACE.noseTipY) + 0.0066]);
    }

    // mouth: upper lip, lower lip (opens when speaking), and the line between them with a hint of a smile
    if (mid) {
      const zm = (y: number) => surfaceZ(0, y, b);
      const upperLip = add(head, makeEllipsoid(0.0188, 0.0036, 0.0056, detail), lips, [0, FACE.mouthY + 0.0032, zm(FACE.mouthY) + 0.0024]);
      upperLip.rotation.x = 0.12;
      const lower = add(head, makeEllipsoid(0.0165, 0.0046, 0.0064, detail), lips, [0, FACE.mouthY - 0.005, zm(FACE.mouthY) + 0.0022]);
      this.lowerLip = lower;
      this.lipBaseY = lower.position.y;
      const curve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(-0.0205, FACE.mouthY + 0.0022, surfaceZ(-0.0205, FACE.mouthY, b) + 0.003),
        new THREE.Vector3(0, FACE.mouthY - 0.0006, zm(FACE.mouthY) + 0.0048),
        new THREE.Vector3(0.0205, FACE.mouthY + 0.0022, surfaceZ(0.0205, FACE.mouthY, b) + 0.003),
      ]);
      add(head, new THREE.TubeGeometry(curve, 10, 0.0011, 5), std(lipColor.clone().multiplyScalar(0.4), { roughness: 0.5 }));
    }

    // glasses
    if (spec.glasses) {
      const zEye = (x: number) => surfaceZ(x, FACE.eyeY, b) + 0.0125;
      for (const s of [-1, 1]) {
        const rim = new THREE.Mesh(new THREE.TorusGeometry(0.0172, 0.0017, 6, hi ? 28 : 14), metal);
        rim.position.set(s * FACE.eyeX, FACE.eyeY - 0.0005, zEye(s * FACE.eyeX));
        rim.rotation.y = s * 0.1;
        head.add(rim);
        between(head, [s * 0.0555, FACE.eyeY + 0.003, zEye(s * 0.0555)], [s * 0.0775, FACE.eyeY - 0.004, -0.018], 0.0014, metal);
      }
      between(head, [-0.0172 + 0.0, FACE.eyeY + 0.006, zEye(0)], [0.0172, FACE.eyeY + 0.006, zEye(0)], 0.0014, metal);
    }

    /* arms and hands */
    const upperGeo = makeLimbGeometry(0.041, 0.048, detail);
    const foreR0 = 0.04;
    const foreR1 = 0.031;
    const r = (t: number) => foreR0 + (foreR1 - foreR0) * t;
    const f = clamp(spec.sleeve, 0.3, 1);
    const sleeveGeo = makeLimbGeometry(r(f), r(0), detail, hi ? 0.03 : 0);
    const skinForeGeo = makeLimbGeometry(r(1), r(f) - 0.0005, detail);
    this.hands = [buildHand(skin, nail, detail), buildHand(skin, nail, detail)];
    for (let i = 0; i < 2; i++) {
      const sideSign = i === 0 ? 1 : -1;
      const ua = new THREE.Mesh(upperGeo, cloth);
      ua.castShadow = true;
      this.root.add(ua);
      this.upperArm.push(ua);

      const fa = new THREE.Group();
      const L = BODY.forearm;
      const sleeve = new THREE.Mesh(sleeveGeo, cloth);
      sleeve.scale.y = f * L;
      sleeve.position.y = (f * L) / 2;
      sleeve.castShadow = true;
      fa.add(sleeve);
      const bare = new THREE.Mesh(skinForeGeo, skin);
      bare.scale.y = (1 - f) * L;
      bare.position.y = f * L + ((1 - f) * L) / 2;
      fa.add(bare);
      const cuff = new THREE.Mesh(new THREE.TorusGeometry(r(f) + 0.002, 0.0042, 6, 16), trim);
      cuff.rotation.x = Math.PI / 2;
      cuff.position.y = f * L;
      fa.add(cuff);
      if (spec.watch && i === 0) {
        const strap = new THREE.Mesh(new THREE.TorusGeometry(r(0.93) + 0.002, 0.0042, 6, 16), metal);
        strap.rotation.x = Math.PI / 2;
        strap.position.y = 0.9 * L;
        fa.add(strap);
        const dial = new THREE.Mesh(new THREE.CylinderGeometry(0.0155, 0.0155, 0.006, 16), metal);
        dial.position.set(0, 0.9 * L, r(0.93) + 0.003);
        dial.rotation.x = Math.PI / 2;
        fa.add(dial);
      }
      this.root.add(fa);
      this.foreArm.push(fa);

      const elbow = new THREE.Mesh(makeEllipsoid(0.044, 0.044, 0.044, detail), cloth);
      elbow.castShadow = true;
      this.root.add(elbow);
      this.elbows.push(elbow);

      // the hand: positioned at the wrist, pitched toward the keys, angled in; the right hand is a mirror
      const mount = new THREE.Group();
      mount.rotation.order = "YXZ";
      mount.rotation.x = HAND_PITCH;
      mount.rotation.y = -sideSign * HAND_YAW;
      const mirror = new THREE.Group();
      if (i === 0) mirror.scale.x = -1; // thumb toward the middle: hand rig is built as the right hand
      mirror.add(this.hands[i].group);
      mount.add(mirror);
      this.root.add(mount);
      this.handMounts.push(mount);
    }
    // (the hand rig is built as a right hand, thumb toward +x; the person's left hand, i = 0, is its mirror)

    this.root.scale.setScalar(this.size);
    this.update(0, 0, { typing: 0, speaking: false, headYaw: 0, reduced: true });
  }

  /** Advance the animation. `t` is seconds since start, `dt` seconds since the last frame. */
  update(t: number, dt: number, p: PoseParams) {
    const still = p.reduced;
    const ph = this.phase;
    const k = Math.min(1, dt * 6);

    // typing amount eases toward its target
    this.typing += ((still ? 0 : p.typing) - this.typing) * k;
    const typing = this.typing;

    // breathing: the chest and shoulders rise a few millimetres
    const breath = still ? 0 : Math.sin(t * 1.55 + ph);
    this.torso.scale.set(1 + 0.007 * breath, 1 + 0.004 * breath, 1 + 0.012 * breath);

    // head: eased toward the wanted turn, plus a slow idle drift
    const drift = still ? 0 : Math.sin(t * 0.31 + ph) * 0.09 + Math.sin(t * 0.17 + ph * 2) * 0.05;
    const wantYaw = clamp(p.headYaw + drift, -1.15, 1.15);
    const wantPitch = still ? 0.04 : 0.04 + Math.sin(t * 0.23 + ph) * 0.03 + (p.speaking ? Math.sin(t * 5.2) * 0.035 : 0);
    this.headYaw += (wantYaw - this.headYaw) * Math.min(1, dt * 3.5);
    this.headPitch += (wantPitch - this.headPitch) * Math.min(1, dt * 4);
    this.headPivot.rotation.set(this.headPitch, this.headYaw, 0, "YXZ");
    this.headPivot.position.y = 1.165 + 0.0025 * breath;

    // blinking and eye movement
    if (!still) {
      if (t > this.nextBlink) {
        this.blinkAt = t;
        this.nextBlink = t + 2.2 + ((Math.sin(t * 91.7 + ph) + 1) / 2) * 3.8;
      }
      if (t > this.nextSaccade) {
        this.gazeTarget.x = Math.sin(t * 53.1 + ph) * 0.1;
        this.gazeTarget.y = Math.sin(t * 37.7 + ph) * 0.05;
        this.nextSaccade = t + 0.9 + ((Math.sin(t * 17.3 + ph) + 1) / 2) * 2.2;
      }
      this.gaze.x += (this.gazeTarget.x - this.gaze.x) * Math.min(1, dt * 14);
      this.gaze.y += (this.gazeTarget.y - this.gaze.y) * Math.min(1, dt * 14);
    }
    const since = t - this.blinkAt;
    const blink = since >= 0 && since < 0.16 ? Math.sin((since / 0.16) * Math.PI) : 0;
    for (const lid of this.lids) lid.rotation.x = 0.0 + 1.52 * blink;
    for (const e of this.eyes) {
      e.rotation.y = this.gaze.x;
      e.rotation.x = -this.gaze.y;
    }
    if (this.lowerLip) {
      const target = p.speaking && !still ? (0.5 + 0.5 * Math.sin(t * 13 + ph)) * 0.65 : 0;
      this.mouthOpen += (target - this.mouthOpen) * Math.min(1, dt * 18);
      this.lowerLip.position.y = this.lipBaseY - this.mouthOpen * 0.0065;
    }

    // screen glow follows how busy the person is
    this.screen.emissiveIntensity = 0.3 + typing * 0.7 + (still ? 0 : Math.sin(t * 2 + ph) * 0.03);

    // arms: two-bone IK from shoulder to wrist; the elbow sits down and a little out
    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? 1 : -1;
      const shoulder = this.shoulderBase[i].clone();
      shoulder.y += 0.003 * breath;
      this.deltoids[i].position.set(shoulder.x, shoulder.y - 0.012, 0);
      const wob = still ? 0 : Math.sin(t * 6.5 + ph + i) * 0.0012 * typing;
      const wrist: V3 = [side * WRIST.x, WRIST.y + wob, WRIST.z];
      const elbow = solveArm([shoulder.x, shoulder.y, shoulder.z], wrist, BODY.upperArm, BODY.forearm, [side * 0.55, -1, -0.35]);
      const E = v3(elbow);
      const W = v3(wrist);
      placeBetween(this.upperArm[i], shoulder, E);
      this.foreArm[i].position.copy(E);
      this.foreArm[i].quaternion.setFromUnitVectors(UP, new THREE.Vector3().subVectors(W, E).normalize());
      this.elbows[i].position.copy(E);
      this.handMounts[i].position.copy(W);
    }

    // fingers: resting on the keys; while typing each finger lifts and taps at its own rhythm
    for (let h = 0; h < 2; h++) {
      const hand = this.hands[h];
      hand.fingers.forEach((fin, j) => {
        const w = 8.5 + j * 1.9 + h * 0.7;
        const tap = still ? 1 : smoothstep(0.55, 0.95, Math.sin(t * w + ph * (j + 1) + h * 2.1));
        const lift = 0.2 * typing * (1 - tap);
        curlFinger(fin, fin.rest - lift + 0.05 * typing * tap);
      });
      const thumbLift = still ? 0 : 0.06 * typing * (0.5 + 0.5 * Math.sin(t * 2.3 + ph + h));
      curlFinger(hand.thumb, hand.thumb.rest - thumbLift);
    }
  }

  /**
   * Where each fingertip's lowest point is, in the character's local frame. Used by the tests to prove
   * the fingertips really rest on the key tops, and by nothing at runtime.
   */
  fingertips(): { name: string; x: number; y: number; z: number }[] {
    this.root.updateMatrixWorld(true);
    const out: { name: string; x: number; y: number; z: number }[] = [];
    const names = ["index", "middle", "ring", "pinky"];
    const inv = new THREE.Matrix4().copy(this.root.matrixWorld).invert();
    this.hands.forEach((hand, h) => {
      hand.fingers.forEach((fin, j) => {
        const tip = new THREE.Vector3(0, 0, fin.tipLength).applyMatrix4(fin.joints[2].matrixWorld).applyMatrix4(inv);
        out.push({ name: `${h === 0 ? "left" : "right"} ${names[j]}`, x: tip.x, y: tip.y - fin.tipRadius, z: tip.z });
      });
    });
    return out;
  }

  dispose() {
    for (const m of this.mats) m.dispose();
    this.disposeLaptop();
  }
}

