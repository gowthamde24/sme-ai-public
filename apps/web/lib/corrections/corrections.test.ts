import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiRequestError } from "@/lib/api/client";

const jar = new Map<string, string>();
const apiRequest = vi.fn();
vi.mock("next/headers", () => ({ cookies: async () => ({ get: (n: string) => (jar.has(n) ? { value: jar.get(n) } : undefined), set: (n: string, v: string, o?: { maxAge?: number }) => (o?.maxAge === 0 ? jar.delete(n) : jar.set(n, v)) }) }));
vi.mock("@/lib/api/client", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/api/client")>()), apiRequest: (...a: unknown[]) => apiRequest(...a) }));

import { COOKIE, checkInput, teach, undo } from "./source";

const T = "22222222-2222-4222-8222-222222222222";
const ID = "11111111-aaaa-4aaa-8aaa-000000000001";
const OK = { source: "call", sourceId: "c1", lineIndex: 2, answer: "We open at 10 am." };
beforeEach(() => {
  jar.clear();
  vi.clearAllMocks();
  vi.stubEnv("TEACH_SCREENS", "mock");
});

describe("checkInput", () => {
  it("accepts a good correction and trims the answer", () => {
    expect(checkInput({ ...OK, answer: "  We open at 10 am.  " })).toEqual({ source: "call", sourceId: "c1", lineIndex: 2, answer: "We open at 10 am." });
  });
  it.each([
    [{ ...OK, source: "email" }],
    [{ ...OK, sourceId: "" }],
    [{ ...OK, sourceId: "../x" }],
    [{ ...OK, lineIndex: -1 }],
    [{ ...OK, lineIndex: 1.5 }],
    [{ ...OK, answer: "x" }],
    [{ ...OK, answer: "a".repeat(601) }],
    [{ ...OK, answer: "<script>" }],
    [{ ...OK, answer: 5 }],
  ])("refuses %j", (input) => {
    expect(checkInput(input as never)).toBeNull();
  });
});

describe("mock", () => {
  it("keeps at most 8 and undo removes one", async () => {
    const first = await teach("tok", T, OK);
    expect(first.ok).toBe(true);
    for (let i = 0; i < 9; i++) await teach("tok", T, { ...OK, lineIndex: i });
    expect(JSON.parse(jar.get(COOKIE) ?? "[]")).toHaveLength(8);
    const last = JSON.parse(jar.get(COOKIE) ?? "[]").at(-1).id;
    expect(await undo("tok", T, last)).toEqual({ ok: true });
    expect(JSON.parse(jar.get(COOKIE) ?? "[]")).toHaveLength(7);
    expect(apiRequest).not.toHaveBeenCalled();
  });
  it("off: not available; bad ids and input: invalid", async () => {
    vi.stubEnv("TEACH_SCREENS", "");
    expect(await teach("tok", T, OK)).toEqual({ ok: false, error: "not_available" });
    vi.stubEnv("TEACH_SCREENS", "mock");
    expect(await teach("tok", "nope", OK)).toEqual({ ok: false, error: "invalid" });
    expect(await undo("tok", T, "nope")).toEqual({ ok: false, error: "invalid" });
  });
});

describe("C1's API (TEACH_SCREENS=1)", () => {
  beforeEach(() => vi.stubEnv("TEACH_SCREENS", "1"));
  it("posts the correction with C1's field names and reads the id; posts the undo", async () => {
    apiRequest.mockResolvedValueOnce({ id: ID });
    expect(await teach("tok", T, OK)).toEqual({ ok: true, id: ID });
    expect(apiRequest).toHaveBeenLastCalledWith(`/v1/tenants/${T}/knowledge/corrections`, "tok", { method: "POST", body: JSON.stringify({ source: "call", source_id: "c1", line_index: 2, corrected_answer: "We open at 10 am." }) });
    apiRequest.mockResolvedValueOnce({});
    expect(await undo("tok", T, ID)).toEqual({ ok: true });
    expect(apiRequest).toHaveBeenLastCalledWith(`/v1/tenants/${T}/knowledge/corrections/${ID}/undo`, "tok", { method: "POST", body: JSON.stringify({}) });
  });
  it.each([[403, "forbidden"], [404, "not_available"], [405, "not_available"], [422, "invalid"], [500, "down"]])("a %s is %s, never the API's words", async (status, error) => {
    apiRequest.mockRejectedValueOnce(new ApiRequestError(status, "x", "the API's own sentence"));
    expect(await teach("tok", T, OK)).toEqual({ ok: false, error });
  });
  it("an answer without a good id is 'down'", async () => {
    apiRequest.mockResolvedValueOnce({ id: "not-a-uuid" });
    expect(await teach("tok", T, OK)).toEqual({ ok: false, error: "down" });
  });
});
