import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ req: vi.fn(), mode: { v: "mock" as "off" | "mock" | "on" }, jar: { rows: [] as unknown[] } }));
vi.mock("./client", async (orig) => ({ ...(await orig<typeof import("./client")>()), apiRequest: (...a: unknown[]) => h.req(...a) }));
vi.mock("@/lib/screens/flag", () => ({ chatQueueScreens: () => h.mode.v }));
vi.mock("@/lib/mock/jar", () => ({
  readJar: async (_n: string, parse: (v: unknown) => unknown, fallback: unknown) => parse(JSON.parse(JSON.stringify(h.jar.rows))) ?? fallback,
  writeJar: async (_n: string, v: unknown) => ((h.jar.rows = v as unknown[]), true),
}));

import { ApiRequestError } from "./client";
import { cancelQueued, MOCK_FAIL_S, MOCK_REPLY_S, MOCK_SENDING_S, parseCancelled, parseQueuedMessage, parseQueuedRead, queueMessage, readQueued, refusalOf } from "./chat-queue";
import { QUEUED_FIXTURES } from "./chat-queue.fixtures";

const T = "22222222-2222-4222-8222-222222222222";
const L = "33333333-aaaa-4aaa-8aaa-000000000001";
const C1 = "44444444-aaaa-4aaa-8aaa-0000000000c1";
const C2 = "44444444-aaaa-4aaa-8aaa-0000000000c2";
const NOW = Date.parse("2026-11-20T10:00:00Z");
const at = (s: number) => NOW + s * 1000;

beforeEach(() => {
  h.req.mockReset();
  h.mode.v = "mock";
  h.jar.rows = [];
});

describe("chat queue: the wire shape (real answers, parsed by the one adapter)", () => {
  it("parses every fixture of the contract", () => {
    for (const [name, wire] of Object.entries(QUEUED_FIXTURES)) {
      const q = parseQueuedMessage(wire);
      expect(q.id, name).toMatch(/^[0-9a-f-]{36}$/);
      expect(["waiting_for_reply", "sending", "sent", "cancelled", "expired", "failed"], name).toContain(q.status);
    }
    expect(parseQueuedMessage(QUEUED_FIXTURES.waiting)).toEqual({ id: "a1b2c3d4-0000-4000-8000-000000000001", text: "Yes, the red Kanchi silk is in stock.", status: "waiting_for_reply", sendAt: null, queuedAt: "2026-11-20T09:00:00Z", expiresAt: "2026-11-27T09:00:00Z", continueChat: "sent", failureCode: null });
  });
  it("the old night state and any word it does not know read as Sending…", () => {
    expect(parseQueuedMessage(QUEUED_FIXTURES.legacy_morning).status).toBe("sending");
    expect(parseQueuedMessage({ ...QUEUED_FIXTURES.waiting, status: "something_new" }).status).toBe("sending");
  });
  it("a STOP is `cancelled` with its failure code; failed carries the outbox's closed word", () => {
    expect(parseQueuedMessage(QUEUED_FIXTURES.stopped)).toMatchObject({ status: "cancelled", failureCode: "stopped_by_customer" });
    expect(parseQueuedMessage(QUEUED_FIXTURES.failed)).toMatchObject({ status: "failed", failureCode: "send_failed" });
  });
  it("refuses what is not the shape: no id, a bad time, a continue_chat that is not on the list, a failure code with spaces, a text over the limit", () => {
    const w = QUEUED_FIXTURES.waiting;
    expect(() => parseQueuedMessage({ ...w, id: "x" })).toThrow();
    expect(() => parseQueuedMessage({ ...w, queued_at: "yesterday" })).toThrow();
    expect(() => parseQueuedMessage({ ...w, continue_chat: "maybe" })).toThrow();
    expect(() => parseQueuedMessage({ ...w, failure_code: "has space" })).toThrow();
    expect(() => parseQueuedMessage({ ...w, text: "x".repeat(1300) })).toThrow();
    expect(() => parseQueuedMessage(null)).toThrow();
  });
  it("GET is {queued: null | {...}}; cancel is {id, status: cancelled}", () => {
    expect(parseQueuedRead({ queued: null })).toBeNull();
    expect(parseQueuedRead({ queued: QUEUED_FIXTURES.waiting })?.status).toBe("waiting_for_reply");
    expect(parseCancelled({ id: L, status: "cancelled" })).toEqual({ id: L, status: "cancelled" });
    expect(() => parseCancelled({ id: L, status: "sent" })).toThrow();
  });
  it("refusals are closed words from the API's code, else its status", () => {
    const e = (status: number, code: string) => new ApiRequestError(status, code, "x");
    expect(refusalOf(e(409, "stopped_by_customer"))).toBe("stopped_by_customer");
    expect(refusalOf(e(409, "consent_required"))).toBe("consent_required");
    expect(refusalOf(e(409, "already_queued"))).toBe("already_queued");
    expect(refusalOf(e(409, "window_open"))).toBe("window_open");
    expect(refusalOf(e(409, "no_whatsapp"))).toBe("no_whatsapp");
    expect(refusalOf(e(429, "rate_limited"))).toBe("daily_limit");
    expect(refusalOf(e(403, "forbidden"))).toBe("forbidden");
    expect(refusalOf(e(422, "text_invalid"))).toBe("text_invalid");
    expect(refusalOf(new Error("boom"))).toBe("down");
  });
});

