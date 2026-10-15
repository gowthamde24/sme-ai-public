import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { AGENT_KEYS } from "@/lib/api/today";

import { BEAK_BOX, BREATHING_PIVOT, EYES, EYE_CENTRES, HEAD_PIVOT, HELPER_AGENTS, HERO_WIDTHS, LAYER_PX, LAYER_SIZES, MOUTH, OWL_AGENTS, OWL_DIR, STILL_WIDTHS, WING_LEFT, WING_RIGHT, WORK_BOB, WORK_LOOK, avatarWidths, layerSizeFor, owlAgent, owlDir, owlFiles, shutArc, stillFile, stillSrcSet, workWings } from "./plush-rig";

const PUBLIC = path.resolve(import.meta.dirname, "../../../../public");
const onDisk = (url: string) => fs.existsSync(path.join(PUBLIC, url));

describe("which pictures an agent's owl uses", () => {
  it("the seven owls are the API's seven agents, in the API's order", () => {
    expect([...OWL_AGENTS]).toEqual([...AGENT_KEYS]);
  });
  it("each agent has its own folder under the versioned /owl/v4/, with the five layers in 512 and 1024 px and the four stills", () => {
    expect(OWL_DIR).toBe("/owl/v4");
    for (const a of OWL_AGENTS) {
      expect(owlDir(a)).toBe(`/owl/v4/${a}`);
      for (const size of LAYER_SIZES) {
        const f = owlFiles(a, size);
        expect(Object.values(f)).toEqual(["head", "body", "beak", "wing-left", "wing-right"].map((n) => `/owl/v4/${a}/owlet-${n}-${size}.webp`));
        for (const url of Object.values(f)) expect(onDisk(url), url).toBe(true);
      }
      for (const url of STILL_WIDTHS.map((w) => stillFile(w, a))) expect(onDisk(url), url).toBe(true);
    }
  });
  it("every agent has the 1024 px still (a big owl on a sharp screen is never a stretched 512 px file): the hero offers 512 and 1024", () => {
    expect([...STILL_WIDTHS]).toEqual([128, 256, 512, 1024]);
    expect([...HERO_WIDTHS]).toEqual([512, 1024]);
    expect(stillSrcSet(HERO_WIDTHS, "main")).toBe("/owl/v4/main/owlet-full-512.webp 512w, /owl/v4/main/owlet-full-1024.webp 1024w");
    for (const a of OWL_AGENTS) expect(onDisk(stillFile(1024, a)), a).toBe(true);
  });
  it("a small owl is offered its 1x and 2x files; a layer size is the smallest file that is not smaller than the device pixels it fills", () => {
    expect([...avatarWidths(48)]).toEqual([128, 256]);
    expect([...avatarWidths(128)]).toEqual([128, 256]);
    expect([...avatarWidths(160)]).toEqual([256, 512]);
    expect(layerSizeFor(160, 1)).toBe(512);
    expect(layerSizeFor(256, 2)).toBe(512);
    expect(layerSizeFor(257, 2)).toBe(1024);
    expect(layerSizeFor(340, 2)).toBe(1024);
    expect(layerSizeFor(240, 3)).toBe(1024);
  });
  it("the six helpers, in the order of the six steps, are the API's helpers after Agent OWL", () => {
    expect([...HELPER_AGENTS]).toEqual(["lead_finder", "researcher", "requirement_analyst", "quote_writer", "followup_desk", "order_desk"]);
    expect([...OWL_AGENTS]).toEqual(["main", ...HELPER_AGENTS]);
  });
  it("no two agents share a picture (each owl has its own colours), and the six helpers differ from Agent OWL's sky blue", () => {
    const bytes = (a: string) => fs.readFileSync(path.join(PUBLIC, owlFiles(a).body.slice(1))).toString("base64");
    const seen = new Set(OWL_AGENTS.map(bytes));
    expect(seen.size).toBe(OWL_AGENTS.length);
  });
  it("the default is Agent OWL, and an id the app does not know gets Agent OWL (never a broken picture)", () => {
    expect(owlAgent(undefined)).toBe("main");
    expect(owlAgent("")).toBe("main");
    expect(owlAgent("../../etc/passwd")).toBe("main");
    expect(owlAgent("quote_writer")).toBe("quote_writer");
    expect(owlFiles().head).toBe("/owl/v4/main/owlet-head-512.webp");
    expect(owlFiles("lead_finder", 1024).head).toBe("/owl/v4/lead_finder/owlet-head-1024.webp");
    expect(owlFiles("nobody").beak).toBe("/owl/v4/main/owlet-beak-512.webp");
  });
  it("the still's srcset names that agent's four sizes", () => {
    expect(stillSrcSet(undefined, "order_desk")).toBe("/owl/v4/order_desk/owlet-full-128.webp 128w, /owl/v4/order_desk/owlet-full-256.webp 256w, /owl/v4/order_desk/owlet-full-512.webp 512w, /owl/v4/order_desk/owlet-full-1024.webp 1024w");
    expect(stillSrcSet([128, 256], "researcher")).toBe("/owl/v4/researcher/owlet-full-128.webp 128w, /owl/v4/researcher/owlet-full-256.webp 256w");
  });
  it("no code reads the v3 folder any more (it stays on disk for now)", () => {
    const here = path.resolve(import.meta.dirname, "../../../..");
    for (const f of ["components/v2/app/owl/owl-files.ts", "components/v2/app/owl/plush-rig.ts", "components/v2/app/owl/PlushOwl.tsx", "components/v2/app/owl/PlushStill.tsx", "components/v2/site/SiteOwl.tsx", "scripts/og-images.mjs", "design/owl.css"]) expect(fs.readFileSync(path.join(here, f), "utf8"), f).not.toMatch(/owl\/v3\//);
  });
});

describe("the v4 rig: every number is the art's own (public/owl/v4/rig.json), in the code and in design/owl.css", () => {
  const rig = JSON.parse(fs.readFileSync(path.join(PUBLIC, "owl/v4/rig.json"), "utf8"));
  const css = fs.readFileSync(path.resolve(import.meta.dirname, "../../../../design/owl.css"), "utf8");
  it("rig.json is for the 1024 px space the code works in, and all seven agents ship the same file (one rig, seven colours)", () => {
    expect(rig.canvas).toBe(LAYER_PX);
    for (const a of OWL_AGENTS) expect(JSON.parse(fs.readFileSync(path.join(PUBLIC, "owl/v4", a, "rig.json"), "utf8")), a).toEqual(rig);
  });
  it("the head turns about the art's pivot, the body breathes about its breathing pivot, and design/owl.css says the same", () => {
    expect([HEAD_PIVOT.x, HEAD_PIVOT.y]).toEqual(rig.head_pivot_pct);
    expect(HEAD_PIVOT.x).toBeCloseTo((rig.head_pivot[0] / 1024) * 100, 0);
    expect(BREATHING_PIVOT.x).toBeCloseTo(50, 1);
    expect(BREATHING_PIVOT.y).toBeCloseTo((rig.breathing_pivot[1] / 1024) * 100, 1);
    expect(css).toContain(`.plush-head { position: absolute; inset: 0; transform-origin: ${HEAD_PIVOT.x}% ${HEAD_PIVOT.y}%;`);
    expect(css).toContain(`.plush-rig { position: absolute; inset: 0; transform-origin: 50% ${BREATHING_PIVOT.y}%;`);
  });
  it("the mouth, the beak and both eyelid boxes are the art's, and design/owl.css places the lids and the mouth where the code says", () => {
    expect(MOUTH).toEqual(rig.mouth);
    expect([...BEAK_BOX]).toEqual(rig.beak_box);
    expect(EYES[0]).toEqual(rig.eyelids.left);
    expect(EYES[1]).toEqual(rig.eyelids.right);
    expect(css).toContain(`.plush-mouth { position: absolute; left: ${MOUTH.left}%; top: ${MOUTH.top}%; width: ${MOUTH.width}%; height: ${MOUTH.height}%;`);
    for (const i of [0, 1]) expect(css).toContain(`.plush-eye-${i} { left: ${EYES[i].left}%; top: ${EYES[i].top}%; width: ${EYES[i].width}%; height: ${EYES[i].height}%; }`);
    // the mouth sits under the lower edge of the beak, centred on it
    const beakBottom = (BEAK_BOX[3] / 1024) * 100;
    expect(MOUTH.top).toBeLessThan(beakBottom);
    expect(MOUTH.top + MOUTH.height).toBeGreaterThan(beakBottom);
    const beakMid = ((BEAK_BOX[0] + BEAK_BOX[2]) / 2 / 1024) * 100;
    expect(Math.abs(MOUTH.left + MOUTH.width / 2 - beakMid)).toBeLessThan(1.5);
  });
  it("the wing boxes, inner edges and pivots are the art's (the pivot is on the inner edge of its wing, near the top)", () => {
    for (const [wing, r] of [[WING_LEFT, rig.wing_left], [WING_RIGHT, rig.wing_right]] as const) {
      expect([wing.x0, wing.y0, wing.x1, wing.y1]).toEqual(r.box);
      expect(wing.inner).toBe(r.inner_edge);
      expect([wing.px, wing.py]).toEqual(r.pivot);
      expect(Math.abs(wing.px - wing.inner)).toBeLessThan(10);
      expect(wing.py - wing.y0).toBeLessThan(0.25 * (wing.y1 - wing.y0));
    }
    expect(WING_LEFT.left).toBe(true);
    expect(WING_RIGHT.left).toBe(false);
  });
  it("the closed-eye arc of each eye is drawn about that eye's centre (in the eye box's own 100 x 100 space), inside the box", () => {
    for (const i of [0, 1]) {
      const [m, q] = shutArc(i).match(/-?\d+(\.\d+)?/g)!.map(Number).reduce<number[][]>((acc, n, k) => (k < 2 ? [[...(acc[0] ?? []), n], acc[1] ?? []] : [acc[0], [...(acc[1] ?? []), n]]), [[], []]);
      const [x0, y0] = m;
      const [cx, cy, x1] = q;
      expect(cx).toBeCloseTo(((EYE_CENTRES[i][0] / 1024) * 100 - EYES[i].left) / (EYES[i].width / 100), 0);
      expect(y0).toBeCloseTo(((EYE_CENTRES[i][1] / 1024) * 100 - EYES[i].top) / (EYES[i].height / 100), 0);
      expect((x0 + x1) / 2).toBeCloseTo(cx, 0);
      expect(x0).toBeGreaterThan(0);
      expect(x1).toBeLessThan(100);
      expect(cy).toBeLessThan(100);
    }
  });
});

describe("the working pose (the Office)", () => {
  it("the wings type one after the other, around a raised rest angle, about 1.7 times a second", () => {
    for (let t = 0; t < 3; t += 0.05) {
      const w = workWings(t);
      expect(w.l + w.r).toBeCloseTo(14, 5); // alternating: when one is up the other is down
      expect(Math.abs(w.l - 7)).toBeLessThanOrEqual(7.0001);
    }
    expect(workWings(0)).not.toEqual(workWings(0.15));
    expect(workWings(0.5815).l).toBeCloseTo(workWings(0).l, 1); // one beat is 2 pi / 10.8 s
  });
  it("the bob is small (half the answering hop) and the head looks down at the screen", () => {
    expect(WORK_BOB).toBeLessThan(0.012);
    expect(WORK_BOB).toBeGreaterThan(0);
    expect(WORK_LOOK.y).toBeGreaterThan(0.5);
    expect(WORK_LOOK.x).toBe(0);
  });
});
