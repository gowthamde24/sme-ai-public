import { afterEach, describe, expect, it, vi } from "vitest";

import { getStandup, markHref, parseDay, parseMark, parsePanel, parseStandup, putHelperSwitch } from "./ai-team";
import { aiTeamDayFixture, aiTeamPanelFixture, standupFixture } from "./ai-team-fixtures";

const T = "11111111-1111-4111-8111-111111111111";
const B = `/app/tenants/${T}`;
const ID = "55555555-5555-4555-8555-555555555555";
const MARK = { id: `phone_call:${ID}`, t: "2026-11-06T10:42:07+05:30", kind: "call", seconds: 84, label: "Ramesh K · interested", ref: { type: "lead", id: ID, href: null }, needs_owner: false };
afterEach(() => vi.unstubAllGlobals());
const stub = (status: number, body: unknown) => {
  const f = vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));
  vi.stubGlobal("fetch", f);
  return f;
};

describe("My AI team v2's contract (docs/contracts/ai-team.md)", () => {
  it("reads the made-up days of both kinds of business through the same parser", () => {
    const shop = parseDay(aiTeamDayFixture({ date: "2026-11-06" }));
    expect(shop.lanes.map((l) => l.helper)).toEqual(["lead_catcher", "lead_finder", "caller", "followups", "quote_writer", "order_desk"]);
    expect(shop.flow.steps.map((s) => s.key)).toEqual(["leads_in", "called", "interested", "quotes", "orders"]);
    expect(shop.needsOwnerTotal).toBe(shop.lanes.flatMap((l) => l.marks).filter((m) => m.needsOwner).length);
    const school = parseDay(aiTeamDayFixture({ school: true, date: "2026-11-06" }));
    expect(school.lanes.map((l) => l.helper)).toEqual(["lead_catcher", "caller", "followups", "admissions", "fee_reminders", "notices"]);
    expect(school.flow.extra.map((s) => s.key)).toEqual(["fees_collected"]);
    const past = parseDay(aiTeamDayFixture({ date: "2026-11-05", past: true }));
    expect(past.lanes.every((l) => l.statusNow === null && l.marks.every((m) => !m.needsOwner))).toBe(true);
  });
  it("a paused helper says so first, with what still waits for the owner", () => {
    const day = parseDay(aiTeamDayFixture({ date: "2026-11-06", paused: ["quote_writer"] }));
    const lane = day.lanes.find((l) => l.helper === "quote_writer")!;
    expect(lane.enabled).toBe(false);
    expect(lane.statusNow).toMatchObject({ kind: "paused", count: 1 });
  });
  it("is strict: an unknown helper, kind, ref type or a bad id is a contract error, never a guess", () => {
    expect(parseMark(MARK)).toMatchObject({ kind: "call", seconds: 84, ref: { type: "lead", id: ID }, needsOwner: false });
    for (const bad of [{ ...MARK, kind: "dance" }, { ...MARK, ref: { type: "invoice", id: ID } }, { ...MARK, ref: { type: "lead", id: "../x" } }, { ...MARK, t: "soon" }, { ...MARK, label: "" }, { ...MARK, seconds: -1 }]) expect(() => parseMark(bad)).toThrow();
    const day = aiTeamDayFixture({ date: "2026-11-06" });
    expect(() => parseDay({ ...day, lanes: [{ ...day.lanes[0], helper: "boss" }] })).toThrow();
    expect(() => parseDay({ ...day, lanes: [day.lanes[0], day.lanes[0]] })).toThrow();
    expect(() => parseDay({ ...day, date: "6 Nov" })).toThrow();
    expect(() => parseDay({ ...day, day: { opens: "9am", closes: "20:00" } })).toThrow();
    expect(() => parseDay({ ...day, lanes: [{ ...day.lanes[0], status_now: { ...day.lanes[2].status_now, kind: "sleeping" } }] })).toThrow();
  });
  it("keeps at most 200 marks a lane (the API's own cap)", () => {
    const day = aiTeamDayFixture({ date: "2026-11-06" });
    const many = Array.from({ length: 250 }, (_, i) => ({ ...MARK, id: `m:${i}` }));
    expect(parseDay({ ...day, lanes: [{ ...day.lanes[0], marks: many }] }).lanes[0].marks).toHaveLength(200);
  });
  it("the panel: numbers (with leads by source), the switch, its lock for Sales, settings links", () => {
    const owner = parsePanel(aiTeamPanelFixture({ helper: "lead_catcher", tenantId: T, date: "2026-11-06" }));
    expect(owner.canSwitch).toBe(true);
    expect(owner.today.numbers.find((n) => n.key === "by_source")?.bySource?.length).toBe(4);
    const sales = parsePanel(aiTeamPanelFixture({ helper: "caller", tenantId: T, date: "2026-11-06", role: "sales" }));
    expect(sales).toMatchObject({ canSwitch: false, reasonLocked: "owner_or_admin", costToday: null });
    expect(sales.settings[0].href).toBe(`${B}/settings?section=assistant`);
    expect(sales.recent.length).toBeLessThanOrEqual(10);
  });
  it("the stand-up: lines with their sources, the numbers spoken, Kannada marked draft", () => {
    const en = parseStandup(standupFixture({ date: "2026-11-06", language: "en" }));
    expect(en.lines.length).toBeGreaterThan(2);
    expect(en.draft).toBe(false);
    expect(en.audio?.seconds).toBeLessThanOrEqual(45);
    expect(parseStandup(standupFixture({ date: "2026-11-06", language: "kn" })).draft).toBe(true);
    expect(parseStandup(standupFixture({ date: "2026-11-06", language: "ta" })).language).toBe("en");
    // a school's stand-up has school words only (owner, 4 Nov: no shop words for a school)
    for (const language of ["en", "te", "hi", "kn"]) expect(parseStandup(standupFixture({ date: "2026-11-06", language, school: true })).text).not.toMatch(/Quote|Boutique|order|కోట్|कोट|ಕೋಟ್/i);
  });
  it("routes a mark by its ref type and id (the app's own pages), never by ref.href", () => {
    expect(markHref(B, { type: "lead", id: ID })).toBe(`${B}/leads/${ID}`);
    expect(markHref(B, { type: "quote", id: ID })).toBe(`${B}/quotes/${ID}`);
    expect(markHref(B, { type: "order", id: ID })).toBe(`${B}/orders/${ID}`);
    expect(markHref(B, { type: "student", id: ID })).toBe(`${B}/students/${ID}`);
    expect(markHref(B, { type: "admission", id: ID })).toBe(`${B}/admissions?admission=${ID}`);
    expect(markHref(B, { type: "call", id: ID })).toBe(`${B}/office/live?call=${ID}`);
    expect(markHref(B, { type: "lead", id: "x" })).toBeNull();
  });
  it("the switch PUTs exactly {enabled}; a stand-up not made yet is null", async () => {
    const f = stub(200, { helper: "caller", enabled: false });
    expect(await putHelperSwitch("tok", T, "caller", false)).toEqual({ helper: "caller", enabled: false });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(String(url)).toMatch(new RegExp(`/v1/tenants/${T}/ai-team/caller/switch$`));
    expect(init.method).toBe("PUT");
    expect(JSON.parse(String(init.body))).toEqual({ enabled: false });
    stub(404, { error: { code: "not_generated", message: "no" } });
    expect(await getStandup("tok", T, "2026-11-06", "te")).toBeNull();
    const g = stub(200, standupFixture({ date: "2026-11-06", language: "te" }));
    await getStandup("tok", T, "2026-11-06", "mr");
    expect(String((g.mock.calls[0] as unknown as [string])[0])).toMatch(/standup\?date=2026-11-06&language=en$/);
  });
});