describe("chat queue: the real routes (CHAT_QUEUE_SCREENS=1)", () => {
  beforeEach(() => {
    h.mode.v = "on";
  });
  it("POST queued-message with {text, client_id}; GET; cancel is a POST, never a DELETE", async () => {
    h.req.mockResolvedValueOnce(QUEUED_FIXTURES.waiting);
    const r = await queueMessage("tok", T, L, { text: "  Hello  ", clientId: C1 });
    expect(r).toMatchObject({ ok: true, data: { status: "waiting_for_reply" } });
    expect(h.req).toHaveBeenLastCalledWith(`/v1/tenants/${T}/conversations/${L}/queued-message`, "tok", { method: "POST", body: JSON.stringify({ text: "Hello", client_id: C1 }) });
    h.req.mockResolvedValueOnce({ queued: null });
    expect(await readQueued("tok", T, L)).toBeNull();
    expect(h.req).toHaveBeenLastCalledWith(`/v1/tenants/${T}/conversations/${L}/queued-message`, "tok");
    h.req.mockResolvedValueOnce({ id: C1, status: "cancelled" });
    expect(await cancelQueued("tok", T, L, C1)).toEqual({ ok: true, data: { id: C1, status: "cancelled" } });
    expect(h.req).toHaveBeenLastCalledWith(`/v1/tenants/${T}/conversations/${L}/queued-message/${C1}/cancel`, "tok", { method: "POST", body: "{}" });
    expect(h.req.mock.calls.every((c) => (c[2] as { method?: string } | undefined)?.method !== "DELETE")).toBe(true);
  });
  it("a refusal comes back as a closed word, never thrown; text outside 1..1000 never leaves", async () => {
    h.req.mockRejectedValueOnce(new ApiRequestError(409, "stopped_by_customer", "x"));
    expect(await queueMessage("tok", T, L, { text: "Hi", clientId: C1 })).toEqual({ ok: false, refusal: "stopped_by_customer" });
    h.req.mockClear();
    expect(await queueMessage("tok", T, L, { text: "   ", clientId: C1 })).toEqual({ ok: false, refusal: "text_invalid" });
    expect(await queueMessage("tok", T, L, { text: "x".repeat(1001), clientId: C1 })).toEqual({ ok: false, refusal: "text_invalid" });
    expect(h.req).not.toHaveBeenCalled();
  });
  it("a read that fails throws (the page counts it as none, the poll keeps what it shows); a 404 means the API has no such route", async () => {
    h.req.mockRejectedValueOnce(new ApiRequestError(500, "internal", "x"));
    await expect(readQueued("tok", T, L)).rejects.toBeTruthy();
    h.req.mockRejectedValueOnce(new ApiRequestError(404, "not_found", "x"));
    expect(await readQueued("tok", T, L)).toBeUndefined();
  });
  it("off: nothing is read and nothing is called", async () => {
    h.mode.v = "off";
    expect(await readQueued("tok", T, L)).toBeUndefined();
    expect(await queueMessage("tok", T, L, { text: "Hi", clientId: C1 })).toEqual({ ok: false, refusal: "not_available" });
    expect(h.req).not.toHaveBeenCalled();
  });
});

