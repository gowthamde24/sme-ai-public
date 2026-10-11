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

import { saveRemindersAction, saveSendingAction } from "./agent-settings-actions";

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
    expect(await saveSendingAction(T, { auto_send_enabled: false, per_customer_daily_limit: 4 })).toEqual({ ok: true, message: "Saved. Automatic sending is off: every message waits for you." });
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
