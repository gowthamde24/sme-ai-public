/**
 * The ONE place the owls' colours are decided (job AR). Every owl, flat or 3D, has the same body, the app's orange eye rings, beak and feet, and a cap, brows, ear tufts and wings in a
 * colour of its own. Agent OWL ("main") is the sky blue of the approved reference. The six helpers use the hue families of the v2 tokens (green, violet, amber, rose, slate, terracotta);
 * each value is a mid tone that stays readable on both the light (#ffffff) and the dark (#1f1e23) card (owl-colors.test.ts checks the contrast and that no two are alike).
 * No three.js in here: the flat SVG owls (landing, lists) and the 3D owls (Today, the Office) both import it.
 */
export const OWL_AGENTS = ["main", "lead_finder", "researcher", "requirement_analyst", "quote_writer", "followup_desk", "order_desk"] as const;
export type OwlAgent = (typeof OWL_AGENTS)[number];

/** `cap` is the cap, brows, ear tufts and the upper feathers of the wings; `capDeep` is the darker layer of the wings. */
export type OwlPalette = { cap: string; capDeep: string };

/** What every owl shares: the clay body, the chest, the app's own orange (eye rings, beak, feet, thinking dots, the ring) and the eye. */
export const OWL_BODY = {
  cream: "#ecceb0",
  creamLight: "#f7e4cf",
  creamDeep: "#ddb48e",
  socket: "#f8ead9",
  accent: "#ff7426",
  iris: "#2f8fe0",
  irisLight: "#6fc4f5",
  pupil: "#1a1416",
  cheek: "#ff9d8c",
} as const;

export const OWL_PALETTE: Readonly<Record<OwlAgent, OwlPalette>> = {
  main: { cap: "#6a9ee6", capDeep: "#4f86d8" },
  lead_finder: { cap: "#4fae6b", capDeep: "#3b9658" },
  researcher: { cap: "#a36fd8", capDeep: "#8a54c4" },
  requirement_analyst: { cap: "#e8a93a", capDeep: "#d4932a" },
  quote_writer: { cap: "#e56b86", capDeep: "#d4506e" },
  followup_desk: { cap: "#7d8696", capDeep: "#667184" },
  order_desk: { cap: "#d9703f", capDeep: "#c45a2a" },
};

/** The palette of an agent id; an id this app does not know gets Agent OWL's (never a made-up colour). */
export function paletteOf(agent: string): OwlPalette {
  return (OWL_PALETTE as Record<string, OwlPalette>)[agent] ?? OWL_PALETTE.main;
}
