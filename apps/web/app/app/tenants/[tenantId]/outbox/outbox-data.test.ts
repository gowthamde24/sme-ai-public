import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiAuthError, ApiRequestError } from "@/lib/api/client";
import { parseOutboxPage, parseOutboxSummary } from "@/lib/api/outbox";
import { page } from "@/lib/api/outbox-fixtures";
import { STATUS_JSON } from "@/lib/api/scheduler-fixtures";
import { WAITING } from "@/components/v2/app/outbox/outbox-test-kit";

const listOutboxMessages = vi.fn();
const getOutboxSummary = vi.fn();
const getOutboxSettings = vi.fn();
const getSchedulerStatus = vi.fn();
vi.mock("@/lib/api/outbox", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/outbox")>()),
  listOutboxMessages: (...a: unknown[]) => listOutboxMessages(...a),
  getOutboxSummary: (...a: unknown[]) => getOutboxSummary(...a),
  getOutboxSettings: (...a: unknown[]) => getOutboxSettings(...a),
}));
vi.mock("@/lib/api/scheduler", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/api/scheduler")>()), getSchedulerStatus: (...a: unknown[]) => getSchedulerStatus(...a) }));

import { readOutbox } from "./outbox-data";

const T = "22222222-2222-4222-8222-222222222222";
const pageOf = (items: unknown[], next: string | null = null) => parseOutboxPage(page(items, next));
const SUMMARY = parseOutboxSummary({ waiting: 3, scheduled: 1, sent: 7, blocked: 2, due_now: 1, held_for_later: 4 });
const none = { q: "", from: null, to: null };
const o = (over: Record<string, unknown> = {}) => ({ tab: "waiting" as const, filters: none, after: null, role: "owner" as const, ...over });
const SETTINGS = { platform_switch_on: true, auto_send_enabled: true, per_customer_daily_limit: 3, quiet_hours_start: 21, quiet_hours_end: 9 };

beforeEach(() => {
  vi.resetAllMocks();
  listOutboxMessages.mockResolvedValue(pageOf([WAITING()]));
  getOutboxSummary.mockResolvedValue(SUMMARY);
  getOutboxSettings.mockResolvedValue(SETTINGS);
  getSchedulerStatus.mockResolvedValue(STATUS_JSON);
});

describe("readOutbox: the server does the filtering (job BE on BB)", () => {
  it.each(["waiting", "scheduled", "sent", "blocked"] as const)("the %s tab is ONE call with that tab, thirty at a time; nothing is narrowed on the page", async (tab) => {
    const out = await readOutbox("tok", T, o({ tab }));
    expect(listOutboxMessages).toHaveBeenCalledTimes(1);
    expect(listOutboxMessages).toHaveBeenCalledWith("tok", T, { tab, limit: 30, after: null });
    expect(listOutboxMessages.mock.calls[0][2]).not.toHaveProperty("status");
    expect(out.items).toHaveLength(1);
  });

  it("passes the customer and the two India dates to the list AND to the counts, and nothing that is empty", async () => {
    await readOutbox("tok", T, o({ tab: "sent", filters: { q: "Lakshmi", from: "2026-10-01", to: "2026-10-04" }, after: "CUR" }));
    expect(listOutboxMessages).toHaveBeenCalledWith("tok", T, { tab: "sent", limit: 30, after: "CUR", customer: "Lakshmi", from: "2026-10-01", to: "2026-10-04" });
    expect(getOutboxSummary).toHaveBeenCalledWith("tok", T, { customer: "Lakshmi", from: "2026-10-01", to: "2026-10-04" });
    await readOutbox("tok", T, o());
    expect(getOutboxSummary.mock.calls[1][2]).toEqual({});
  });

  it("hands back the counts behind the four tabs, and the server's cursor (which keeps the filters)", async () => {
    listOutboxMessages.mockResolvedValue(pageOf([], "next-1"));
    const out = await readOutbox("tok", T, o({ tab: "sent" }));
    expect(out.counts).toEqual(SUMMARY);
    expect(out.more).toBe("next-1");
  });

  it("does not look at the words of any message or the city: the server's customer filter is by name only, and the page filters nothing", async () => {
    listOutboxMessages.mockResolvedValue(pageOf([WAITING(), WAITING()]));
    expect((await readOutbox("tok", T, o({ filters: { q: "zzz-nothing", from: null, to: null } }))).items).toHaveLength(2);
  });
});

describe("readOutbox: the other reads", () => {
  it("Owner and Admin also get the sending settings (with the quiet hours) and Vijaya's status; Sales do not", async () => {
    const owner = await readOutbox("tok", T, o());
    expect(owner.settings).toEqual(SETTINGS);
    expect(owner.scheduler?.worker_running).toBe(true);
    getOutboxSettings.mockClear();
    getSchedulerStatus.mockClear();
    const sales = await readOutbox("tok", T, o({ role: "sales" }));
    expect(sales.settings).toBeNull();
    expect(sales.scheduler).toBeNull();
    expect(getOutboxSettings).not.toHaveBeenCalled();
    expect(getSchedulerStatus).not.toHaveBeenCalled();
    expect(getOutboxSummary).toHaveBeenCalledTimes(2); // every role that may read the log reads its counts
  });

  it("each read stands on its own: one that fails is null", async () => {
    getOutboxSettings.mockRejectedValue(new ApiRequestError(500, "api_error", "x"));
    getSchedulerStatus.mockRejectedValue(new ApiRequestError(500, "api_error", "x"));
    getOutboxSummary.mockRejectedValue(new ApiRequestError(500, "api_error", "x"));
    expect(await readOutbox("tok", T, o())).toMatchObject({ settings: null, scheduler: null, counts: null });
    listOutboxMessages.mockRejectedValue(new ApiRequestError(500, "api_error", "x"));
    expect(await readOutbox("tok", T, o())).toMatchObject({ items: null, more: null });
  });

  it("a rejected session is thrown from any read", async () => {
    getSchedulerStatus.mockRejectedValue(new ApiAuthError("x"));
    await expect(readOutbox("tok", T, o())).rejects.toThrow(ApiAuthError);
    getSchedulerStatus.mockResolvedValue(STATUS_JSON);
    getOutboxSummary.mockRejectedValue(new ApiAuthError("x"));
    await expect(readOutbox("tok", T, o())).rejects.toThrow(ApiAuthError);
  });
});
