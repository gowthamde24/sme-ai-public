import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiRequestError } from "@/lib/api/client";
import { parseOutboxPage } from "@/lib/api/outbox";
import { SENT_JSON, page } from "@/lib/api/outbox-fixtures";

const listOutboxMessages = vi.fn();
vi.mock("@/lib/api/outbox", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/api/outbox")>()), listOutboxMessages: (...a: unknown[]) => listOutboxMessages(...a) }));

import { readDigest } from "./outbox-digest";

const T = "22222222-2222-4222-8222-222222222222";
const NOW = Date.parse("2026-10-11T02:00:00Z");
const msg = (id: number, hoursAgo: number) => ({ ...SENT_JSON, id: `11111111-aaaa-4aaa-8aaa-${String(id).padStart(12, "0")}`, created_at: new Date(NOW - hoursAgo * 3600_000).toISOString(), sent_at: new Date(NOW - hoursAgo * 3600_000).toISOString() });

beforeEach(() => vi.clearAllMocks());

describe("the last 24 hours of the outbox, read for Today", () => {
  it("reads the newest page and boils it down", async () => {
    listOutboxMessages.mockResolvedValue(parseOutboxPage(page([msg(1, 1), msg(2, 2)])));
    expect(await readDigest("tok", T, () => NOW)).toMatchObject({ state: "ready", sent: 2 });
    expect(listOutboxMessages).toHaveBeenCalledWith("tok", T, { limit: 100, after: null });
  });
  it("reads on only while the page still reaches back less than a day, and never more than three pages", async () => {
    listOutboxMessages.mockResolvedValueOnce(parseOutboxPage(page([msg(1, 1)], "c1"))).mockResolvedValueOnce(parseOutboxPage(page([msg(2, 20)], "c2"))).mockResolvedValueOnce(parseOutboxPage(page([msg(3, 23)], "c3")));
    const d = await readDigest("tok", T, () => NOW);
    expect(listOutboxMessages).toHaveBeenCalledTimes(3);
    expect(listOutboxMessages).toHaveBeenNthCalledWith(2, "tok", T, { limit: 100, after: "c1" });
    expect(d).toMatchObject({ state: "ready", sent: 3 });
    listOutboxMessages.mockReset();
    listOutboxMessages.mockResolvedValueOnce(parseOutboxPage(page([msg(1, 1), msg(2, 30)], "c1")));
    await readDigest("tok", T, () => NOW);
    expect(listOutboxMessages).toHaveBeenCalledTimes(1); // the first page already reaches past a day
  });
  it("a person who may not read the log (403) or an outbox that is not wired (503) is 'none': the two places are not drawn", async () => {
    listOutboxMessages.mockRejectedValueOnce(new ApiRequestError(403, "forbidden", "x"));
    expect(await readDigest("tok", T, () => NOW)).toEqual({ state: "none" });
    listOutboxMessages.mockRejectedValueOnce(new ApiRequestError(503, "outbox_unavailable", "x"));
    expect(await readDigest("tok", T, () => NOW)).toEqual({ state: "none" });
  });
  it("anything else that goes wrong is 'error', and the promise never rejects", async () => {
    listOutboxMessages.mockRejectedValueOnce(new ApiRequestError(500, "api_error", "x"));
    expect(await readDigest("tok", T, () => NOW)).toEqual({ state: "error" });
    listOutboxMessages.mockRejectedValueOnce(new Error("network"));
    expect(await readDigest("tok", T, () => NOW)).toEqual({ state: "error" });
  });
});
