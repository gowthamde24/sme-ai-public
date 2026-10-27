import { describe, expect, it } from "vitest";

import { FRESH, MOCK_PACKS, buyPack, gstOf, mockPacks, mockTopups, mockUsage, parseMock, previewUpgrade, proRataPaise, rolled, setSettings, simulate, splitGst, upgrade, upgradeTargets, type MockState } from "./mock";

const NOW = new Date("2026-10-06T10:00:00+05:30");
const ID1 = "11111111-1111-4111-8111-111111111111";
const ID2 = "22222222-2222-4222-8222-222222222222";
const ID3 = "33333333-3333-4333-8333-333333333333";
const fresh = (over: Partial<MockState> = {}): MockState => ({ ...FRESH(NOW), ...over });
const settings = { autoMinutesPack: null, autoMessagesPack: null, autoMonthlyCapPaise: 0, overageMinutes: false, overageMessages: false, overageMonthlyCapPaise: 0 };

describe("the mock's own money maths (the API does these with TOPUP_SCREENS=1)", () => {
  it("GST rounds half up to the paise", () => {
    expect(gstOf(108000, 1800)).toBe(19440);
    expect(gstOf(1, 1800)).toBe(0); // 0.18
    expect(gstOf(3, 1800)).toBe(1); // 0.54 rounds up
    expect(gstOf(25, 1800)).toBe(5); // 4.5 rounds up
  });
  it("the same state splits GST in halves (CGST floor, SGST the rest), any other case is all IGST", () => {
    expect(splitGst(19441, true)).toEqual({ cgst: 9720, sgst: 9721, igst: 0 });
    expect(splitGst(19440, true)).toEqual({ cgst: 9720, sgst: 9720, igst: 0 });
    expect(splitGst(19440, false)).toEqual({ cgst: 0, sgst: 0, igst: 19440 });
  });
  it("pro-rata = difference x days left / days in the period, rounded half up", () => {
    expect(proRataPaise(149900, 399900, 11, 30)).toBe(91667); // 91666.67
    expect(proRataPaise(0, 1, 1, 2)).toBe(1); // 0.5 up
    expect(proRataPaise(0, 3, 1, 3)).toBe(1);
    expect(proRataPaise(100, 100, 10, 30)).toBe(0);
    expect(proRataPaise(500, 100, 10, 30)).toBe(0); // never negative
    expect(proRataPaise(0, 1000, 0, 30)).toBe(0);
  });
});

describe("the packs are DATA with test amounts", () => {
  it("six packs: +100, +300, +1,000 of each kind, every one marked as a placeholder price, GST added", () => {
    const packs = mockPacks();
    expect(packs.map((p) => [p.code, p.units])).toEqual([["minutes_100", 100], ["minutes_300", 300], ["minutes_1000", 1000], ["messages_100", 100], ["messages_300", 300], ["messages_1000", 1000]]);
    for (const p of packs) {
      expect(p.isPlaceholder).toBe(true);
      expect(p.totalPaise).toBe(p.pricePaise + p.gstPaise);
      expect(p.gstRateBp).toBe(1800);
    }
    expect(MOCK_PACKS).toHaveLength(6);
  });
});

