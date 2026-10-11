import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiContractError } from "./client";

const apiRequest = vi.fn();
vi.mock("./client", async (importOriginal) => ({ ...(await importOriginal<typeof import("./client")>()), apiRequest: (...a: unknown[]) => apiRequest(...a) }));

import { getSchedulerSettings, getSchedulerStatus, parseSchedulerSettings, parseSchedulerStatus, putSchedulerSettings } from "./scheduler";
import { SETTINGS_JSON, STATUS_JSON } from "./scheduler-fixtures";

const TENANT = "22222222-2222-4222-8222-222222222222";
const base = `/v1/tenants/${TENANT}/scheduler`;
beforeEach(() => vi.clearAllMocks());

describe("the scheduler's status", () => {
  it("reads both switches, the worker's last and next check and today's counts", () => {
    expect(parseSchedulerStatus(STATUS_JSON)).toMatchObject({ active: true, worker_running: true, last_run_at: "2026-10-14T04:28:00Z", next_run_at: "2026-10-14T04:29:00Z", today: { sent: 2, reminders: 1 } });
  });
  it("a worker never heard from has no times", () => {
    expect(parseSchedulerStatus({ ...STATUS_JSON, worker_running: false, last_run_at: null, next_run_at: null, interval_seconds: null, last_activity_at: null })).toMatchObject({ last_run_at: null, next_run_at: null, interval_seconds: null });
  });
  it("carries no phone number, text, name or token", () => {
    expect(Object.keys(parseSchedulerStatus(STATUS_JSON)).join(" ")).not.toMatch(/phone|text|name|token|customer/i);
  });
  it.each([["active", "yes"], ["worker_running", 1], ["last_run_at", "soon"], ["interval_seconds", -5], ["today", null], ["platform_switch_on", undefined]])("a status with %s = %j is a contract error", (key, value) => {
    expect(() => parseSchedulerStatus({ ...STATUS_JSON, [key]: value })).toThrow(ApiContractError);
  });
  it("a count that is negative or fractional is a contract error", () => {
    expect(() => parseSchedulerStatus({ ...STATUS_JSON, today: { ...STATUS_JSON.today, sent: -1 } })).toThrow(ApiContractError);
    expect(() => parseSchedulerStatus({ ...STATUS_JSON, today: { ...STATUS_JSON.today, errors: 1.5 } })).toThrow(ApiContractError);
  });
});

describe("the scheduler's settings", () => {
  it("reads the whole set and its bounds", () => {
    expect(parseSchedulerSettings(SETTINGS_JSON)).toEqual(SETTINGS_JSON);
    expect(parseSchedulerSettings({ ...SETTINGS_JSON, reminder_evening_hour: 9, reminder_heads_up_minutes: 480, no_show_after_minutes: 720 })).toMatchObject({ reminder_evening_hour: 9 });
  });
  it.each([["reminder_evening_hour", 8], ["reminder_evening_hour", 21], ["reminder_heads_up_minutes", 59], ["reminder_heads_up_minutes", 481], ["no_show_after_minutes", 4], ["no_show_after_minutes", 721], ["no_show_enabled", "off"], ["is_default", null]])("%s = %j is a contract error", (key, value) => {
    expect(() => parseSchedulerSettings({ ...SETTINGS_JSON, [key]: value })).toThrow(ApiContractError);
  });
});

describe("the calls", () => {
  it("reads status and settings of this workspace with the person's token", async () => {
    apiRequest.mockResolvedValue(STATUS_JSON);
    await getSchedulerStatus("tok", TENANT);
    expect(apiRequest).toHaveBeenCalledWith(`${base}/status`, "tok");
    apiRequest.mockResolvedValue(SETTINGS_JSON);
    await getSchedulerSettings("tok", TENANT);
    expect(apiRequest).toHaveBeenLastCalledWith(`${base}/settings`, "tok");
  });
  it("saves exactly the six settings (never is_default)", async () => {
    apiRequest.mockResolvedValue({ ...SETTINGS_JSON, is_default: false });
    const { is_default: _d, ...set } = SETTINGS_JSON;
    void _d;
    const out = await putSchedulerSettings("tok", TENANT, { ...set, no_show_enabled: true });
    const [path, , init] = apiRequest.mock.calls[0];
    expect(path).toBe(`${base}/settings`);
    expect(init.method).toBe("PUT");
    expect(JSON.parse(init.body)).toEqual({ ...set, no_show_enabled: true });
    expect(out.is_default).toBe(false);
  });
  it("refuses a malformed workspace id before any request", async () => {
    await expect(getSchedulerStatus("tok", "x/y")).rejects.toThrow(ApiContractError);
    expect(apiRequest).not.toHaveBeenCalled();
  });
});
