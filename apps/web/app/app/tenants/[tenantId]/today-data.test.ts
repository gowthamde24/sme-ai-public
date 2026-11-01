import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiAuthError, ApiRequestError } from "@/lib/api/client";
import { parseCallRequestPage, parseOutboxPage } from "@/lib/api/outbox";
import { CALL_JSON, PRICE_JSON, page } from "@/lib/api/outbox-fixtures";
import { agentsStatus, todayFor } from "@/test/screens/today-fixtures";
import { TODAY_VISITS, parseVisitFixture, slotsJson, visitJson } from "@/lib/api/visits-fixtures";

const getToday = vi.fn();
const getAgentsStatus = vi.fn();
const listOutboxApprovals = vi.fn();
const listCallRequests = vi.fn();
const listOutboxMessages = vi.fn();
const fetchQuotes = vi.fn();
vi.mock("@/lib/api/today", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/api/today")>()), getToday: (...a: unknown[]) => getToday(...a), getAgentsStatus: (...a: unknown[]) => getAgentsStatus(...a) }));
vi.mock("@/lib/api/outbox", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/outbox")>()),
  listOutboxApprovals: (...a: unknown[]) => listOutboxApprovals(...a),
  listCallRequests: (...a: unknown[]) => listCallRequests(...a),
  listOutboxMessages: (...a: unknown[]) => listOutboxMessages(...a),
  getOutboxSettings: (...a: unknown[]) => getOutboxSettings(...a),
}));
const getTodayVisits = vi.fn();
const getSlots = vi.fn();
const listVisits = vi.fn();
const getAiUsageWeek = vi.fn();
const getOutboxSettings = vi.fn();
vi.mock("@/lib/api/visits", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/visits")>()),
  getTodayVisits: (...a: unknown[]) => getTodayVisits(...a),
  getSlots: (...a: unknown[]) => getSlots(...a),
  listVisits: (...a: unknown[]) => listVisits(...a),
  getAiUsageWeek: (...a: unknown[]) => getAiUsageWeek(...a),
}));
vi.mock("@/lib/api/quotes", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/api/quotes")>()), fetchQuotes: (...a: unknown[]) => fetchQuotes(...a), fetchQuote: async () => { throw new ApiRequestError(500, "api_error", "x"); } }));

const readMyProfileCached = vi.fn();
const fetchMembers = vi.fn();
vi.mock("../../me-read", () => ({ readMyProfileCached: (...a: unknown[]) => readMyProfileCached(...a) }));
vi.mock("@/lib/api/orders", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/api/orders")>()), fetchMembers: (...a: unknown[]) => fetchMembers(...a) }));

import { readDisplayName, readToday } from "./today-data";

const T = "22222222-2222-4222-8222-222222222222";

beforeEach(() => {
  vi.clearAllMocks();
  getToday.mockResolvedValue(todayFor("owner"));
  getAgentsStatus.mockResolvedValue(agentsStatus());
  listOutboxApprovals.mockResolvedValue(parseOutboxPage(page([PRICE_JSON])));
  listCallRequests.mockResolvedValue(parseCallRequestPage(page([CALL_JSON])));
  listOutboxMessages.mockResolvedValue(parseOutboxPage(page([])));
  fetchQuotes.mockResolvedValue([]);
  getTodayVisits.mockResolvedValue({ date: "2026-10-11", items: TODAY_VISITS });
  getSlots.mockResolvedValue(slotsJson("2026-10-11"));
  listVisits.mockResolvedValue({ from: "2026-10-11", to: "2026-12-11", items: [] });
  getOutboxSettings.mockResolvedValue({ platform_switch_on: true, auto_send_enabled: true, per_customer_daily_limit: 3 });
  getAiUsageWeek.mockResolvedValue({ week_percent: 12, resets_at_week: "2026-10-18T18:30:00Z" });
});

describe("readToday: the cards", () => {
  it("makes one card per item in the API's order, with the words of a message and the reason of a call joined by id", async () => {
    const data = await readToday("tok", T, "owner");
    expect(data.needs?.map((c) => c.type)).toEqual(["outbox", "call", "item", "item", "item"]);
    const [message, request] = data.needs!;
    expect(message).toMatchObject({ type: "outbox", id: PRICE_JSON.id, customer: "Synthetic Buyer", message: { language: "te", flags: ["money"], category: "reply_to_inbound" } });
    expect(request).toMatchObject({ type: "call", request: { reason: CALL_JSON.reason, language: CALL_JSON.language } });
    expect(data.cards.waiting).toBe(5);
  });
  it("a card whose words are not in the queue still appears, without them", async () => {
    listOutboxApprovals.mockResolvedValue(parseOutboxPage(page([])));
    listCallRequests.mockRejectedValue(new ApiRequestError(500, "api_error", "x"));
    const data = await readToday("tok", T, "owner");
    expect(data.needs?.[0]).toMatchObject({ type: "outbox", message: null });
    expect(data.needs?.[1]).toMatchObject({ type: "call", request: null });
  });
  it("an empty customer name (a lead with no company) becomes null", async () => {
    getToday.mockResolvedValue({ ...todayFor("owner"), needs_you: [{ ...todayFor("owner").needs_you[0], customer: "" }] });
    expect((await readToday("tok", T, "owner")).needs?.[0]).toMatchObject({ customer: null });
  });
  it("Today unreadable: needs is null, the team is still read", async () => {
    getToday.mockRejectedValue(new ApiRequestError(500, "api_error", "x"));
    const data = await readToday("tok", T, "owner");
    expect(data.needs).toBeNull();
    expect(data.team).toHaveLength(7);
    expect(listOutboxApprovals).not.toHaveBeenCalled();
  });
  it("a rejected session is thrown so the page can send the person to sign in, from any of the reads", async () => {
    getToday.mockRejectedValue(new ApiAuthError("x"));
    await expect(readToday("tok", T, "owner")).rejects.toThrow(ApiAuthError);
    getToday.mockResolvedValue(todayFor("owner"));
    listOutboxApprovals.mockRejectedValue(new ApiAuthError("x"));
    await expect(readToday("tok", T, "owner")).rejects.toThrow(ApiAuthError);
  });
});

describe("readToday: the outbox log", () => {
  it("starts reading it at once as one promise that never rejects", async () => {
    listOutboxMessages.mockRejectedValue(new ApiRequestError(500, "api_error", "x"));
    const data = await readToday("tok", T, "owner");
    await expect(data.digest).resolves.toEqual({ state: "error" });
  });
  it("is not asked for a Viewer", async () => {
    getToday.mockResolvedValue(todayFor("viewer"));
    const data = await readToday("tok", T, "viewer");
    expect(data.digest).toBeNull();
    expect(listOutboxMessages).not.toHaveBeenCalled();
  });
});


const NOW = Date.parse("2026-10-11T05:00:00Z"); // 10:30 in India, Sunday 11 October
const clock = () => NOW;

describe("readToday: at the store today", () => {
  it("reads today's visits and the first free time still to come", async () => {
    getSlots.mockResolvedValue({ ...slotsJson("2026-10-11"), slots: slotsJson("2026-10-11").slots.map((s, i) => ({ ...s, free: i < 2 ? 0 : 2, past: i < 1 })) });
    const data = await readToday("tok", T, "owner", clock);
    expect(getTodayVisits).toHaveBeenCalledWith("tok", T);
    expect(getSlots).toHaveBeenCalledWith("tok", T, "2026-10-11");
    expect(data.store).toMatchObject({ state: "ready", slots: "free", nextFree: slotsJson("2026-10-11").slots[2].starts_at });
    expect(data.store && data.store.state === "ready" && data.store.visits.map((v) => [v.who, v.status, v.here])).toEqual([["Anita R.", "requested", false], ["Priya S.", "confirmed", false], ["Lakshmi Textiles", "reminder_sent", false]]);
  });
  it("a customer who has arrived is 'here'", async () => {
    getTodayVisits.mockResolvedValue({ date: "2026-10-11", items: [{ ...TODAY_VISITS[1], visit_status: "arrived" }] });
    const data = await readToday("tok", T, "owner", clock);
    expect(data.store && data.store.state === "ready" && data.store.visits[0].here).toBe(true);
  });
  it("the rest of the day: full, closed, or unknown when the slots cannot be read", async () => {
    getSlots.mockResolvedValue({ ...slotsJson("2026-10-11"), slots: slotsJson("2026-10-11").slots.map((s) => ({ ...s, free: 0 })) });
    expect((await readToday("tok", T, "owner", clock)).store).toMatchObject({ slots: "full", nextFree: null });
    getSlots.mockResolvedValue({ ...slotsJson("2026-10-11"), open: false, reason: "closed_date", slots: [] });
    expect((await readToday("tok", T, "owner", clock)).store).toMatchObject({ slots: "closed" });
    getSlots.mockRejectedValue(new ApiRequestError(500, "api_error", "x"));
    expect((await readToday("tok", T, "owner", clock)).store).toMatchObject({ state: "ready", slots: "unknown", nextFree: null });
  });
  it("visits that cannot be read are an error state, not an empty day", async () => {
    getTodayVisits.mockRejectedValue(new ApiRequestError(500, "api_error", "x"));
    expect((await readToday("tok", T, "owner", clock)).store).toEqual({ state: "error" });
  });
  it("any role is asked, a Viewer too (every member reads the visits)", async () => {
    getToday.mockResolvedValue(todayFor("viewer"));
    const data = await readToday("tok", T, "viewer", clock);
    expect(getTodayVisits).toHaveBeenCalled();
    expect(data.store).toMatchObject({ state: "ready" });
  });
  it("a rejected session is thrown", async () => {
    getTodayVisits.mockRejectedValue(new ApiAuthError("x"));
    await expect(readToday("tok", T, "owner", clock)).rejects.toThrow(ApiAuthError);
  });
});

describe("readToday: a visit your assistant proposed", () => {
  const proposal = (id: string, over: Record<string, unknown> = {}) => parseVisitFixture(visitJson({ id, source: "assistant", status: "booked", ...over }));
  it("asks for the booked visits of the next two months and makes a card of each one the assistant proposed, newest first", async () => {
    getToday.mockResolvedValue({ ...todayFor("owner"), cards: { ...todayFor("owner").cards, waiting: 7 } }); // the API's own number already counts the two proposed visits (job AY)
    listVisits.mockResolvedValue({
      from: "2026-10-11",
      to: "2026-12-11",
      items: [
        proposal("aaaaaaaa-1111-4111-8111-000000000001", { created_at: "2026-10-10T08:00:00Z" }),
        proposal("aaaaaaaa-1111-4111-8111-000000000002", { created_at: "2026-10-11T02:00:00Z", who: "Meera K.", party_size: 1, purpose: null }),
        parseVisitFixture(visitJson({ id: "aaaaaaaa-1111-4111-8111-000000000003", source: "staff", status: "booked" })),
      ],
    });
    const data = await readToday("tok", T, "owner", clock);
    expect(listVisits).toHaveBeenCalledWith("tok", T, { from: "2026-10-11", to: "2026-12-11", status: "booked" });
    const visits = data.needs!.filter((c) => c.type === "visit");
    expect(visits.map((c) => c.type === "visit" && c.visit.who)).toEqual(["Meera K.", "Priya S."]);
    expect(data.needs!.slice(-2).map((c) => c.type)).toEqual(["visit", "visit"]); // after the API's own items
    expect(visits[0]).toMatchObject({ key: "visit-aaaaaaaa-1111-4111-8111-000000000002", at: "2026-10-11T02:00:00Z", id: "aaaaaaaa-1111-4111-8111-000000000002", visit: { partySize: 1, purpose: null, startsAt: "2026-10-14T05:00:00Z" } });
    expect(data.cards.waiting).toBe(7); // the API's number, untouched
  });
  it("never adds its own count of proposed visits to the API's: 5 stays 5 even with two cards drawn (no double count)", async () => {
    listVisits.mockResolvedValue({ from: "2026-10-11", to: "2026-12-11", items: [proposal("aaaaaaaa-1111-4111-8111-000000000001"), proposal("aaaaaaaa-1111-4111-8111-000000000002")] });
    const data = await readToday("tok", T, "owner", clock);
    expect(data.needs!.filter((c) => c.type === "visit")).toHaveLength(2);
    expect(data.cards.waiting).toBe(5);
  });
  it("is not asked for a Viewer, and a failed read draws no card (it never says 'nothing' for what it could not read)", async () => {
    getToday.mockResolvedValue(todayFor("viewer"));
    await readToday("tok", T, "viewer", clock);
    expect(listVisits).not.toHaveBeenCalled();
    getToday.mockResolvedValue(todayFor("owner"));
    listVisits.mockRejectedValue(new ApiRequestError(500, "api_error", "x"));
    const data = await readToday("tok", T, "owner", clock);
    expect(data.needs!.some((c) => c.type === "visit")).toBe(false);
    expect(data.cards.waiting).toBe(5);
  });
});

describe("readToday: this week's AI figure", () => {
  it("is read for the Owner and the Admin as a percentage only", async () => {
    expect((await readToday("tok", T, "owner", clock)).week).toEqual({ percent: 12 });
    expect((await readToday("tok", T, "admin", clock)).week).toEqual({ percent: 12 });
    expect(getAiUsageWeek).toHaveBeenCalledWith("tok", T);
  });
  it("is not asked for Sales or a Viewer", async () => {
    getToday.mockResolvedValue(todayFor("sales"));
    expect((await readToday("tok", T, "sales", clock)).week).toBeNull();
    expect((await readToday("tok", T, "viewer", clock)).week).toBeNull();
    expect(getAiUsageWeek).not.toHaveBeenCalled();
  });
  it("a figure that cannot be read is 'error', never another window's number", async () => {
    getAiUsageWeek.mockRejectedValue(new ApiRequestError(500, "api_error", "x"));
    expect((await readToday("tok", T, "owner", clock)).week).toBe("error");
  });
});


describe("readToday: is sending stopped?", () => {
  it("Owner and Admin read the system switch; stopped is true when it is off", async () => {
    expect((await readToday("tok", T, "owner", clock)).sending).toEqual({ stopped: false });
    getOutboxSettings.mockResolvedValue({ platform_switch_on: false, auto_send_enabled: true, per_customer_daily_limit: 3 });
    expect((await readToday("tok", T, "admin", clock)).sending).toEqual({ stopped: true });
    expect(getOutboxSettings).toHaveBeenCalledWith("tok", T);
  });
  it("is not asked for Sales or a Viewer", async () => {
    getToday.mockResolvedValue(todayFor("sales"));
    expect((await readToday("tok", T, "sales", clock)).sending).toBeNull();
    expect((await readToday("tok", T, "viewer", clock)).sending).toBeNull();
    expect(getOutboxSettings).not.toHaveBeenCalled();
  });
  it("a read that fails draws no banner, and a rejected session is thrown", async () => {
    getOutboxSettings.mockRejectedValue(new ApiRequestError(500, "api_error", "x"));
    expect((await readToday("tok", T, "owner", clock)).sending).toBeNull();
    getOutboxSettings.mockRejectedValue(new ApiAuthError("x"));
    await expect(readToday("tok", T, "owner", clock)).rejects.toThrow(ApiAuthError);
  });
});

describe("readDisplayName: the greeting's name", () => {
  beforeEach(() => {
    readMyProfileCached.mockReset();
    fetchMembers.mockReset();
  });
  it("is the name in My profile, even when the members list has none", async () => {
    readMyProfileCached.mockResolvedValue({ displayName: "  Gowtham Reddy " });
    fetchMembers.mockResolvedValue([{ user_id: "u1", display_name: null }]);
    expect(await readDisplayName("tok", T, "u1")).toBe("Gowtham Reddy");
    expect(fetchMembers).not.toHaveBeenCalled();
  });
  it("is what the person asked to be called, before their full name", async () => {
    readMyProfileCached.mockResolvedValue({ displayName: "Lakshmi Prasad", addressAs: "Lakshmi" });
    expect(await readDisplayName("tok", T, "u1")).toBe("Lakshmi");
    readMyProfileCached.mockResolvedValue({ displayName: "Lakshmi Prasad", addressAs: "" });
    expect(await readDisplayName("tok", T, "u1")).toBe("Lakshmi Prasad");
  });
  it("falls back to the members list when My profile has no name or cannot be read", async () => {
    fetchMembers.mockResolvedValue([{ user_id: "u1", display_name: "Asha" }]);
    readMyProfileCached.mockResolvedValue({ displayName: null });
    expect(await readDisplayName("tok", T, "u1")).toBe("Asha");
    readMyProfileCached.mockRejectedValue(new ApiRequestError(500, "api_error", "x"));
    expect(await readDisplayName("tok", T, "u1")).toBe("Asha");
  });
  it("is null when neither knows the name, and a rejected session still throws", async () => {
    readMyProfileCached.mockResolvedValue({ displayName: " " });
    fetchMembers.mockResolvedValue([]);
    expect(await readDisplayName("tok", T, "u1")).toBeNull();
    readMyProfileCached.mockRejectedValue(new ApiAuthError("x"));
    await expect(readDisplayName("tok", T, "u1")).rejects.toThrow(ApiAuthError);
  });
});