describe("the meters", () => {
  it("a fresh workspace on the default plan is at about four fifths of its minutes, with the day it runs out at this pace", () => {
    const u = mockUsage(fresh(), null, NOW);
    expect(u.period).toEqual({ start: "2026-10-01", end: "2026-10-31", daysLeft: 26 });
    expect(u.minutes).toMatchObject({ used: 241.5, allowance: 300, percent: 80, state: "notice", included: true, planAllowance: 300, topupBalance: 0, projectedRunOutOn: "2026-10-07", runsOutBeforePeriodEnd: true, blocked: false, queued: 0 });
    expect(u.messages).toMatchObject({ used: 120, allowance: 300, percent: 40, state: "ok", projectedRunOutOn: "2026-10-14", runsOutBeforePeriodEnd: true });
    expect(u.queuedCalls).toBe(0);
  });
  it("79 percent is fine, 80 is a notice, 100 is stopped with 12 leads waiting", () => {
    const at = (um: number) => mockUsage(fresh({ um }), "calls_300", NOW).minutes;
    expect(at(237)).toMatchObject({ percent: 79, state: "ok" });
    expect(at(240)).toMatchObject({ percent: 80, state: "notice" });
    expect(at(299.9)).toMatchObject({ percent: 99, state: "notice" });
    expect(at(300)).toMatchObject({ percent: 100, state: "stopped", blocked: true, queued: 12, remaining: 0, projectedRunOutOn: null });
    expect(mockUsage(fresh({ um: 300 }), "calls_300", NOW).queuedCalls).toBe(12);
  });
  it("pay as you go has no ceiling: no percentage, never stopped", () => {
    const m = mockUsage(fresh({ um: 500 }), "calls_payg", NOW).minutes;
    expect(m).toMatchObject({ allowance: null, percent: null, state: "ok", included: true, blocked: false });
  });
  it("a plan that leaves messages out is 'not included' and stopped until a top-up", () => {
    // Starter includes 0 call minutes
    const m = mockUsage(fresh({ um: 0 }), "starter", NOW).minutes;
    expect(m).toMatchObject({ included: false, state: "stopped", blocked: true });
    const bought = buyPack(fresh({ um: 0 }), ID1, "minutes_100", NOW);
    expect("next" in bought && mockUsage(bought.next, "starter", NOW).minutes).toMatchObject({ included: true, allowance: 100, state: "ok" });
  });
  it("a new month starts the counts again and keeps the unused top-ups", () => {
    const s0 = (buyPack(fresh({ um: 300, ug: 10 }), ID1, "minutes_300", NOW) as { next: MockState }).next;
    const later = new Date("2026-11-03T10:00:00+05:30");
    const rolledState = rolled(s0, later);
    expect(rolledState.ps).toBe("2026-11-01");
    expect(rolledState.um).toBe(0);
    const u = mockUsage(s0, "calls_300", later);
    expect(u.period.start).toBe("2026-11-01");
    expect(u.minutes).toMatchObject({ used: 0, allowance: 600, topupBalance: 300, percent: 0, state: "ok" });
  });
});

