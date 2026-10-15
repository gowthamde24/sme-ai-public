import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiAuthError, ApiRequestError } from "@/lib/api/client";
import { TRIP_JSON } from "@/lib/api/deliveries-fixtures";

const api = { plan: vi.fn(), update: vi.fn(), status: vi.fn(), notify: vi.fn() };
const revalidatePath = vi.fn();
const redirectMock = vi.fn((to: string) => {
  throw new Error(`NEXT_REDIRECT:${to}`);
});
vi.mock("next/cache", () => ({ revalidatePath: (...a: unknown[]) => revalidatePath(...a) }));
vi.mock("next/navigation", () => ({ redirect: (to: string) => redirectMock(to) }));
vi.mock("@/lib/auth/session", () => ({ requireUser: async () => ({ id: "u", email: "e@example.test", accessToken: "tok" }) }));
vi.mock("@/i18n/get-lang", () => ({ getLang: async () => "en" }));
vi.mock("@/lib/api/deliveries", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/deliveries")>()),
  planTrip: (...a: unknown[]) => api.plan(...a),
  updateTrip: (...a: unknown[]) => api.update(...a),
  setTripStatus: (...a: unknown[]) => api.status(...a),
  notifySite: (...a: unknown[]) => api.notify(...a),
}));

import { notifyTripAction, planTripAction, setTripStatusAction, updateTripAction } from "./trip-actions";
import { tripRefusalOf } from "./trip-refusals";

const T = "22222222-2222-4222-8222-222222222222";
const O = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1";
const TR = "d1d1d1d1-d1d1-4d1d-8d1d-d1d1d1d1d1d1";
const good = { plannedDate: "2026-10-20", vehicleNo: "TS 09 UA 1234", driverName: "Suresh", driverPhone: "+91 90000 20001", siteId: null, lines: [{ line_no: 1, quantity: 2500 }] };
const refusal = (status: number, code: string) => new ApiRequestError(status, code, "the API's own English sentence that must never reach the person");
beforeEach(() => vi.clearAllMocks());

describe("plan and update", () => {
  it("plans with the screen's trip id and the person's token, and refreshes the board", async () => {
    api.plan.mockResolvedValue(TRIP_JSON);
    expect(await planTripAction(T, O, TR, good)).toEqual({ ok: true, date: "2026-10-20" });
    expect(api.plan).toHaveBeenCalledWith("tok", T, O, { plannedDate: "2026-10-20", vehicleNo: "TS 09 UA 1234", driverName: "Suresh", driverPhone: "+91 90000 20001", siteId: null, siteContactId: null, lines: [{ line_no: 1, quantity: 2500 }], tripId: TR });
    expect(revalidatePath).toHaveBeenCalledWith(`/app/tenants/${T}/orders/trips`);
  });
  it.each([
    ["a bad date", { plannedDate: "2026-02-30" }], ["a vehicle with symbols", { vehicleNo: "<script>" }], ["a phone with letters", { driverPhone: "call" }], ["a long driver name", { driverName: "x".repeat(81) }],
    ["no lines", { lines: [] }], ["a zero quantity", { lines: [{ line_no: 1, quantity: 0 }] }], ["a fractional quantity", { lines: [{ line_no: 1, quantity: 1.5 }] }], ["six lines", { lines: Array.from({ length: 6 }, (_, i) => ({ line_no: i + 1, quantity: 1 })) }],
    ["a line twice", { lines: [{ line_no: 1, quantity: 1 }, { line_no: 1, quantity: 2 }] }], ["a bad site id", { siteId: "x" }],
  ])("%s never reaches the API", async (_n, over) => {
    expect(await planTripAction(T, O, TR, { ...good, ...over } as never)).toEqual({ ok: false, error: "Something in the form is not right. Nothing was saved." });
    expect(api.plan).not.toHaveBeenCalled();
  });
  it("changes a planned trip", async () => {
    api.update.mockResolvedValue(TRIP_JSON);
    expect(await updateTripAction(T, TR, good)).toEqual({ ok: true, date: "2026-10-20" });
    expect(api.update.mock.calls[0][2]).toBe(TR);
  });
  it.each([
    ["trip_state", 409, "not in a state"], ["order_not_dispatched", 409, "cannot leave before the order is dispatched"], ["quantity_exceeds_order", 409, "more than the order holds"],
    ["order_not_deliverable", 409, "cannot have trips"], ["forbidden", 403, "role does not allow"],
  ])("%s becomes one sentence of ours", async (code, status, text) => {
    api.plan.mockRejectedValue(refusal(status, code));
    const r = await planTripAction(T, O, TR, good);
    expect((r as { error: string }).error.toLowerCase()).toContain(text.toLowerCase());
  });
});

describe("status", () => {
  it("passes a settable status; a problem needs its reason and only a problem takes one", async () => {
    api.status.mockResolvedValue(TRIP_JSON);
    expect(await setTripStatusAction(T, TR, "loaded")).toEqual({ ok: true });
    expect(await setTripStatusAction(T, TR, "problem", "site_closed")).toEqual({ ok: true });
    expect(await setTripStatusAction(T, TR, "problem")).toMatchObject({ ok: false });
    expect(await setTripStatusAction(T, TR, "loaded", "site_closed")).toMatchObject({ ok: false });
    expect(await setTripStatusAction(T, TR, "problem", "boredom")).toMatchObject({ ok: false });
    expect(await setTripStatusAction(T, TR, "delivered")).toMatchObject({ ok: false });
    expect(api.status).toHaveBeenCalledTimes(2);
  });
});

describe("telling the site", () => {
  it("makes a new message id per press and returns what the outbox did", async () => {
    api.notify.mockResolvedValue({ message_id: "x", status: "needs_approval", reason: "r", text: "Truck delayed", replayed: false });
    expect(await notifyTripAction(T, TR, "delay", null, "en")).toEqual({ ok: true, text: "Truck delayed", status: "needs_approval" });
    expect(api.notify.mock.calls[0][3]).toMatchObject({ kind: "delay", eta: null, language: "en" });
    expect(api.notify.mock.calls[0][3].messageId).toMatch(/^[0-9a-f-]{36}$/);
  });
  it.each([["a kind outside the list", "shout", null, "en"], ["a bad time", "left", "evening-ish", "en"], ["an unknown language", "left", null, "fr"]])("%s never reaches the API", async (_n, kind, eta, lang) => {
    expect(await notifyTripAction(T, TR, kind, eta, lang)).toMatchObject({ ok: false });
    expect(api.notify).not.toHaveBeenCalled();
  });
  it("a site with no contact is explained", async () => {
    api.notify.mockRejectedValue(refusal(422, "no_site_contact"));
    expect(await notifyTripAction(T, TR, "left", null, "en")).toMatchObject({ ok: false, error: expect.stringContaining("no site contact") });
  });
  it("a rejected session goes to sign-in", async () => {
    api.notify.mockRejectedValue(new ApiAuthError("x"));
    await expect(notifyTripAction(T, TR, "left", null, "en")).rejects.toThrow("NEXT_REDIRECT:/login");
  });
});

describe("the refusal map", () => {
  it("never shows the server's text", () => {
    expect(tripRefusalOf(refusal(418, "teapot"))).toEqual({ key: "today.err.generic" });
    expect(tripRefusalOf(refusal(413, "photo_too_large"))).toEqual({ key: "catalogue.photo.err.large" });
    expect(() => tripRefusalOf(new ApiAuthError("x"))).toThrow(ApiAuthError);
  });
});
