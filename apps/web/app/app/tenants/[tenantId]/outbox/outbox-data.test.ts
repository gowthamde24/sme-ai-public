import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiAuthError, ApiRequestError } from "@/lib/api/client";
import { parseOutboxPage } from "@/lib/api/outbox";
import { BLOCKED_JSON, PRICE_JSON, SENT_JSON, page } from "@/lib/api/outbox-fixtures";
import { STATUS_JSON } from "@/lib/api/scheduler-fixtures";
import { FAILED, HELD, SENT, STOPPED, WAITING } from "@/components/v2/app/outbox/outbox-test-kit";

const listOutboxMessages = vi.fn();
const getOutboxSettings = vi.fn();
const getSchedulerStatus = vi.fn();
vi.mock("@/lib/api/outbox", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/api/outbox")>()), listOutboxMessages: (...a: unknown[]) => listOutboxMessages(...a), getOutboxSettings: (...a: unknown[]) => getOutboxSettings(...a) }));
vi.mock("@/lib/api/scheduler", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/api/scheduler")>()), getSchedulerStatus: (...a: unknown[]) => getSchedulerStatus(...a) }));

import { matches, readOutbox } from "./outbox-data";

const T = "22222222-2222-4222-8222-222222222222";
const NOW = Date.parse("2026-10-14T04:30:00Z");
const pageOf = (items: unknown[], next: string | null = null) => parseOutboxPage(page(items, next));
const o = (over: Record<string, unknown> = {}) => ({ tab: "waiting" as const, range: "7d" as const, q: "", after: null, role: "owner" as const, now: NOW, ...over });
const SETTINGS = { platform_switch_on: true, auto_send_enabled: true, per_customer_daily_limit: 3 };

beforeEach(() => {
  vi.clearAllMocks();
  listOutboxMessages.mockResolvedValue(pageOf([]));
  getOutboxSettings.mockResolvedValue(SETTINGS);
  getSchedulerStatus.mockResolvedValue(STATUS_JSON);
});

describe("readOutbox: which messages a tab reads", () => {
  it.each([
    ["waiting", ["needs_approval"]],
    ["scheduled", ["queued"]],
    ["sent", ["sent"]],
    ["blocked", ["blocked", "failed"]],
  ] as const)("%s asks for %j, a hundred at a time", async (tab, statuses) => {
    await readOutbox("tok", T, o({ tab }));
    const asked = listOutboxMessages.mock.calls.filter((c) => c[2].status !== "needs_approval" || tab === "waiting").map((c) => c[2].status);
    expect(asked).toEqual([...statuses]);
    expect(listOutboxMessages.mock.calls[0][2].limit).toBe(100);
  });
  it("another tab also counts what waits for a person", async () => {
    listOutboxMessages.mockImplementation(async (_t: string, _id: string, opts: { status: string }) => pageOf(opts.status === "needs_approval" ? [PRICE_JSON, { ...PRICE_JSON, id: "11111111-aaaa-4aaa-8aaa-0000000000c1" }] : []));
    expect((await readOutbox("tok", T, o({ tab: "sent" }))).waiting).toBe(2);
  });
  it("the waiting tab's own count is its list", async () => {
    listOutboxMessages.mockResolvedValue(pageOf([WAITING()]));
    expect((await readOutbox("tok", T, o({ tab: "waiting", range: "7d" }))).waiting).toBe(1);
  });
  it("the cursor is carried for a single-status tab only", async () => {
    listOutboxMessages.mockResolvedValue(pageOf([], "next-1"));
    const sent = await readOutbox("tok", T, o({ tab: "sent", after: "cur" }));
    expect(listOutboxMessages.mock.calls.find((c) => c[2].status === "sent")![2].after).toBe("cur");
    expect(sent.more).toBe("next-1");
    expect((await readOutbox("tok", T, o({ tab: "blocked", after: "cur" }))).more).toBeNull();
    expect(listOutboxMessages.mock.calls.filter((c) => c[2].status === "blocked" || c[2].status === "failed").every((c) => c[2].after === null)).toBe(true);
  });
});

describe("readOutbox: the range and the customer search", () => {
  it("keeps what is inside the range and drops what is older", async () => {
    const old = { ...SENT_JSON, id: "11111111-aaaa-4aaa-8aaa-0000000000d1", sent_at: "2026-09-01T00:00:00Z", created_at: "2026-09-01T00:00:00Z" };
    listOutboxMessages.mockResolvedValue(pageOf([old, { ...SENT_JSON, sent_at: "2026-10-13T04:30:00Z", created_at: "2026-10-13T04:00:00Z" }]));
    expect((await readOutbox("tok", T, o({ tab: "sent" }))).items).toHaveLength(1);
  });
  it("'today' keeps today's and what is held for later", async () => {
    listOutboxMessages.mockResolvedValue(pageOf([HELD(), { ...BLOCKED_JSON, created_at: "2026-10-12T00:00:00Z" }]));
    expect((await readOutbox("tok", T, o({ tab: "scheduled", range: "today" }))).items).toHaveLength(1);
  });
  it("searches the customer's name or city, ignoring case, and never the words of a message", () => {
    expect(matches(WAITING(), "lakshmi")).toBe(true);
    expect(matches(WAITING(), "  DEMOVILLE ")).toBe(true);
    expect(matches(WAITING(), "")).toBe(true);
    expect(matches(WAITING(), "ధర")).toBe(false); // the words are not searched
    expect(matches(WAITING(), "nobody")).toBe(false);
  });
  it("blocked and failed are merged, newest first", async () => {
    listOutboxMessages.mockImplementation(async (_t: string, _i: string, opts: { status: string }) => pageOf(opts.status === "blocked" ? [STOPPED()] : opts.status === "failed" ? [FAILED()] : []));
    const out = await readOutbox("tok", T, o({ tab: "blocked" }));
    expect(out.items!.map((m) => m.status)).toEqual(["failed", "blocked"]);
    void SENT;
  });
});

describe("readOutbox: the other reads", () => {
  it("Owner and Admin also get the sending settings and Agent OWL's status; Sales do not", async () => {
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
  });
  it("each read stands on its own: one that fails is null", async () => {
    getOutboxSettings.mockRejectedValue(new ApiRequestError(500, "api_error", "x"));
    getSchedulerStatus.mockRejectedValue(new ApiRequestError(500, "api_error", "x"));
    expect(await readOutbox("tok", T, o())).toMatchObject({ settings: null, scheduler: null, items: [] });
    listOutboxMessages.mockRejectedValue(new ApiRequestError(500, "api_error", "x"));
    expect(await readOutbox("tok", T, o())).toMatchObject({ items: null, waiting: null, more: null });
  });
  it("a rejected session is thrown from any read", async () => {
    getSchedulerStatus.mockRejectedValue(new ApiAuthError("x"));
    await expect(readOutbox("tok", T, o())).rejects.toThrow(ApiAuthError);
  });
});
