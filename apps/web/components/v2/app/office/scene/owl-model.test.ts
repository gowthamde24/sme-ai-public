import * as THREE from "three";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { OWL_PALETTE } from "../../owl/owl-colors";
import { createOwl, moodTargets } from "./owl-model";

beforeEach(() => {
  // jsdom has no 2D canvas: the textures are drawn on nothing, which the model tolerates
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
});
afterEach(() => vi.restoreAllMocks());

const meshes = (root: THREE.Object3D) => {
  const out: THREE.Mesh[] = [];
  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) out.push(o as THREE.Mesh);
  });
  return out;
};

describe("moodTargets: the five moods as numbers (the reference's own values)", () => {
  it("idle is the neutral pose", () => {
    expect(moodTargets("idle", 1.3)).toEqual({ tilt: 0, tuft: 0, lean: 0, open: 1, ringOp: 0, hop: 0, sway: 0, wide: 1, brow: 0, happy: false, gaze: "free" });
  });
  it("listening: tufts up, leans in, eyes a little wider, the ring pulses", () => {
    const m = moodTargets("listening", 0);
    expect(m).toMatchObject({ tuft: 0.35, lean: 0.25, wide: 1.1, brow: 0.08 });
    expect(m.ringOp).toBeCloseTo(0.35);
    expect(moodTargets("listening", Math.PI / 12).ringOp).toBeCloseTo(0.7); // sin(pi/2) = 1
  });
  it("thinking: the head tilts side to side, the eyes look up, and the dots are shown by the owl", () => {
    expect(moodTargets("thinking", 0).gaze).toBe("up");
    expect(moodTargets("thinking", Math.PI / 3.2).tilt).toBeCloseTo(0.14); // sin(pi/2) * .14
  });
  it("answering: hops, glows, and smiles (^ ^) for 1.4 s in every 3.2 s", () => {
    expect(moodTargets("answering", 0.5).happy).toBe(true);
    expect(moodTargets("answering", 2).happy).toBe(false);
    expect(moodTargets("answering", 3.3).happy).toBe(true);
    expect(moodTargets("answering", Math.PI / 12).hop).toBeCloseTo(0.08);
    expect(moodTargets("answering", 0).ringOp).toBeCloseTo(0.55);
  });
  it("resting: eyes a third open, tufts down, sways slowly, looks down", () => {
    expect(moodTargets("resting", 0)).toMatchObject({ open: 0.3, tuft: -0.2, gaze: "down" });
  });
});

describe("createOwl", () => {
  it("builds a body, a cap, two eyes in rings, a beak, wings and feet in the agent's colours", () => {
    const rig = createOwl(OWL_PALETTE.quote_writer, { detail: "low", extras: false, shadow: false });
    const all = meshes(rig.root);
    expect(all.length).toBeGreaterThan(40);
    const colours = new Set(all.map((m) => ((m.material as THREE.MeshStandardMaterial).color as THREE.Color | undefined)?.getHexString()));
    expect(colours.has(new THREE.Color(OWL_PALETTE.quote_writer.cap).getHexString())).toBe(true);
    expect(colours.has(new THREE.Color(OWL_PALETTE.quote_writer.capDeep).getHexString())).toBe(true);
    expect(colours.has(new THREE.Color("#ff7426").getHexString())).toBe(true); // the app's orange: rings, beak, feet
    expect(colours.has(new THREE.Color(OWL_PALETTE.main.cap).getHexString())).toBe(false); // not Agent OWL's blue
    rig.dispose();
  });
  it("two owls have their own materials (their colours do not leak) but share geometry", () => {
    const a = createOwl(OWL_PALETTE.main, { detail: "low" });
    const b = createOwl(OWL_PALETTE.lead_finder, { detail: "low" });
    const capOf = (r: typeof a) => meshes(r.root).map((m) => (m.material as THREE.MeshStandardMaterial).color?.getHexString());
    expect(capOf(a)).toContain(new THREE.Color(OWL_PALETTE.main.cap).getHexString());
    expect(capOf(b)).not.toContain(new THREE.Color(OWL_PALETTE.main.cap).getHexString());
    const ga = new Set(meshes(a.root).map((m) => m.geometry));
    const gb = new Set(meshes(b.root).map((m) => m.geometry));
    expect([...ga].filter((g) => gb.has(g)).length).toBeGreaterThan(5);
    a.dispose();
    b.dispose();
  });
  it("snap and update move it: the thinking dots show only while thinking, the happy arcs only while smiling", () => {
    const rig = createOwl(OWL_PALETTE.main, { detail: "low", extras: true, shadow: false });
    const dots = meshes(rig.root).filter((m) => m.geometry.type === "SphereGeometry" && m.position.y > 3.4);
    expect(dots).toHaveLength(3);
    rig.snap("idle");
    expect(dots.every((d) => !d.visible)).toBe(true);
    rig.snap("thinking");
    expect(dots.every((d) => d.visible)).toBe(true);
    rig.update("answering", 0.5, 0.016);
    expect(dots.every((d) => !d.visible)).toBe(true);
    const arcs = meshes(rig.root).filter((m) => m.geometry.type === "TorusGeometry" && (m.geometry as THREE.TorusGeometry).parameters.arc === Math.PI);
    expect(arcs).toHaveLength(2);
    expect(arcs.every((a) => a.visible)).toBe(true);
    rig.update("idle", 2.2, 0.016);
    expect(arcs.every((a) => !a.visible)).toBe(true);
    rig.dispose();
  });
  it("a still pose does not breathe or hop", () => {
    const rig = createOwl(OWL_PALETTE.main, { detail: "low", extras: false, shadow: false });
    rig.snap("answering");
    const bob = rig.root.children[0].children[0];
    expect(bob.scale.x).toBe(1);
    expect(bob.position.y).toBeGreaterThanOrEqual(0); // the hop of the still pose is its value at t=0.5, not an animation
    rig.dispose();
  });
  it("dispose releases the materials, and the shared geometry only when the last owl is gone", () => {
    const a = createOwl(OWL_PALETTE.main, { detail: "low", extras: false, shadow: false });
    const b = createOwl(OWL_PALETTE.main, { detail: "low", extras: false, shadow: false });
    const geo = meshes(a.root)[0].geometry;
    const mat = meshes(a.root)[0].material as THREE.Material;
    const gSpy = vi.fn();
    const mSpy = vi.fn();
    geo.addEventListener("dispose", gSpy);
    mat.addEventListener("dispose", mSpy);
    a.dispose();
    expect(mSpy).toHaveBeenCalledTimes(1);
    expect(gSpy).not.toHaveBeenCalled(); // b still uses it
    b.dispose();
    expect(gSpy).toHaveBeenCalledTimes(1);
  });
});