describe("buying a pack", () => {
  it("adds the units at once: the queue is gone and the state is fine again", () => {
    const before = fresh({ um: 300 });
    expect(mockUsage(before, "calls_300", NOW).minutes.state).toBe("stopped");
    const out = buyPack(before, ID1, "minutes_100", NOW);
    expect("next" in out).toBe(true);
    if (!("next" in out)) return;
    const m = mockUsage(out.next, "calls_300", NOW).minutes;
    expect(m).toMatchObject({ allowance: 400, remaining: 100, state: "ok", blocked: false, queued: 0, topupBalance: 100 });
    expect(m.nextTopupExpiry).toBe("2027-01-04"); // 90 days after 6 Oct
  });
  it("the same purchase id with the same pack changes nothing; with another pack it is a conflict; an unknown pack or id is refused", () => {
    const once = (buyPack(fresh(), ID1, "minutes_100", NOW) as { next: MockState }).next;
    const twice = buyPack(once, ID1, "minutes_100", NOW);
    expect(twice).toEqual({ next: once });
    expect(buyPack(once, ID1, "minutes_300", NOW)).toEqual({ error: "conflict" });
    expect(buyPack(once, ID2, "minutes_7", NOW)).toEqual({ error: "pack_unknown" });
    expect(buyPack(once, "not-a-uuid", "minutes_100", NOW)).toEqual({ error: "invalid" });
  });
  it("uses the plan's allowance first, then the OLDEST top-up", () => {
    let s = fresh({ um: 0 });
    s = (buyPack(s, ID1, "minutes_100", new Date("2026-10-01T10:00:00+05:30")) as { next: MockState }).next;
    s = (buyPack(s, ID2, "minutes_300", new Date("2026-10-02T10:00:00+05:30")) as { next: MockState }).next;
    // used 350: plan 300 gone, 50 drawn from the oldest pack (the +100)
    const t = mockTopups({ ...s, um: 350 }, "calls_300", NOW);
    expect(t.balance.call_minutes.units).toBe(350);
    expect(t.balance.call_minutes.lots.map((l) => [l.purchaseId, l.unitsLeft])).toEqual([[ID1, 50], [ID2, 300]]);
    // used 450: the oldest pack is used up, 50 drawn from the next
    const u = mockTopups({ ...s, um: 450 }, "calls_300", NOW);
    expect(u.balance.call_minutes.lots.map((l) => [l.purchaseId, l.unitsLeft])).toEqual([[ID2, 250]]);
    expect(u.history.map((h) => [h.id, h.unitsLeft])).toEqual([[ID2, 250], [ID1, 0]]);
  });
  it("unused top-up units expire 90 days after purchase", () => {
    const s = (buyPack(fresh(), ID1, "minutes_100", new Date("2026-07-10T10:00:00+05:30")) as { next: MockState }).next;
    const live = mockUsage({ ...s, ps: "2026-10-01", um: 10 }, "calls_300", new Date("2026-10-07T10:00:00+05:30")).minutes; // 89 days later
    expect(live.topupBalance).toBe(100);
    const gone = mockUsage({ ...s, ps: "2026-10-01", um: 10 }, "calls_300", new Date("2026-10-09T10:00:00+05:30")).minutes; // 91 days later
    expect(gone).toMatchObject({ topupBalance: 0, allowance: 300, nextTopupExpiry: null });
  });
  it("keeps the newest eight purchases (the cookie is small on purpose) and numbers the invoices one by one", () => {
    let s = fresh();
    for (let i = 1; i <= 10; i++) s = (buyPack(s, `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`, "messages_100", NOW) as { next: MockState }).next;
    expect(s.lots).toHaveLength(8);
    expect(s.n).toBe(10);
    const t = mockTopups(s, "calls_300", NOW);
    expect(t.invoices[0].number).toMatch(/^S19-2610-0000(10|09)$/);
    expect(t.invoices.every((i) => i.fake && i.paymentStatus === "paid_fake")).toBe(true);
  });
  it("an invoice carries the GST fields: IGST when no GSTIN is set", () => {
    const s = (buyPack(fresh(), ID1, "minutes_300", NOW) as { next: MockState }).next;
    const inv = mockTopups(s, "calls_300", NOW).invoices[0];
    expect(inv).toMatchObject({ kind: "topup", taxablePaise: 108000, gstRateBp: 1800, cgstPaise: 0, sgstPaise: 0, igstPaise: 19440, totalPaise: 127440, buyerGstin: null });
  });
});

describe("overage", () => {
  const on = { ...fresh({ um: 300 }), om: true, ocap: 10000 };
  it("a used-up meter reads 'notice' while the cap is not reached, and 'stopped' once it is", () => {
    expect(mockUsage(on, "calls_300", NOW).minutes).toMatchObject({ state: "notice", blocked: false, queued: 0, overage: { enabled: true, units: 0, spentPaise: 0, capPaise: 10000, ratePaisePerUnit: 500 } });
    expect(mockUsage({ ...on, um: 310 }, "calls_300", NOW).minutes).toMatchObject({ state: "notice", overage: { units: 10, spentPaise: 5000 } });
    expect(mockUsage({ ...on, um: 320 }, "calls_300", NOW).minutes).toMatchObject({ state: "stopped", blocked: true, queued: 12, overage: { spentPaise: 10000 } });
    expect(mockUsage({ ...on, um: 400 }, "calls_300", NOW).minutes.overage?.spentPaise).toBe(10000); // never past the cap
  });
  it("is off by default", () => {
    expect(mockUsage(fresh(), "calls_300", NOW).minutes.overage).toBeNull();
    expect(mockTopups(fresh(), "calls_300", NOW).settings).toMatchObject({ overageMinutes: false, overageMessages: false, autoMinutesPack: null, autoMessagesPack: null, autoMonthlyCapPaise: 0, overageMonthlyCapPaise: 0 });
  });
});