describe("chat queue: the mock walks every state and follows the same wire shape", () => {
  const status = async (s: number) => (await readQueued("tok", T, L, at(s)))?.status;
  it("normal: waiting, then sending, then sent; every answer passes the real parser", async () => {
    const r = await queueMessage("tok", T, L, { text: "Hello Ravi", clientId: C1 }, at(0));
    expect(r).toMatchObject({ ok: true, data: { status: "waiting_for_reply", continueChat: "sent" } });
    expect(await status(MOCK_REPLY_S - 1)).toBe("waiting_for_reply");
    expect(await status(MOCK_REPLY_S + 1)).toBe("sending");
    expect(await status(MOCK_REPLY_S + MOCK_SENDING_S + 1)).toBe("sent");
    expect(h.req).not.toHaveBeenCalled(); // nothing leaves the server
  });
  it("cancel while it waits; not_waiting once it went; one per chat (already_queued)", async () => {
    await queueMessage("tok", T, L, { text: "One", clientId: C1 }, at(0));
    expect(await queueMessage("tok", T, L, { text: "Two", clientId: C2 }, at(2))).toEqual({ ok: false, refusal: "already_queued" });
    expect(await queueMessage("tok", T, L, { text: "One", clientId: C1 }, at(2))).toMatchObject({ ok: true }); // the same client_id = the same message
    expect(await cancelQueued("tok", T, L, C1, at(MOCK_REPLY_S + 2))).toEqual({ ok: false, refusal: "not_waiting" });
    expect(await cancelQueued("tok", T, L, C1, at(3))).toEqual({ ok: true, data: { id: C1, status: "cancelled" } });
    expect(await status(4)).toBe("cancelled");
    expect(await queueMessage("tok", T, L, { text: "Two", clientId: C2 }, at(5))).toMatchObject({ ok: true }); // a new one after a cancel
  });
  it("#stopped, #fail, #expire walk to their state; #fail goes through on the retry", async () => {
    await queueMessage("tok", T, L, { text: "x #stopped", clientId: C1 }, at(0));
    expect(await status(MOCK_FAIL_S - 1)).toBe("waiting_for_reply");
    expect(await readQueued("tok", T, L, at(MOCK_FAIL_S + 1))).toMatchObject({ status: "cancelled", failureCode: "stopped_by_customer" });
    await queueMessage("tok", T, L, { text: "x #expire", clientId: C2 }, at(100));
    expect(await status(100 + MOCK_FAIL_S + 1)).toBe("expired");
    await queueMessage("tok", T, L, { text: "x #fail", clientId: C1 }, at(200));
    expect(await readQueued("tok", T, L, at(200 + MOCK_FAIL_S + 1))).toMatchObject({ status: "failed", failureCode: "send_failed" });
    await queueMessage("tok", T, L, { text: "x #fail", clientId: C2 }, at(300)); // Try again
    expect(await status(300 + MOCK_REPLY_S + MOCK_SENDING_S + 1)).toBe("sent");
  });
  it("#hello is continue_chat not_approved; #stop, #consent, #limit, #open are refused at the send", async () => {
    expect(await queueMessage("tok", T, L, { text: "x #hello", clientId: C1 }, at(0))).toMatchObject({ ok: true, data: { continueChat: "not_approved" } });
    h.jar.rows = [];
    expect(await queueMessage("tok", T, L, { text: "#stop", clientId: C1 }, at(0))).toEqual({ ok: false, refusal: "stopped_by_customer" });
    expect(await queueMessage("tok", T, L, { text: "#consent", clientId: C1 }, at(0))).toEqual({ ok: false, refusal: "consent_required" });
    expect(await queueMessage("tok", T, L, { text: "#limit", clientId: C1 }, at(0))).toEqual({ ok: false, refusal: "daily_limit" });
    expect(await queueMessage("tok", T, L, { text: "#open", clientId: C1 }, at(0))).toEqual({ ok: false, refusal: "window_open" });
  });
  it("a read of the mock never writes (the state is a function of the clock)", async () => {
    await queueMessage("tok", T, L, { text: "Hi", clientId: C1 }, at(0));
    const kept = JSON.stringify(h.jar.rows);
    await readQueued("tok", T, L, at(30));
    expect(JSON.stringify(h.jar.rows)).toBe(kept);
  });
});
