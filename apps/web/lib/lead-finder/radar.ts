import type { Prospect, ProspectStats, ProspectStatus } from "./types";

/**
 * The Lead Finder's radar (app v4 part 5, from app-Finder.png), pure so it is tested without a browser. Nothing is invented: a business is a pin only where the provider gave it a position (lat and lng); the middle of the radar is the
 * middle of the businesses found (their mean position: the workspace has no place of its own in the API yet), and the rings are kilometres from that middle, said so on the picture. A radar with fewer than two positioned businesses is not
 * drawn. Positions are the flat approximation of a few tens of kilometres (cos of the latitude), which is all a search around one town needs.
 */
export type Pin = { id: string; label: string; x: number; y: number; km: number; tone: "go" | "ask" | "quiet"; labelled: boolean };
export type Radar = { pins: Pin[]; rings: { r: number; km: number }[]; outerKm: number; positioned: number };

const KM_PER_DEG = 111.32;
/** The ring of the outside: the next round number of kilometres at or above the farthest business. */
const NICE = [0.5, 1, 2, 3, 5, 10, 15, 20, 30, 50, 100, 200, 500, 1000];

const toneOf = (s: ProspectStatus): Pin["tone"] => (s === "call_ready" ? "go" : s === "needs_owner" ? "ask" : "quiet");

/** Boxes in percent of the picture (the same space the pins are drawn in: 50 + 45 * x). */
type Box = { x0: number; y0: number; x1: number; y1: number };
const at = (v: number) => 50 + v * 45;
const CENTRE: Box = { x0: 43.5, y0: 43.5, x1: 56.5, y1: 56.5 };
const dotBox = (p: Pin): Box => ({ x0: at(p.x) - 2, y0: at(p.y) - 2, x1: at(p.x) + 2, y1: at(p.y) + 2 });
/** A name sits to the right of its pin: about 1.5 % of the picture for a letter, 4 % of padding, never wider than 9 rem (about a third). */
const labelBox = (p: Pin): Box => {
  const w = Math.min(32, p.label.length * 1.5 + 4);
  return { x0: at(p.x) + 1.5, y0: at(p.y) - 3, x1: at(p.x) + 1.5 + w, y1: at(p.y) + 3 };
};
const overlaps = (a: Box, b: Box): boolean => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

export function buildRadar(items: readonly Pick<Prospect, "id" | "name" | "area" | "status" | "lat" | "lng">[], labelled = 5): Radar | null {
  const placed = items.filter((p): p is typeof p & { lat: number; lng: number } => typeof p.lat === "number" && typeof p.lng === "number" && Number.isFinite(p.lat) && Number.isFinite(p.lng));
  if (placed.length < 2) return null;
  const lat0 = placed.reduce((a, p) => a + p.lat, 0) / placed.length;
  const lng0 = placed.reduce((a, p) => a + p.lng, 0) / placed.length;
  const kx = KM_PER_DEG * Math.cos((lat0 * Math.PI) / 180);
  const pts = placed.map((p) => ({ p, e: (p.lng - lng0) * kx, n: (p.lat - lat0) * KM_PER_DEG }));
  const far = Math.max(...pts.map(({ e, n }) => Math.hypot(e, n)));
  const outerKm = NICE.find((k) => k >= far * 1.05) ?? NICE[NICE.length - 1];
  const pins = pts.map(({ p, e, n }): Pin => ({
    id: p.id,
    label: (p.area ?? p.name).slice(0, 40),
    x: Math.max(-1, Math.min(1, e / outerKm)),
    y: Math.max(-1, Math.min(1, -n / outerKm)), // north is up
    km: Math.hypot(e, n),
    tone: toneOf(p.status),
    labelled: false,
  }));
  // the list is best fit first: the best few carry their name, but a name that would sit on the assistant, on another pin or on another name is left out (that pin is still there, and its card has the name)
  const named: Box[] = [];
  for (const pin of pins) {
    if (named.length >= labelled) break;
    const box = labelBox(pin);
    const blocked = box.x1 > 100 || overlaps(CENTRE, box) || pins.some((o) => o !== pin && overlaps(dotBox(o), box)) || named.some((n) => overlaps(n, box));
    if (blocked) continue;
    pin.labelled = true;
    named.push(box);
  }
  const rings = [1 / 3, 2 / 3, 1].map((r) => ({ r, km: Math.round(outerKm * r * 10) / 10 }));
  return { pins, rings, outerKm, positioned: placed.length };
}

/** "Checked 35 businesses. 1 worth a call.": every business the Lead Finder looked at, and those that are ready or wait for the owner's OK. */
export function checkedOf(stats: ProspectStats | null): { checked: number; worth: number } | null {
  if (!stats) return null;
  return { checked: stats.total, worth: (stats.byStatus.call_ready ?? 0) + (stats.byStatus.needs_owner ?? 0) };
}

/** The decision chip of a card: the three of the design (Call now, Ask you first, Skip); any other state keeps its own word. */
export function chipOf(status: ProspectStatus): "call_ready" | "needs_owner" | "skipped" | "other" {
  return status === "call_ready" || status === "needs_owner" || status === "skipped" ? status : "other";
}

/** The ones "Call all suggested shops" says yes to: the businesses waiting for the owner's OK in this list. */
export const suggested = (items: readonly Pick<Prospect, "id" | "status">[]): string[] => items.filter((p) => p.status === "needs_owner").map((p) => p.id);

/** The words a "find more like this shop" search is made of: the shop's own type and, where it is, its area (the search's area when the list knows it). null = the shop has no type to look for. */
export function likeThis(p: Pick<Prospect, "category" | "area">, searchArea: string | null): { query: string; area: string } | null {
  const query = (p.category ?? "").trim();
  if (query.length < 2) return null;
  return { query: query.slice(0, 100), area: (searchArea ?? p.area ?? "").trim().slice(0, 120) };
}
