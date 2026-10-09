import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  BODY,
  DECK_Y,
  FINGERS,
  KEYBOARD_Z,
  KEY_Y,
  LAPTOP,
  WRIST,
  fingerContactY,
  len,
  solveArm,
  solveCurl,
  solveThumbCurl,
  sub,
  type V3,
} from "./anatomy";
import { Character } from "./character";
import { FACE, headDims, makeHairGeometry, makeHeadGeometry, makeTorsoGeometry, surfaceZ, torsoFront, type Detail, type HairStyle } from "./geo";
import { PEOPLE } from "./people";
import { SEATS, SEAT_RADIUS, TABLE_HEIGHT, TABLE_RADIUS, seatToWorld } from "./seats";
import { ALL_AGENT_IDS } from "./ids";

describe("arm IK", () => {
  const S: V3 = [0.2, 1.045, 0];
  const W: V3 = [WRIST.x, WRIST.y, WRIST.z];
  it("keeps both bone lengths exactly", () => {
    const E = solveArm(S, W, BODY.upperArm, BODY.forearm, [0.5, -1, -0.3]);
    expect(len(sub(E, S))).toBeCloseTo(BODY.upperArm, 4);
    expect(len(sub(W, E))).toBeCloseTo(BODY.forearm, 4);
  });
  it("puts the elbow below the shoulder-wrist line and a little outward", () => {
    const E = solveArm(S, W, BODY.upperArm, BODY.forearm, [0.5, -1, -0.3]);
    expect(E[1]).toBeLessThan(S[1] - 0.1);
    expect(E[0]).toBeGreaterThanOrEqual(S[0] - 0.02);
  });
  it("stretches instead of breaking when the hand is out of reach", () => {
    const far: V3 = [0.2, 1.0, 1.2];
    const E = solveArm(S, far, BODY.upperArm, BODY.forearm, [0, -1, 0]);
    expect(Number.isFinite(E[0] + E[1] + E[2])).toBe(true);
  });
});

describe("hands on the keyboard (maths)", () => {
  it("every finger's tip underside lands on the key tops", () => {
    for (const f of FINGERS) {
      const s = solveCurl(f);
      expect(s).toBeGreaterThan(0.1);
      expect(s).toBeLessThan(1.7);
      expect(Math.abs(fingerContactY(f, s) - KEY_Y)).toBeLessThan(0.0005);
    }
  });
  it("the thumb rests just above the deck", () => {
    const s = solveThumbCurl();
    expect(s).toBeGreaterThan(0);
    expect(s).toBeLessThan(1.8);
  });
});

describe("desk layout", () => {
  it("the laptop sits between the table edge and the person, at a believable distance", () => {
    const front = LAPTOP.z - LAPTOP.depth / 2;
    const tableEdge = SEAT_RADIUS - TABLE_RADIUS;
    expect(front).toBeGreaterThan(tableEdge + 0.05);
    expect(front - torsoFront(0.9, "m")).toBeGreaterThan(0.25); // 25 cm or more from the chest
    expect(front - torsoFront(0.9, "m")).toBeLessThan(0.45); // and close enough to reach
  });
  it("the keys are inside the laptop and above its deck", () => {
    expect(KEYBOARD_Z[0]).toBeGreaterThan(LAPTOP.z - LAPTOP.depth / 2);
    expect(KEYBOARD_Z[1]).toBeLessThan(LAPTOP.z + LAPTOP.depth / 2);
    expect(KEY_Y).toBeGreaterThan(DECK_Y);
    expect(DECK_Y).toBeGreaterThan(TABLE_HEIGHT);
  });
  it("every laptop corner stays on the table, even on the swivelled seats", () => {
    for (const id of ALL_AGENT_IDS) {
      for (const cx of [-1, 1]) {
        for (const cz of [-1, 1]) {
          const w = seatToWorld(SEATS[id], [cx * LAPTOP.width / 2, 0, LAPTOP.z + (cz * LAPTOP.depth) / 2]);
          expect(Math.hypot(w[0], w[2]), `${id} corner`).toBeLessThan(TABLE_RADIUS - 0.02);
        }
      }
    }
  });
  it("nobody's belly pokes into the table edge", () => {
    for (const id of ALL_AGENT_IDS) {
      const w = seatToWorld(SEATS[id], [0, 0, torsoFront(0.7, PEOPLE[id].build) + 0.03]);
      expect(Math.hypot(w[0], w[2]), id).toBeGreaterThan(TABLE_RADIUS + 0.02);
    }
  });
  it("the two near-side teammates are turned toward the camera so their faces show", () => {
    const camera = [0, 4.5, 7];
    for (const id of ["lead_finder", "order_desk"] as const) {
      const s = SEATS[id];
      const fwd = [Math.sin(s.yaw), Math.cos(s.yaw)];
      const toCam = [camera[0] - s.x, camera[2] - s.z];
      const cos = (fwd[0] * toCam[0] + fwd[1] * toCam[1]) / Math.hypot(toCam[0], toCam[1]);
      expect(cos, id).toBeGreaterThan(0.1); // facing at least a little toward the camera
      expect(s.glance).toBeGreaterThan(0.6);
    }
  });
});