describe("the settings", () => {
  it("saves a valid set; overage and auto top-up each need a monthly limit above zero", () => {
    const out = setSettings(fresh(), { ...settings, autoMinutesPack: "minutes_100", autoMonthlyCapPaise: 200000, overageMessages: true, overageMonthlyCapPaise: 50000 }, NOW);
    expect(out).toMatchObject({ next: { am: "minutes_100", acap: 200000, og: true, ocap: 50000 } });
    expect(setSettings(fresh(), { ...settings, overageMinutes: true }, NOW)).toEqual({ error: "cap_required" });
    expect(setSettings(fresh(), { ...settings, autoMinutesPack: "minutes_100" }, NOW)).toEqual({ error: "cap_required" });
  });
  it("refuses an unknown pack, a pack of the wrong kind and a bad cap", () => {
    expect(setSettings(fresh(), { ...settings, autoMinutesPack: "minutes_5", autoMonthlyCapPaise: 1 }, NOW)).toEqual({ error: "pack_unknown" });
    expect(setSettings(fresh(), { ...settings, autoMinutesPack: "messages_100", autoMonthlyCapPaise: 1000 }, NOW)).toEqual({ error: "invalid" });
    expect(setSettings(fresh(), { ...settings, autoMonthlyCapPaise: -5 }, NOW)).toEqual({ error: "invalid" });
    expect(setSettings(fresh(), { ...settings, overageMonthlyCapPaise: 1.5 }, NOW)).toEqual({ error: "invalid" });
  });
});

describe("upgrading in the middle of the month", () => {
  const MID = new Date("2026-10-20T10:00:00+05:30"); // 12 days left of 31
  it("only to a plan after the current one on the list", () => {
    expect(upgradeTargets("calls_300").map((p) => p.id)).toEqual(["calls_1000"]);
    expect(upgradeTargets("calls_1000")).toEqual([]);
    expect(upgradeTargets("starter").map((p) => p.id)).toEqual(["growth", "business", "calls_payg", "calls_300", "calls_1000"]);
    expect(upgradeTargets(null).length).toBe(6);
  });
  it("previews the pro-rata difference with GST, the new allowances and 'now'", () => {
    const p = previewUpgrade(fresh(), "calls_300", "calls_1000", MID);
    expect(p).toEqual({ fromPlanId: "calls_300", toPlanId: "calls_1000", priceSet: true, daysInPeriod: 31, daysLeft: 12, proratedPaise: proRataPaise(149900, 399900, 12, 31), gstPaise: gstOf(proRataPaise(149900, 399900, 12, 31), 1800), totalPaise: proRataPaise(149900, 399900, 12, 31) + gstOf(proRataPaise(149900, 399900, 12, 31), 1800), newAllowances: { callMinutes: 1000, messages: 1000 }, effective: "now" });
  });
  it("says the price is not set when a plan has no test amount (pay as you go)", () => {
    const p = previewUpgrade(fresh(), "starter", "calls_payg", MID);
    expect(p).toMatchObject({ priceSet: false, proratedPaise: null, gstPaise: null, totalPaise: null });
  });
  it("refuses a plan that is not a step up", () => {
    expect(previewUpgrade(fresh(), "calls_1000", "calls_300", MID)).toEqual({ error: "not_an_upgrade" });
    expect(previewUpgrade(fresh(), "calls_300", "nope", MID)).toEqual({ error: "not_an_upgrade" });
  });
  it("the new allowance applies at once, the period does not move, an upgrade invoice is recorded", () => {
    const base = fresh({ um: 300, ps: "2026-10-01" });
    expect(mockUsage(base, "calls_300", MID).minutes.state).toBe("stopped");
    const out = upgrade(base, "calls_300", "calls_1000", MID);
    expect("next" in out).toBe(true);
    if (!("next" in out)) return;
    const u = mockUsage(out.next, "calls_300", MID);
    expect(u.minutes).toMatchObject({ allowance: 1000, used: 300, state: "ok", queued: 0 });
    expect(u.period.end).toBe("2026-10-31");
    const inv = mockTopups(out.next, "calls_300", MID).invoices;
    expect(inv).toHaveLength(1);
    expect(inv[0]).toMatchObject({ kind: "upgrade", fake: true });
    expect(inv[0].totalPaise).toBe(inv[0].taxablePaise + inv[0].igstPaise);
  });
});

