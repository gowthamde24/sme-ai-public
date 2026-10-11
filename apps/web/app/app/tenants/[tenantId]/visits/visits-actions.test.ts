import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiAuthError, ApiRequestError } from "@/lib/api/client";
import { SETTINGS, parseVisitFixture, slotsJson, visitJson } from "@/lib/api/visits-fixtures";

const bookVisit = vi.fn();
const changeVisit = vi.fn();
const stepVisit = vi.fn();
const completeVisit = vi.fn();
const getSlots = vi.fn();
const putVisitSettings = vi.fn();
const searchCustomers = vi.fn();
const revalidatePath = vi.fn();
const redirectMock = vi.fn((to: string) => {
  throw new Error(`NEXT_REDIRECT:${to}`);
});
vi.mock("next/cache", () => ({ revalidatePath: (...a: unknown[]) => revalidatePath(...a) }));
vi.mock("next/navigation", () => ({ redirect: (to: string) => redirectMock(to) }));
vi.mock("@/lib/auth/session", () => ({ requireUser: async () => ({ id: "u", email: "e@example.test", accessToken: "tok" }) }));
vi.mock("@/i18n/get-lang", () => ({ getLang: async () => "en" }));
vi.mock("@/lib/api/visits", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/visits")>()),
  bookVisit: (...a: unknown[]) => bookVisit(...a),
  changeVisit: (...a: unknown[]) => changeVisit(...a),
  stepVisit: (...a: unknown[]) => stepVisit(...a),
  completeVisit: (...a: unknown[]) => completeVisit(...a),
  getSlots: (...a: unknown[]) => getSlots(...a),
  putVisitSettings: (...a: unknown[]) => putVisitSettings(...a),
}));
vi.mock("./visits-data", () => ({ searchCustomers: (...a: unknown[]) => searchCustomers(...a) }));

import { arriveVisitAction, bookVisitAction, cancelVisitAction, completeVisitAction, confirmVisitAction, customersAction, moveVisitAction, noShowVisitAction, saveHoursAction, slotsAction } from "./visits-actions";

const T = "22222222-2222-4222-8222-222222222222";
const V = "d894bfa2-0aaf-4700-85a9-70e4fa125fc1";
const L = "c5c78ed6-e536-46af-a5c3-872bb2d844a2";
const ORDER = "c9dcf181-dc56-4bee-acf1-3845a5eebede";
const visit = parseVisitFixture(visitJson());
const refusal = (status: number, code: string) => new ApiRequestError(status, code, "the API's own English sentence that must never reach the person");
const book = { visitId: V, leadId: L, date: "2026-10-14", slot: "11:00", partySize: 3, purpose: "Bridal sarees", note: "", advanceRupees: null };

beforeEach(() => vi.clearAllMocks());

