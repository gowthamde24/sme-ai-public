import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { AGENT_KEYS } from "@/lib/api/today";

import { BIG_STILL_AGENT, BIG_STILL_WIDTH, EYES, HEAD_PIVOT, HELPER_AGENTS, MOUTH, OWL_AGENTS, OWL_DIR, STILL_WIDTHS, WORK_BOB, WORK_LOOK, owlAgent, owlDir, owlFiles, stillFile, stillSrcSet, workWings } from "./plush-rig";

const PUBLIC = path.resolve(import.meta.dirname, "../../../../public");
const onDisk = (url: string) => fs.existsSync(path.join(PUBLIC, url));

describe("which pictures an agent's owl uses", () => {
  it("the seven owls are the API's seven agents, in the API's order", () => {
    expect([...OWL_AGENTS]).toEqual([...AGENT_KEYS]);
  });
  it("each agent has its own folder under the versioned /owl/v3/, with the five layers and the three stills", () => {
    expect(OWL_DIR).toBe("/owl/v3");
    for (const a of OWL_AGENTS) {
      expect(owlDir(a)).toBe(`/owl/v3/${a}`);
      const f = owlFiles(a);
      expect(Object.values(f)).toEqual(["head", "body", "beak", "wing-left", "wing-right"].map((n) => `/owl/v3/${a}/owlet-${n}-512.webp`));
      for (const url of [...Object.values(f), ...STILL_WIDTHS.map((w) => stillFile(w, a))]) expect(onDisk(url), url).toBe(true);
    }
  });
  it("Agent OWL alone has a 1024 px still (job CZ) for where the owl is drawn large; the six helpers are never that big, so they have none", () => {
    expect(BIG_STILL_AGENT).toBe("main");
    expect(onDisk(stillFile(BIG_STILL_WIDTH, "main"))).toBe(true);
    expect(stillSrcSet([256, 512, 1024], "main")).toBe("/owl/v3/main/owlet-full-256.webp 256w, /owl/v3/main/owlet-full-512.webp 512w, /owl/v3/main/owlet-full-1024.webp 1024w");
    expect(fs.statSync(path.join(PUBLIC, stillFile(BIG_STILL_WIDTH, "main"))).size).toBeLessThan(60 * 1024);
    for (const a of OWL_AGENTS.filter((x) => x !== "main")) expect(onDisk(stillFile(BIG_STILL_WIDTH, a)), a).toBe(false);
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
    expect(owlFiles().head).toBe("/owl/v3/main/owlet-head-512.webp");
    expect(owlFiles("nobody").beak).toBe("/owl/v3/main/owlet-beak-512.webp");
  });
  it("the still's srcset names that agent's three sizes", () => {
    expect(stillSrcSet(undefined, "order_desk")).toBe("/owl/v3/order_desk/owlet-full-128.webp 128w, /owl/v3/order_desk/owlet-full-256.webp 256w, /owl/v3/order_desk/owlet-full-512.webp 512w");
    expect(stillSrcSet([128, 256], "researcher")).toBe("/owl/v3/researcher/owlet-full-128.webp 128w, /owl/v3/researcher/owlet-full-256.webp 256w");
  });
});

describe("the v3 rig numbers (the face is in the middle of the head)", () => {
  it("head pivot x 519 of 1024, the mouth at 49.3 %, the eyelid boxes at 34.1 % and 55.5 %", () => {
    expect(HEAD_PIVOT.x).toBeCloseTo((519 / 1024) * 100, 0);
    expect(MOUTH.left).toBe(49.3);
    expect(EYES.map((e) => e.left)).toEqual([34.1, 55.5]);
    expect(EYES.map((e) => e.top)).toEqual([23.9, 24.5]);
    const css = fs.readFileSync(path.resolve(import.meta.dirname, "../../../../design/owl.css"), "utf8");
    expect(css).toContain(`transform-origin: ${HEAD_PIVOT.x}% ${HEAD_PIVOT.y}%`);
    expect(css).toContain(`left: ${MOUTH.left}%`);
    expect(css).toContain(`.plush-eye-0 { left: ${EYES[0].left}%`);
    expect(css).toContain(`.plush-eye-1 { left: ${EYES[1].left}%`);
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