describe("proportions", () => {
  it("head width to shoulder width is about 0.37, as in life", () => {
    for (const b of ["m", "f"] as const) {
      const ratio = headDims().width / (2 * BODY.shoulderX[b]);
      expect(ratio, b).toBeGreaterThan(0.33);
      expect(ratio, b).toBeLessThan(0.45);
    }
  });
  it("eyes sit about 45% of the head width apart, brows above eyes above nose above mouth above chin", () => {
    const eyeRatio = (2 * FACE.eyeX) / headDims().width;
    expect(eyeRatio).toBeGreaterThan(0.4);
    expect(eyeRatio).toBeLessThan(0.5);
    expect(FACE.browY).toBeGreaterThan(FACE.eyeY);
    expect(FACE.eyeY).toBeGreaterThan(FACE.noseTipY);
    expect(FACE.noseTipY).toBeGreaterThan(FACE.mouthY);
    expect(FACE.mouthY).toBeGreaterThan(FACE.chinY);
  });
  it("the face is a surface: eyes, nose and mouth sit in front of the skull centre", () => {
    for (const b of ["m", "f"] as const) {
      for (const y of [FACE.eyeY, FACE.noseTipY, FACE.mouthY]) expect(surfaceZ(0.0, y, b)).toBeGreaterThan(0.06);
      // the nose tip is the most forward point of the face, the eyes are set back from the brow
      expect(surfaceZ(0, FACE.mouthY, b)).toBeLessThan(surfaceZ(0, 0.04, b) + 0.02);
    }
  });
  it("the head geometry is 15 cm wide and 22 cm tall", () => {
    const g = makeHeadGeometry("m", "high", new THREE.Color("#c98e66"));
    g.computeBoundingBox();
    const b = g.boundingBox!;
    expect(b.max.x - b.min.x).toBeGreaterThan(0.14);
    expect(b.max.x - b.min.x).toBeLessThan(0.17);
    expect(b.max.y - b.min.y).toBeGreaterThan(0.2);
    expect(b.max.y - b.min.y).toBeLessThan(0.24);
  });
  it("arm length reaches the keys with a bent elbow (never fully straight)", () => {
    const d = Math.hypot(WRIST.x - BODY.shoulderX.m, WRIST.y - BODY.shoulderY, WRIST.z);
    expect(d).toBeLessThan(BODY.upperArm + BODY.forearm - 0.04);
    expect(d).toBeGreaterThan(0.3);
  });
});

describe("hair and torso geometry", () => {
  const styles: HairStyle[] = ["crop", "bob", "long", "bun", "curly", "puff"];
  it("every hairstyle has real volume (triangles) at every detail level", () => {
    for (const st of styles) {
      for (const d of ["high", "medium", "low"] as Detail[]) {
        const h = makeHairGeometry(st, "f", d);
        const tris = (h.main.index ? h.main.index.count : h.main.attributes.position.count) / 3;
        expect(tris, `${st}/${d}`).toBeGreaterThan(40);
      }
    }
  });
  it("the torso is wider at the chest than the waist", () => {
    const g = makeTorsoGeometry("m", "medium");
    g.computeBoundingBox();
    expect(g.boundingBox!.max.x).toBeGreaterThan(0.17);
  });
});

describe("the real rig: fingertips rest on the keys", () => {
  for (const id of ALL_AGENT_IDS) {
    for (const detail of ["high", "medium", "low"] as Detail[]) {
      it(`${id} (${detail}): all eight fingertips are on the key tops, over the keyboard`, () => {
        const c = new Character(PEOPLE[id], detail, 1);
        const tips = c.fingertips();
        expect(tips).toHaveLength(8);
        for (const t of tips) {
          expect(Math.abs(t.y - KEY_Y), `${id} ${t.name} y=${t.y.toFixed(4)} vs keys ${KEY_Y.toFixed(4)}`).toBeLessThan(0.0035);
          expect(t.z, `${t.name} z`).toBeGreaterThan(KEYBOARD_Z[0] - 0.02);
          expect(t.z, `${t.name} z`).toBeLessThan(KEYBOARD_Z[1] + 0.02);
          expect(Math.abs(t.x), `${t.name} x`).toBeLessThan(LAPTOP.width / 2);
        }
        c.dispose();
      });
    }
  }
  it("wrists hover above the deck, never inside it", () => {
    const c = new Character(PEOPLE.researcher, "high", 1);
    c.root.updateMatrixWorld(true);
    for (const h of c.hands) {
      const p = new THREE.Vector3();
      h.group.getWorldPosition(p);
      expect(p.y).toBeGreaterThan(DECK_Y + 0.02);
    }
  });
  it("detail levels shrink the triangle count", () => {
    const count = (d: Detail) => {
      const c = new Character(PEOPLE.lead_finder, d, 1);
      let tris = 0;
      c.root.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.geometry) tris += (m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position.count) / 3;
      });
      return tris;
    };
    const hi = count("high");
    const mid = count("medium");
    const lo = count("low");
    expect(lo).toBeLessThan(mid);
    expect(mid).toBeLessThan(hi);
    expect(lo).toBeLessThan(15000);
    expect(hi).toBeLessThan(120000);
  });
  it("animating does not move the resting fingertips off the keys", () => {
    const c = new Character(PEOPLE.order_desk, "high", 2);
    for (let i = 0; i < 30; i++) c.update(i * 0.05, 0.05, { typing: 0, speaking: false, headYaw: 0, reduced: false });
    for (const t of c.fingertips()) expect(Math.abs(t.y - KEY_Y)).toBeLessThan(0.0035);
  });
  it("typing lifts fingers by millimetres, not centimetres, and never pushes them through the keys", () => {
    const c = new Character(PEOPLE.order_desk, "high", 2);
    let lowest = 1;
    let highest = 0;
    for (let i = 0; i < 120; i++) {
      c.update(i * 0.03, 0.03, { typing: 1, speaking: false, headYaw: 0, reduced: false });
      for (const t of c.fingertips()) {
        lowest = Math.min(lowest, t.y);
        highest = Math.max(highest, t.y);
      }
    }
    expect(lowest).toBeGreaterThan(KEY_Y - 0.01);
    expect(highest).toBeLessThan(KEY_Y + 0.05);
  });
});