describe("book", () => {
  it("books with the person's token, turns the advance into paise, leaves out what is empty, and says nothing was sent", async () => {
    bookVisit.mockResolvedValue({ visit, replayed: false });
    const r = await bookVisitAction(T, { ...book, advanceRupees: 500.5 });
    expect(bookVisit).toHaveBeenCalledWith("tok", T, { visitId: V, leadId: L, date: "2026-10-14", slot: "11:00", partySize: 3, purpose: "Bridal sarees", note: null, advancePaise: 50050 });
    expect(r).toEqual({ ok: true, message: "Booked: Priya S., Wed, 14 Oct, 10:30. Nothing was sent to the customer. Confirm the visit when the customer agrees." });
    expect(revalidatePath).toHaveBeenCalledWith(`/app/tenants/${T}/visits`);
    expect(revalidatePath).toHaveBeenCalledWith(`/app/tenants/${T}`);
  });
  it("no advance is sent unless asked for", async () => {
    bookVisit.mockResolvedValue({ visit, replayed: false });
    await bookVisitAction(T, book);
    expect(bookVisit.mock.calls[0][2].advancePaise).toBeNull();
  });
  it.each([
    ["a bad visit id", { visitId: "x" }], ["a bad lead id", { leadId: "x" }], ["a bad day", { date: "14-10-2026" }], ["a bad time", { slot: "11am" }],
    ["nobody coming", { partySize: 0 }], ["fifty-one coming", { partySize: 51 }], ["a long purpose", { purpose: "p".repeat(201) }], ["a long note", { note: "n".repeat(1001) }],
    ["a negative advance", { advanceRupees: -1 }], ["a huge advance", { advanceRupees: 2_000_000 }], ["an advance that is not a number", { advanceRupees: Number.NaN }],
  ])("%s never reaches the API", async (_name, over) => {
    expect(await bookVisitAction(T, { ...book, ...over })).toEqual({ ok: false, error: "Something in the form was not accepted. Check the day, the time and the numbers." });
    expect(bookVisit).not.toHaveBeenCalled();
  });
  it("a malformed workspace id never reaches the API", async () => {
    expect(await bookVisitAction("nope", book)).toMatchObject({ ok: false });
    expect(bookVisit).not.toHaveBeenCalled();
  });
  it.each([
    [409, "slot_full", "Every place at that time is taken. Choose another time."],
    [409, "shop_closed", "The shop is closed that day. Choose another day."],
    [409, "date_past", "That date has already passed."],
    [403, "forbidden", "Your role does not allow this. Nothing was changed."],
  ])("a %s %s is OUR sentence, never the API's", async (status, code, sentence) => {
    bookVisit.mockRejectedValue(refusal(status, code));
    expect(await bookVisitAction(T, book)).toMatchObject({ ok: false, error: sentence });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
  it("a rejected session goes to sign-in", async () => {
    bookVisit.mockRejectedValue(new ApiAuthError("x"));
    await expect(bookVisitAction(T, book)).rejects.toThrow("NEXT_REDIRECT:/login");
  });
});

describe("the steps", () => {
  it.each([
    ["confirm", confirmVisitAction, "Confirmed for Priya S., and nothing was sent to the customer."],
    ["arrive", arriveVisitAction, "Priya S. is marked as here."],
    ["no-show", noShowVisitAction, "Priya S. is marked as did not come."],
  ] as const)("%s calls its own step", async (step, action, message) => {
    stepVisit.mockResolvedValue({ visit, replayed: false });
    expect(await action(T, V)).toEqual({ ok: true, message });
    expect(stepVisit).toHaveBeenCalledWith("tok", T, V, step, undefined);
    expect(revalidatePath).toHaveBeenCalled();
  });
  it("cancel sends the trimmed reason, or none when it is empty or too long", async () => {
    stepVisit.mockResolvedValue({ visit, replayed: false });
    expect(await cancelVisitAction(T, V, "  The customer called  ")).toEqual({ ok: true, message: "Cancelled for Priya S., and nothing was sent to the customer." });
    expect(stepVisit).toHaveBeenLastCalledWith("tok", T, V, "cancel", "The customer called");
    await cancelVisitAction(T, V, "");
    expect(stepVisit).toHaveBeenLastCalledWith("tok", T, V, "cancel", undefined);
    await cancelVisitAction(T, V, "r".repeat(201));
    expect(stepVisit).toHaveBeenLastCalledWith("tok", T, V, "cancel", undefined);
  });
  it("a visit that is not in that state is a stale card", async () => {
    stepVisit.mockRejectedValue(refusal(409, "visit_state"));
    expect(await arriveVisitAction(T, V)).toMatchObject({ ok: false, stale: true });
  });
  it("a malformed id never reaches the API", async () => {
    expect(await confirmVisitAction(T, "../x")).toMatchObject({ ok: false, stale: true });
    expect(stepVisit).not.toHaveBeenCalled();
  });
});

describe("move", () => {
  it("moves to the day and time, and says when", async () => {
    changeVisit.mockResolvedValue({ visit: parseVisitFixture(visitJson({ date: "2026-10-15", starts_at: "2026-10-15T06:30:00Z" })), moved: true });
    const r = await moveVisitAction(T, V, "2026-10-15", "12:00");
    expect(changeVisit).toHaveBeenCalledWith("tok", T, V, { date: "2026-10-15", slot: "12:00" });
    expect(r).toEqual({ ok: true, message: "Moved to Thu, 15 Oct, 12:00. It waits for the customer to confirm again. Nothing was sent." });
  });
  it("a bad day or time never reaches the API; a full slot is our sentence", async () => {
    expect(await moveVisitAction(T, V, "tomorrow", "12:00")).toMatchObject({ ok: false });
    expect(await moveVisitAction(T, V, "2026-10-15", "noon")).toMatchObject({ ok: false });
    expect(changeVisit).not.toHaveBeenCalled();
    changeVisit.mockRejectedValue(refusal(409, "slot_full"));
    expect(await moveVisitAction(T, V, "2026-10-15", "12:00")).toMatchObject({ ok: false, error: "Every place at that time is taken. Choose another time." });
  });
});

describe("complete", () => {
  it("completes with the outcome; 'will come back' makes no order", async () => {
    completeVisit.mockResolvedValue({ visit, orderId: null, replayed: false });
    expect(await completeVisitAction(T, V, "will_return", null)).toEqual({ ok: true, message: "Priya S.: done." });
    expect(completeVisit).toHaveBeenCalledWith("tok", T, V, { outcome: "will_return" });
  });
  it("bought with an order id starts the order and returns its id", async () => {
    completeVisit.mockResolvedValue({ visit, orderId: ORDER, replayed: false });
    expect(await completeVisitAction(T, V, "bought", ORDER)).toEqual({ ok: true, message: "Done. The order was started from the approved quote.", orderId: ORDER });
    expect(completeVisit).toHaveBeenCalledWith("tok", T, V, { outcome: "bought", orderId: ORDER });
  });
  it("an order id with any other outcome, or an outcome the API does not know, never reaches it", async () => {
    expect(await completeVisitAction(T, V, "will_return", ORDER)).toMatchObject({ ok: false, stale: true });
    expect(await completeVisitAction(T, V, "maybe" as never, null)).toMatchObject({ ok: false });
    expect(await completeVisitAction(T, V, "bought", "x")).toMatchObject({ ok: false });
    expect(completeVisit).not.toHaveBeenCalled();
  });
  it("no approved quote, a missing second factor and a Sales person are each their own plain sentence", async () => {
    completeVisit.mockRejectedValue(refusal(409, "no_approved_quote"));
    expect(await completeVisitAction(T, V, "bought", ORDER)).toMatchObject({ ok: false, quotes: true, error: expect.stringContaining("no approved quote") });
    completeVisit.mockRejectedValue(refusal(403, "mfa_required"));
    expect(await completeVisitAction(T, V, "bought", ORDER)).toMatchObject({ ok: false, mfa: true });
    completeVisit.mockRejectedValue(refusal(403, "forbidden"));
    expect(await completeVisitAction(T, V, "bought", ORDER)).toMatchObject({ ok: false, error: "Your role does not allow this. Nothing was changed." });
  });
});

describe("slots, customers and the hours", () => {
  it("reads the slots of a day, and refuses a bad day", async () => {
    getSlots.mockResolvedValue(slotsJson("2026-10-14"));
    expect(await slotsAction(T, "2026-10-14")).toMatchObject({ ok: true, slots: { date: "2026-10-14" } });
    expect(getSlots).toHaveBeenCalledWith("tok", T, "2026-10-14");
    expect(await slotsAction(T, "x")).toMatchObject({ ok: false });
    getSlots.mockRejectedValue(refusal(503, "visits_unavailable"));
    expect(await slotsAction(T, "2026-10-14")).toMatchObject({ ok: false, error: "Visits are not available right now. Try again shortly." });
  });
  it("searches customers by name and returns only what was found", async () => {
    searchCustomers.mockResolvedValue([{ leadId: L, label: "Sri Lakshmi Silks", city: "Hyderabad" }]);
    expect(await customersAction(T, "Sri")).toEqual({ ok: true, items: [{ leadId: L, label: "Sri Lakshmi Silks", city: "Hyderabad" }] });
    expect(searchCustomers).toHaveBeenCalledWith("tok", T, "Sri");
    expect(await customersAction(T, 5 as never)).toMatchObject({ ok: false });
  });
  it("saves the whole week; the answer is the saved hours", async () => {
    putVisitSettings.mockResolvedValue({ ...SETTINGS, slot_minutes: 45 });
    const { is_default: _d, ...settings } = SETTINGS;
    void _d;
    const r = await saveHoursAction(T, { ...settings, slot_minutes: 45 });
    expect(putVisitSettings).toHaveBeenCalledWith("tok", T, { weekly_hours: SETTINGS.weekly_hours, closed_dates: SETTINGS.closed_dates, slot_minutes: 45, max_parallel: 2 });
    expect(r).toMatchObject({ ok: true, message: "Hours saved. Visits already booked were not changed.", settings: { slot_minutes: 45 } });
  });
  it("hours that are not a whole week, a close before the open, or a bad closed date never reach the API", async () => {
    const { is_default: _d, ...settings } = SETTINGS;
    void _d;
    const { mon: _m, ...short } = SETTINGS.weekly_hours;
    void _m;
    expect(await saveHoursAction(T, { ...settings, weekly_hours: short as never })).toMatchObject({ ok: false });
    expect(await saveHoursAction(T, { ...settings, weekly_hours: { ...SETTINGS.weekly_hours, mon: { open: "20:00", close: "10:00" } } })).toMatchObject({ ok: false });
    expect(await saveHoursAction(T, { ...settings, closed_dates: ["tomorrow"] })).toMatchObject({ ok: false });
    expect(await saveHoursAction(T, { ...settings, closed_dates: Array(201).fill("2026-10-20") })).toMatchObject({ ok: false });
    expect(putVisitSettings).not.toHaveBeenCalled();
  });
  it("a Sales person's attempt is refused in our words", async () => {
    putVisitSettings.mockRejectedValue(refusal(403, "forbidden"));
    const { is_default: _d, ...settings } = SETTINGS;
    void _d;
    expect(await saveHoursAction(T, settings)).toEqual({ ok: false, error: "Your role does not allow this. Nothing was changed." });
  });
});
