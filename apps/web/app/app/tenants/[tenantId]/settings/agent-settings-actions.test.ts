import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiAuthError, ApiRequestError } from "@/lib/api/client";
import { SETTINGS_JSON } from "@/lib/api/scheduler-fixtures";

const putOutboxSettings = vi.fn();
const putSchedulerSettings = vi.fn();
const revalidatePath = vi.fn();
const redirectMock = vi.fn((to: string) => {
  throw new Error(`NEXT_REDIRECT:${to}`);
});
vi.mock("next/cache", () => ({ revalidatePath: (...a: unknown[]) => revalidatePath(...a) }));
vi.mock("next/navigation", () => ({ redirect: (to: string) => redirectMock(to) }));
vi.mock("@/lib/auth/session", () => ({ requireUser: async () => ({ id: "u", email: "e@example.test", accessToken: "tok" }) }));
vi.mock("@/i18n/get-lang", () => ({ getLang: async () => "en" }));
vi.mock("@/lib/api/outbox", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/api/outbox")>()), putOutboxSettings: (...a: unknown[]) => putOutboxSettings(...a) }));
vi.mock("@/lib/api/scheduler", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/api/scheduler")>()), putSchedulerSettings: (...a: unknown[]) => putSchedulerSettings(...a) }));

import { saveQuietHoursAction, saveRemindersAction, saveSendingAction } from "./agent-settings-actions";

const T = "22222222-2222-4222-8222-222222222222";
const { is_default: _d, ...SET } = SETTINGS_JSON;
void _d;
const refusal = (status: number, code: string) => new ApiRequestError(status, code, "the API's own English sentence that must never reach the person");
beforeEach(() => vi.clearAllMocks());

describe("automatic sending", () => {
  it("saves the switch and the limit, says what the switch now is, and reads the Outbox and Settings again", async () => {
    putOutboxSettings.mockResolvedValue({ platform_switch_on: true, auto_send_enabled: true, per_customer_daily_limit: 4 });
    expect(await saveSendingAction(T, { auto_send_enabled: true, per_customer_daily_limit: 4 })).toEqual({ ok: true, message: "Saved. Automatic sending is on." });
    expect(putOutboxSettings).toHaveBeenCalledWith("tok", T, { auto_send_enabled: true, per_customer_daily_limit: 4 });
    expect(revalidatePath).toHaveBeenCalledWith(`/app/tenants/${T}/outbox`);
    putOutboxSettings.mockResolvedValue({ platform_switch_on: true, auto_send_enabled: false, per_customer_daily_limit: 4 });
    expect(await saveSendingAction(T, { auto_send_enabled: false, per_customer_daily_limit: 4 })).toEqual({ ok: true, message: "Saved. Automatic sending is off: new messages wait for you to approve them. Messages you approve still go out." });
  });
  it.each([["a limit of 0", { per_customer_daily_limit: 0 }], ["a limit of 21", { per_customer_daily_limit: 21 }], ["a limit that is not a whole number", { per_customer_daily_limit: 2.5 }], ["a switch that is not a boolean", { auto_send_enabled: "yes" }]])("%s never reaches the API", async (_n, over) => {
    expect(await saveSendingAction(T, { auto_send_enabled: true, per_customer_daily_limit: 3, ...over } as never)).toMatchObject({ ok: false });
    expect(putOutboxSettings).not.toHaveBeenCalled();
  });
  it.each([
    [403, "mfa_required", "This needs your authenticator app. Set it up on the Security page, sign in again with its code, and try once more. Nothing was changed.", true],
    [403, "forbidden", "Only the owner can change this.", false],
    [422, "validation_error", "Something was not accepted. Check the numbers.", false],
    [503, "outbox_unavailable", "This is not available right now. Try again shortly.", false],
    [500, "boom", "That did not work. Nothing was changed. Try again.", false],
  ])("a %s %s is OUR sentence", async (status, code, error, mfa) => {
    putOutboxSettings.mockRejectedValue(refusal(status, code));
    const r = await saveSendingAction(T, { auto_send_enabled: true, per_customer_daily_limit: 3 });
    expect(r).toMatchObject({ ok: false, error });
    expect("mfa" in r && r.mfa === true).toBe(mfa);
  });
  it("a rejected session goes to sign-in; a malformed workspace never reaches the API", async () => {
    putOutboxSettings.mockRejectedValue(new ApiAuthError("x"));
    await expect(saveSendingAction(T, { auto_send_enabled: true, per_customer_daily_limit: 3 })).rejects.toThrow("NEXT_REDIRECT:/login");
    expect(await saveSendingAction("nope", { auto_send_enabled: true, per_customer_daily_limit: 3 })).toMatchObject({ ok: false });
  });
});

describe("visit reminders", () => {
  it("saves the whole set with only the six settings", async () => {
    putSchedulerSettings.mockResolvedValue({ ...SETTINGS_JSON, is_default: false });
    expect(await saveRemindersAction(T, { ...SET, no_show_enabled: true })).toEqual({ ok: true, message: "Saved. Messages that are already waiting are not changed." });
    expect(putSchedulerSettings).toHaveBeenCalledWith("tok", T, { ...SET, no_show_enabled: true });
    expect(revalidatePath).toHaveBeenCalledWith(`/app/tenants/${T}/settings`);
  });
  it.each([["an evening hour of 8", { reminder_evening_hour: 8 }], ["an evening hour of 21", { reminder_evening_hour: 21 }], ["a heads-up of 59 minutes", { reminder_heads_up_minutes: 59 }], ["a heads-up of 481", { reminder_heads_up_minutes: 481 }], ["a no-show of 4 minutes", { no_show_after_minutes: 4 }], ["a no-show of 721", { no_show_after_minutes: 721 }], ["a switch that is not a boolean", { no_show_enabled: "on" }]])("%s never reaches the API", async (_n, over) => {
    expect(await saveRemindersAction(T, { ...SET, ...over } as never)).toMatchObject({ ok: false });
    expect(putSchedulerSettings).not.toHaveBeenCalled();
  });
  it("the API's refusals are our sentences, and a missing second factor points at Security", async () => {
    putSchedulerSettings.mockRejectedValue(refusal(403, "mfa_required"));
    expect(await saveRemindersAction(T, SET)).toMatchObject({ ok: false, mfa: true });
    putSchedulerSettings.mockRejectedValue(refusal(403, "forbidden"));
    expect(await saveRemindersAction(T, SET)).toMatchObject({ ok: false, error: "Only the owner can change this." });
  });
});

describe("quiet hours (job BE on BB's API)", () => {
  const good = { quiet_hours_start: 22, quiet_hours_end: 8, auto_send_enabled: true, per_customer_daily_limit: 4 };
  it("saves the hours with the sending values on record, says the hours in force, and reads Settings and the Outbox again", async () => {
    putOutboxSettings.mockResolvedValue({ platform_switch_on: true, auto_send_enabled: true, per_customer_daily_limit: 4, quiet_hours_start: 22, quiet_hours_end: 8 });
    expect(await saveQuietHoursAction(T, good)).toEqual({ ok: true, message: expect.stringContaining("Quiet hours are now 22:00 to 08:00.") });
    expect(putOutboxSettings).toHaveBeenCalledWith("tok", T, good);
    expect(revalidatePath).toHaveBeenCalledWith(`/app/tenants/${T}/settings`);
    expect(revalidatePath).toHaveBeenCalledWith(`/app/tenants/${T}/outbox`);
  });
  it.each([
    ["a start of 18", { quiet_hours_start: 18 }],
    ["a start of 24", { quiet_hours_start: 24 }],
    ["an end of 6", { quiet_hours_end: 6 }],
    ["an end of 11", { quiet_hours_end: 11 }],
    ["an hour that is not whole", { quiet_hours_start: 21.5 }],
    ["an hour that is a word", { quiet_hours_end: "nine" }],
  ])("%s never reaches the API and is explained", async (_n, over) => {
    expect(await saveQuietHoursAction(T, { ...good, ...over } as never)).toEqual({ ok: false, error: "Pick a start between 19:00 and 23:00 and an end between 07:00 and 10:00. Nothing was changed." });
    expect(putOutboxSettings).not.toHaveBeenCalled();
  });
  it("refuses a bad sending value or workspace before the API", async () => {
    expect(await saveQuietHoursAction(T, { ...good, per_customer_daily_limit: 0 })).toMatchObject({ ok: false });
    expect(await saveQuietHoursAction("nope", good)).toMatchObject({ ok: false });
    expect(putOutboxSettings).not.toHaveBeenCalled();
  });
  it.each([
    [403, "mfa_required", "This needs your authenticator app", true],
    [403, "forbidden", "Only the owner can change this", undefined],
    [422, "validation_error", "Something was not accepted", undefined],
    [500, "boom", "That did not work", undefined],
  ])("a %s %s is OUR sentence", async (status, code, start, mfa) => {
    putOutboxSettings.mockRejectedValue(refusal(status, code));
    const r = await saveQuietHoursAction(T, good);
    expect(r).toMatchObject({ ok: false, error: expect.stringContaining(start) });
    expect((r as { mfa?: boolean }).mfa).toBe(mfa);
    expect(JSON.stringify(r)).not.toContain("API's own English");
  });
  it("a rejected session signs in", async () => {
    putOutboxSettings.mockRejectedValue(new ApiAuthError("x"));
    await expect(saveQuietHoursAction(T, good)).rejects.toThrow("NEXT_REDIRECT:/login");
  });
});
