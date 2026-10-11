import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiContractError } from "./client";

const apiRequest = vi.fn();
vi.mock("./client", async (importOriginal) => ({ ...(await importOriginal<typeof import("./client")>()), apiRequest: (...a: unknown[]) => apiRequest(...a) }));

import {
  bookVisit,
  changeVisit,
  completeVisit,
  getAiUsageWeek,
  getSlots,
  getTodayVisits,
  getVisitSettings,
  listVisits,
  offerStoreVisit,
  parseSettings,
  parseSlots,
  parseTodayVisits,
  parseVisit,
  putVisitSettings,
  stepVisit,
} from "./visits";
import { LEAD_A, SETTINGS, TODAY_VISITS, VISIT_1, slotsJson, visitJson } from "./visits-fixtures";

const TENANT = "22222222-2222-4222-8222-222222222222";
const base = `/v1/tenants/${TENANT}`;
const ORDER = "c9dcf181-dc56-4bee-acf1-3845a5eebede";

beforeEach(() => vi.clearAllMocks());

describe("parsing a visit as the API sends it", () => {
  it("reads every field the screens use", () => {
    expect(parseVisit(visitJson())).toMatchObject({ id: VISIT_1, who: "Priya S.", date: "2026-10-14", party_size: 3, purpose: "Bridal sarees", status: "booked", source: "staff", outcome: null, advance_paise: null });
  });
  it("reads an assistant's proposal and an advance", () => {
    expect(parseVisit(visitJson({ source: "assistant", advance_requested: true, advance_paise: 50000 }))).toMatchObject({ source: "assistant", advance_paise: 50000 });
  });
  it("carries no phone number, e-mail or contact id", () => {
    expect(Object.keys(parseVisit(visitJson())).join(" ")).not.toMatch(/phone|email|contact_id|number/i);
  });
  it.each([
    ["status", "approved"], ["source", "robot"], ["outcome", "maybe"], ["party_size", 0], ["party_size", 51], ["party_size", 1.5], ["id", "x"], ["lead_id", 5], ["who", ""], ["date", "14/10/2026"],
    ["starts_at", "soon"], ["advance_paise", 0], ["advance_paise", "5"], ["confirmation_sent", "yes"], ["order_id", "nope"], ["customer", 5],
  ])("a visit with %s = %j is a contract error", (key, value) => {
    expect(() => parseVisit(visitJson({ [key]: value }))).toThrow(ApiContractError);
  });
  it("a customer and a city may be null", () => {
    expect(parseVisit(visitJson({ customer: null, city: null, contact_name: null }))).toMatchObject({ customer: null, city: null });
  });
});

describe("parsing the other answers", () => {
  it("reads the Today list with its three statuses", () => {
    const out = parseTodayVisits({ date: "2026-10-14", items: TODAY_VISITS });
    expect(out.items.map((v) => v.status)).toEqual(["requested", "confirmed", "reminder_sent"]);
    expect(() => parseTodayVisits({ date: "2026-10-14", items: [{ ...TODAY_VISITS[0], status: "booked" }] })).toThrow(ApiContractError);
    expect(() => parseTodayVisits({ date: "2026-10-14", items: [{ ...TODAY_VISITS[0], extra: -1 }] })).toThrow(ApiContractError);
    expect(() => parseTodayVisits({ date: "2026-10-14", items: "no" })).toThrow(ApiContractError);
  });
  it("reads the slots of a day, and a closed day with its reason", () => {
    expect(parseSlots(slotsJson()).slots).toHaveLength(21);
    expect(parseSlots({ date: "2026-10-20", open: false, reason: "closed_date", slot_minutes: 30, max_parallel: 2, slots: [] })).toMatchObject({ open: false, reason: "closed_date", slots: [] });
    expect(() => parseSlots({ ...slotsJson(), slots: [{ ...slotsJson().slots[0], start: "10am" }] })).toThrow(ApiContractError);
    expect(() => parseSlots({ ...slotsJson(), slots: [{ ...slotsJson().slots[0], free: -1 }] })).toThrow(ApiContractError);
  });
  it("reads the hours: a closed day is null, a close of 24:00 is allowed", () => {
    expect(parseSettings(SETTINGS).weekly_hours.sun).toBeNull();
    expect(parseSettings({ ...SETTINGS, weekly_hours: { ...SETTINGS.weekly_hours, sat: { open: "09:00", close: "24:00" } } }).weekly_hours.sat).toEqual({ open: "09:00", close: "24:00" });
    expect(() => parseSettings({ ...SETTINGS, weekly_hours: { ...SETTINGS.weekly_hours, sat: { open: "9:00", close: "20:00" } } })).toThrow(ApiContractError);
    const { mon: _gone, ...short } = SETTINGS.weekly_hours;
    void _gone;
    expect(() => parseSettings({ ...SETTINGS, weekly_hours: short })).toThrow(ApiContractError);
    expect(() => parseSettings({ ...SETTINGS, closed_dates: ["tomorrow"] })).toThrow(ApiContractError);
  });
});

