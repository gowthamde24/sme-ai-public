import { describe, expect, it } from "vitest";

import { AGENT_KEYS } from "@/lib/api/today";

import { ALL_AGENT_IDS, TEAM_IDS } from "./ids";
import { SEATS } from "./seats";

describe("the seven helpers", () => {
  it("are the API's seven, in the API's order (the room keeps its own list so its file never imports the API client)", () => {
    expect([...ALL_AGENT_IDS]).toEqual([...AGENT_KEYS]);
    expect(ALL_AGENT_IDS[0]).toBe("main");
    expect(TEAM_IDS).toHaveLength(6);
  });
  it("each has a seat, and nobody else", () => {
    expect(Object.keys(SEATS).sort()).toEqual([...AGENT_KEYS].sort());
  });
});

describe("the seats round the table", () => {
  it("Agent OWL is at the head (top, in the middle) and the helpers keep the API's order, left to right", () => {
    expect(SEATS.main.x).toBe(50);
    const ys = ALL_AGENT_IDS.map((id) => SEATS[id].y);
    expect(SEATS.main.y).toBe(Math.min(...ys));
    expect(TEAM_IDS.slice(0, 3).every((id) => SEATS[id].x < 50)).toBe(true);
    expect(TEAM_IDS.slice(3).every((id) => SEATS[id].x > 50)).toBe(true);
    // the left arc runs from the near side up to the head, the right arc from the head down
    expect(SEATS.lead_finder.y).toBeGreaterThan(SEATS.researcher.y);
    expect(SEATS.researcher.y).toBeGreaterThan(SEATS.requirement_analyst.y);
    expect(SEATS.quote_writer.y).toBeLessThan(SEATS.followup_desk.y);
    expect(SEATS.followup_desk.y).toBeLessThan(SEATS.order_desk.y);
  });
  it("is mirror-symmetric, and every seat is inside the room with room for its name", () => {
    expect(SEATS.lead_finder.x + SEATS.order_desk.x).toBeCloseTo(100, 0);
    expect(SEATS.researcher.y).toBeCloseTo(SEATS.followup_desk.y, 0);
    for (const id of ALL_AGENT_IDS) {
      expect(SEATS[id].x).toBeGreaterThan(8);
      expect(SEATS[id].x).toBeLessThan(92);
      expect(SEATS[id].y).toBeGreaterThan(8);
      expect(SEATS[id].y).toBeLessThan(88);
    }
  });
  it("no two owls are closer than a seat width", () => {
    const ids = [...ALL_AGENT_IDS];
    for (const a of ids) for (const b of ids) if (a < b) expect(Math.hypot(SEATS[a].x - SEATS[b].x, (SEATS[a].y - SEATS[b].y) * 0.8), `${a} ${b}`).toBeGreaterThan(14);
  });
  it("on a phone the room is two rows of 12 columns that do not overlap: three at the far side (Agent OWL in the middle), four at the near side", () => {
    const rows = { 1: [] as { id: string; col: number; span: number }[], 2: [] as { id: string; col: number; span: number }[] };
    for (const id of ALL_AGENT_IDS) rows[SEATS[id].phone.row].push({ id, ...SEATS[id].phone });
    expect(rows[1].map((r) => r.id)).toEqual(expect.arrayContaining(["requirement_analyst", "main", "quote_writer"]));
    expect(rows[1]).toHaveLength(3);
    expect(rows[2]).toHaveLength(4);
    for (const row of [rows[1], rows[2]]) {
      const sorted = [...row].sort((a, b) => a.col - b.col);
      let next = 1;
      for (const r of sorted) {
        expect(r.col).toBe(next);
        next += r.span;
      }
      expect(next).toBe(13);
    }
    expect(rows[1].find((r) => r.id === "main")!.col).toBe(5);
  });
});
