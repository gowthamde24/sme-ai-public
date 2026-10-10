import { describe, expect, it } from "vitest";

import { OWL_AGENTS, OWL_PALETTE, paletteOf } from "./owl-colors";
import { AGENT_KEYS } from "@/lib/api/today";

const lum = (hex: string) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const contrast = (a: string, b: string) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
const dist = (a: string, b: string) => Math.hypot(...[1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16) - parseInt(b.slice(i, i + 2), 16)));

describe("the owl colour map (one file, used by the flat and the 3D owls)", () => {
  it("has exactly the API's seven agents", () => {
    expect([...OWL_AGENTS]).toEqual([...AGENT_KEYS]);
    expect(Object.keys(OWL_PALETTE)).toEqual([...AGENT_KEYS]);
  });
  it("Agent OWL is the blue of the approved reference", () => {
    expect(OWL_PALETTE.main).toEqual({ cap: "#6a9ee6", capDeep: "#4f86d8" });
  });
  it("every colour is a plain #rrggbb and no two agents look alike", () => {
    const caps = OWL_AGENTS.map((a) => OWL_PALETTE[a].cap);
    for (const a of OWL_AGENTS) {
      expect(OWL_PALETTE[a].cap).toMatch(/^#[0-9a-f]{6}$/);
      expect(OWL_PALETTE[a].capDeep).toMatch(/^#[0-9a-f]{6}$/);
      expect(lum(OWL_PALETTE[a].capDeep), a).toBeLessThan(lum(OWL_PALETTE[a].cap)); // the second layer of the wing is the deeper one
    }
    expect(new Set(caps).size).toBe(7);
    for (let i = 0; i < caps.length; i++) for (let j = i + 1; j < caps.length; j++) expect(dist(caps[i], caps[j]), `${OWL_AGENTS[i]} / ${OWL_AGENTS[j]}`).toBeGreaterThan(55);
  });
  it("every cap stands out from the light card (#ffffff) and the dark card (#1f1e23): at least 2:1", () => {
    for (const a of OWL_AGENTS) {
      expect(contrast(OWL_PALETTE[a].cap, "#ffffff"), `${a} on light`).toBeGreaterThanOrEqual(2);
      expect(contrast(OWL_PALETTE[a].cap, "#1f1e23"), `${a} on dark`).toBeGreaterThanOrEqual(2);
    }
  });
  it("an unknown id gets Agent OWL's colours, never a made-up one", () => {
    expect(paletteOf("somebody_new")).toBe(OWL_PALETTE.main);
    expect(paletteOf("order_desk")).toBe(OWL_PALETTE.order_desk);
  });
});