describe("the calls", () => {
  it("reads today's visits", async () => {
    apiRequest.mockResolvedValue({ date: "2026-10-14", items: TODAY_VISITS });
    expect((await getTodayVisits("tok", TENANT)).items).toHaveLength(3);
    expect(apiRequest).toHaveBeenCalledWith(`${base}/visits/today`, "tok");
  });
  it("lists a range of dates with an optional status and lead", async () => {
    apiRequest.mockResolvedValue({ from: "2026-10-14", to: "2026-10-14", items: [visitJson()] });
    await listVisits("tok", TENANT, { from: "2026-10-14", to: "2026-10-14", status: "booked", leadId: LEAD_A });
    expect(apiRequest).toHaveBeenCalledWith(`${base}/visits?from=2026-10-14&to=2026-10-14&status=booked&lead_id=${LEAD_A}`, "tok");
    await expect(listVisits("tok", TENANT, { from: "tomorrow", to: "2026-10-14" })).rejects.toThrow(ApiContractError);
  });
  it("asks for the slots of one date only", async () => {
    apiRequest.mockResolvedValue(slotsJson());
    await getSlots("tok", TENANT, "2026-10-14");
    expect(apiRequest).toHaveBeenCalledWith(`${base}/visits/slots?date=2026-10-14`, "tok");
    await expect(getSlots("tok", TENANT, "2026-10-14&x=1")).rejects.toThrow(ApiContractError);
  });
  it("books with the page's id, leaving out what was not filled in", async () => {
    apiRequest.mockResolvedValue({ visit: visitJson(), replayed: false });
    await bookVisit("tok", TENANT, { visitId: VISIT_1, leadId: LEAD_A, date: "2026-10-14", slot: "10:30", partySize: 2 });
    expect(apiRequest).toHaveBeenCalledWith(`${base}/visits`, "tok", { method: "POST", body: JSON.stringify({ visit_id: VISIT_1, lead_id: LEAD_A, date: "2026-10-14", slot_start: "10:30", party_size: 2 }) });
    await bookVisit("tok", TENANT, { visitId: VISIT_1, leadId: LEAD_A, date: "2026-10-14", slot: "10:30", partySize: 1, purpose: "Sarees", note: "Her mother comes", advancePaise: 50000 });
    expect(JSON.parse(apiRequest.mock.calls[1][2].body)).toMatchObject({ purpose: "Sarees", note: "Her mother comes", advance_paise: 50000 });
  });
  it("moves a visit: the date and the slot go together; clearing the advance is explicit", async () => {
    apiRequest.mockResolvedValue({ visit: visitJson(), moved: true });
    const out = await changeVisit("tok", TENANT, VISIT_1, { date: "2026-10-15", slot: "11:00", clearAdvance: true });
    expect(out.moved).toBe(true);
    expect(apiRequest).toHaveBeenCalledWith(`${base}/visits/${VISIT_1}/change`, "tok", { method: "POST", body: JSON.stringify({ date: "2026-10-15", slot_start: "11:00", clear_advance: true }) });
  });
  it.each([["confirm"], ["arrive"], ["no-show"], ["cancel"]] as const)("the step %s posts to its own path", async (step) => {
    apiRequest.mockResolvedValue({ visit: visitJson(), replayed: false });
    await stepVisit("tok", TENANT, VISIT_1, step);
    expect(apiRequest.mock.calls[0][0]).toBe(`${base}/visits/${VISIT_1}/${step}`);
  });
  it("sends a cancel reason only for a cancel", async () => {
    apiRequest.mockResolvedValue({ visit: visitJson(), replayed: false });
    await stepVisit("tok", TENANT, VISIT_1, "cancel", "The customer called");
    expect(apiRequest.mock.calls[0][2]).toEqual({ method: "POST", body: JSON.stringify({ reason: "The customer called" }) });
    await stepVisit("tok", TENANT, VISIT_1, "confirm", "ignored");
    expect(apiRequest.mock.calls[1][2]).toEqual({ method: "POST" });
  });
  it("completes with the outcome, and the order id only when given", async () => {
    apiRequest.mockResolvedValue({ visit: visitJson({ status: "completed", outcome: "bought", order_id: ORDER }), order_id: ORDER, replayed: false });
    const out = await completeVisit("tok", TENANT, VISIT_1, { outcome: "bought", orderId: ORDER });
    expect(out.orderId).toBe(ORDER);
    expect(JSON.parse(apiRequest.mock.calls[0][2].body)).toEqual({ outcome: "bought", order_id: ORDER });
    await completeVisit("tok", TENANT, VISIT_1, { outcome: "will_return" });
    expect(JSON.parse(apiRequest.mock.calls[1][2].body)).toEqual({ outcome: "will_return" });
  });
  it("saves the hours as the whole week, without the is_default flag", async () => {
    apiRequest.mockResolvedValue(SETTINGS);
    const { is_default: _d, ...rest } = SETTINGS;
    void _d;
    await putVisitSettings("tok", TENANT, rest);
    const [path, , init] = apiRequest.mock.calls[0];
    expect(path).toBe(`${base}/visits/settings`);
    expect(init.method).toBe("PUT");
    expect(Object.keys(JSON.parse(init.body))).toEqual(["weekly_hours", "closed_dates", "slot_minutes", "max_parallel"]);
    apiRequest.mockResolvedValue(SETTINGS);
    expect((await getVisitSettings("tok", TENANT)).slot_minutes).toBe(30);
  });
  it("offers a store visit and reads where the offer message stands", async () => {
    apiRequest.mockResolvedValue({ request: { id: ORDER }, message: { status: "queued", scheduled_for: "2026-10-14T03:30:00Z" }, replayed: false, dispatched: null });
    expect(await offerStoreVisit("tok", TENANT, ORDER)).toEqual({ callRequestId: ORDER, messageStatus: "queued", scheduledFor: "2026-10-14T03:30:00Z" });
    expect(apiRequest).toHaveBeenCalledWith(`${base}/call-requests/${ORDER}/offer-visit`, "tok", { method: "POST", body: JSON.stringify({ language: "en" }) });
    await expect(offerStoreVisit("tok", TENANT, "x")).rejects.toThrow(ApiContractError);
  });
  it("reads the week as a percentage only", async () => {
    apiRequest.mockResolvedValue({ week_percent: 12, resets_at_week: "2026-10-18T18:30:00Z" });
    expect(await getAiUsageWeek("tok", TENANT)).toEqual({ week_percent: 12, resets_at_week: "2026-10-18T18:30:00Z" });
    apiRequest.mockResolvedValue({ week_percent: 140, resets_at_week: "2026-10-18T18:30:00Z" });
    await expect(getAiUsageWeek("tok", TENANT)).rejects.toThrow(ApiContractError);
  });
  it("refuses a malformed workspace id before any request", async () => {
    await expect(getTodayVisits("tok", "nope")).rejects.toThrow(ApiContractError);
    expect(apiRequest).not.toHaveBeenCalled();
  });
});