describe("test controls", () => {
  it("sets the usage to a percentage of each allowance; 0 starts a new month; anything else is refused", () => {
    const o = simulate(fresh(), "calls_300", 100, NOW);
    expect("next" in o && mockUsage(o.next, "calls_300", NOW).minutes).toMatchObject({ used: 300, state: "stopped" });
    const z = simulate(fresh({ um: 250 }), "calls_300", 0, NOW);
    expect("next" in z && z.next.um).toBe(0);
    expect(simulate(fresh(), "calls_300", 37, NOW)).toEqual({ error: "invalid" });
  });
  it("at 100 percent the auto top-up buys its pack, but only inside the monthly limit", () => {
    const withAuto = { ...fresh(), am: "minutes_100", acap: 100000 }; // 100 minutes cost 47,200 with GST
    const a = simulate(withAuto, "calls_300", 100, NOW);
    expect("next" in a && a.next.lots.map((l) => [l.c, l.r])).toEqual([["minutes_100", "a"]]);
    expect("next" in a && a.next.aspent).toBe(47200);
    expect("next" in a && mockTopups(a.next, "calls_300", NOW).history[0]).toMatchObject({ source: "auto", totalPaise: 47200 });
    const tooSmall = simulate({ ...withAuto, acap: 40000 }, "calls_300", 100, NOW);
    expect("next" in tooSmall && tooSmall.next.lots).toEqual([]);
    const off = simulate(fresh(), "calls_300", 100, NOW);
    expect("next" in off && off.next.lots).toEqual([]);
  });
});

describe("the cookie is never trusted", () => {
  it("anything that does not fit is dropped or the whole thing is read as fresh", () => {
    expect(parseMock(null, NOW)).toBeNull();
    expect(parseMock({ v: 2 }, NOW)).toBeNull();
    const s = parseMock({ v: 1, ps: "x", um: -4, ug: "9", plan: "hacker", lots: [{ i: "no", c: "minutes_100", t: "2026-10-01T00:00:00Z", r: "m", n: 1 }, { i: ID1, c: "nope", t: "2026-10-01T00:00:00Z", r: "m", n: 1 }, { i: ID2, c: "minutes_100", t: "2026-10-01T00:00:00Z", r: "x", n: 1 }, { i: ID3, c: "minutes_100", t: "2026-10-01T00:00:00Z", r: "m", n: 1 }], ups: [{ p: "calls_300", t: "bad", n: 1, x: 1 }], am: "messages_100", acap: 1e12, om: "yes" }, NOW);
    expect(s).toMatchObject({ ps: "2026-10-01", um: null, ug: null, plan: null, am: null, acap: 0, om: false });
    expect(s?.lots.map((l) => l.i)).toEqual([ID3]);
    expect(s?.ups).toEqual([]);
  });
  it("a state with eight purchases and three upgrades stays well under the cookie limit", () => {
    const lot = { i: ID1, c: "messages_1000", t: "2026-10-06T04:30:00Z", r: "a" as const, n: 99999 };
    const s: MockState = { ...fresh(), lots: Array(8).fill(lot), ups: Array(3).fill({ p: "calls_1000", t: "2026-10-06T04:30:00Z", n: 99999, x: 99999999 }), plan: "calls_1000", um: 99999.5, ug: 99999.5, am: "minutes_1000", ag: "messages_1000", acap: 100000000, aspent: 100000000, om: true, og: true, ocap: 100000000 };
    expect(JSON.stringify(s).length).toBeLessThan(3500);
  });
});
