import { describe, expect, it } from "vitest";

import type { NeedsCard, TodayData } from "@/components/v2/app/today/types";
import { NOTHING_TODAY } from "@/components/v2/app/today/types";
import { quoteCandidates } from "@/components/v2/app/today/v6/band-data";
import { briefOf } from "@/components/v2/app/today/v6/stream-data";
import { NO_COUNTS, type NavCounts } from "@/lib/nav-counts";

import { composeToday } from "./today-compose";

const quote = (id: string, at: string, amount = 5_000_00): NeedsCard => ({ type: "item", key: `quote_approval-${id}`, at, item: { kind: "quote_approval", id, customer: `Customer ${id}`, city: null, agent: "quote_writer", summary: "", at, amount_paise: amount, href: `/q/${id}` } });
const hot = (id: string, at: string): NeedsCard => ({ type: "item", key: `hot_lead_waiting-${id}`, at, item: { kind: "hot_lead_waiting", id, customer: `Lead ${id}`, city: null, agent: "followup_desk", summary: "", at, amount_paise: null, href: `/l/${id}` } });
const raw = (needs: NeedsCard[], waiting = needs.length): TodayData => ({ ...NOTHING_TODAY, cards: { waiting, money_held_paise: 0, orders_open: 0 }, needs });
const tt = (k: string) => k;
const NONE = { needs: [], team: [] };
const base = { finder: [], deskPack: false, campus: false, finderState: "hidden" as const, role: "owner" as const, base: "/app/tenants/t", tt, now: Date.parse("2026-11-19T06:00:00Z") };
const COUNTS: NavCounts = { ...NO_COUNTS, newLeads: 35, needsYou: 4, leadDeskWaiting: 1, prospectsNeedingOwner: 0 };

/** What the page does when the briefing does not wait for Lead Desk: the same function with nothing from it. */
const light = (r: TodayData, counts: NavCounts = COUNTS) => {
  const c = composeToday(r, { ...base, desk: NONE, counts });
  return briefOf(c.data, c.newLeads);
};
const full = (r: TodayData, desk: { needs: NeedsCard[]; team: never[] }, counts: NavCounts = COUNTS) => {
  const c = composeToday(r, { ...base, desk, counts });
  return briefOf(c.data, c.newLeads);
};

describe("the briefing drawn before Lead Desk has answered says what it says after", () => {
  const desk = { needs: [hot("1", "2026-11-19T05:00:00Z"), hot("2", "2026-11-18T05:00:00Z")], team: [] as never[] };

  it("with no quote, one quote, and the menu's number known: the same facts, the same quote, the same number", () => {
    for (const needs of [[], [quote("a", "2026-11-17T05:00:00Z")], [quote("a", "2026-11-17T05:00:00Z"), hot("9", "2026-11-19T01:00:00Z")]]) {
      expect(quoteCandidates(needs)).toBeLessThanOrEqual(1);
      expect(light(raw(needs))).toEqual(full(raw(needs), desk));
    }
  });

  it("a quote without an amount is not one the briefing could name", () => {
    expect(quoteCandidates([quote("a", "2026-11-17T05:00:00Z", 0), quote("b", "2026-11-18T05:00:00Z", 0)])).toBe(0);
  });

  it("with two quotes the order of the list decides which one is named, and Lead Desk's items re-sort the list: that is why the briefing then waits for them", () => {
    const needs = [quote("old", "2026-11-10T05:00:00Z"), quote("new", "2026-11-18T05:00:00Z")];
    expect(quoteCandidates(needs)).toBe(2);
    expect(light(raw(needs)).top?.name).toBe("Customer old"); // the API's own order
    expect(full(raw(needs), desk).top?.name).toBe("Customer new"); // newest first once Lead Desk's items joined
  });

  it("with the menu's number not known, the number of things waiting is the merged one: it differs (Lead Desk adds what the API did not count)", () => {
    const r = raw([quote("a", "2026-11-17T05:00:00Z")], 1);
    expect(light(r, NO_COUNTS).waiting).toBe(1);
    expect(full(r, desk, NO_COUNTS).waiting).toBe(3);
  });

  it("with the menu's number known it is that number either way", () => {
    const r = raw([quote("a", "2026-11-17T05:00:00Z")], 1);
    expect(light(r).waiting).toBe(5);
    expect(full(r, desk).waiting).toBe(5);
  });
});

describe("what a school's visits do to the band's line", () => {
  it("leaves the visits out (the school's own card counts them), and nothing else", () => {
    const store: TodayData["store"] = { state: "ready", slots: "unknown", nextFree: null, visits: [{ id: "v", starts_at: "2026-11-19T05:30:00Z", who: "Anitha", extra: 0, topic: null, status: "confirmed", here: false }] } as unknown as TodayData["store"];
    const r = { ...raw([]), store };
    const shop = composeToday(r, { ...base, desk: NONE, counts: COUNTS });
    const school = composeToday(r, { ...base, desk: NONE, counts: COUNTS, campus: true });
    expect(briefOf(shop.data, shop.newLeads).facts.visits).toBe(1);
    expect(briefOf(school.data, school.newLeads).facts.visits).toBeNull();
  });
});
