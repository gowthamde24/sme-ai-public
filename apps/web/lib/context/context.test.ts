import { beforeEach, describe, expect, it, vi } from "vitest";

const request = vi.fn();
const jar = vi.hoisted(() => new Map<string, string>());
vi.mock("next/headers", () => ({ cookies: async () => ({ get: (k: string) => (jar.has(k) ? { name: k, value: jar.get(k) } : undefined), set: (k: string, v: string, o?: { maxAge?: number }) => (o?.maxAge === 0 ? void jar.delete(k) : void jar.set(k, v)) }) }));
vi.mock("@/lib/api/client", async (orig) => ({ ...(await orig<typeof import("@/lib/api/client")>()), apiRequest: (...a: unknown[]) => request(...a) }));

import { ApiAuthError, ApiContractError, ApiRequestError } from "@/lib/api/client";
import { contextErrorOf, getContext, putContext, saveUnderstood, testContext, understand } from "@/lib/api/context";

import { liveApi, mockApi } from "./server";
import { parseContext, parseTest, parseUnderstood, parseVersions } from "./types";

const T = "22222222-2222-4222-8222-222222222222";
const STATE = { notes: "We deliver in Anantapur.", version: 3, updated_at: "2026-10-28T10:00:00Z", updated_by: { id: "u1", name: "Ravi" }, prompts: [{ key: "prices", label: "Prices", hint: "x" }, { key: "", label: "bad", hint: "" }], used_by: ["chats", "calls", 7] };
const PREVIEW = { preview_id: "pv_12345678", understood: [{ section: "prices", text: "Paver: 38" }, { section: "weird", text: "x" }], notes_markdown: "## Prices\nPaver: 38", source: { kind: "file", filename: "rates.xlsx" }, warnings: ["cells_cut", "nope"], expires_at: "2026-10-28T10:30:00Z" };
beforeEach(() => {
  jar.clear();
  request.mockReset();
});

describe("the notes as the API sends them", () => {
  it("reads the state, drops prompts without a key and used_by that are not words", () => {
    expect(parseContext(STATE)).toMatchObject({ notes: "We deliver in Anantapur.", version: 3, updatedBy: { id: "u1", name: "Ravi" }, prompts: [{ key: "prices", label: "Prices" }], usedBy: ["chats", "calls"] });
    expect(parseContext({ ...STATE, version: -1 })).toBeNull();
    expect(parseContext({ ...STATE, notes: 5 })).toBeNull();
    expect(parseContext("x")).toBeNull();
  });
  it("reads a preview: an unknown section becomes 'other', unknown warnings are dropped, a bad id is refused", () => {
    expect(parseUnderstood({ ...PREVIEW, warnings: ["read_from_picture", "cells_cut"] })?.warnings).toEqual(["read_from_picture", "cells_cut"]);
    expect(parseUnderstood(PREVIEW)).toMatchObject({ previewId: "pv_12345678", understood: [{ section: "prices" }, { section: "other" }], warnings: ["cells_cut"], source: { kind: "file", filename: "rates.xlsx" } });
    expect(parseUnderstood({ ...PREVIEW, preview_id: "../x" })).toBeNull();
  });
  it("reads a test answer and the versions", () => {
    expect(parseTest({ answer: "Yes", language: "en", used: [{ from: "notes", snippet: "s" }, { from: "facts", snippet: "f" }], would_hand_over: false, reason: null })).toEqual({ answer: "Yes", language: "en", used: [{ from: "notes", snippet: "s" }, { from: "facts", snippet: "f" }], wouldHandOver: false, reason: null });
    expect(parseTest({ answer: "", would_hand_over: true, reason: "asked_about_money" })?.reason).toBe("asked_about_money");
    expect(parseTest({ answer: "", would_hand_over: true, reason: "rude" })?.reason).toBeNull();
    expect(parseVersions({ items: [{ version: 2, updated_at: "t", updated_by: { name: "Ravi" }, size: 10, change: "added 3 lines" }, { version: "x" }] })).toEqual([{ version: 2, updatedAt: "t", updatedBy: "Ravi", size: 10, change: "added 3 lines" }]);
  });
});

describe("the API calls", () => {
  it("go to the workspace's own notes with the expected version, and a bad answer is a contract error", async () => {
    request.mockResolvedValue(STATE);
    expect((await getContext("tok", T)).version).toBe(3);
    expect(request).toHaveBeenLastCalledWith(`/v1/tenants/${T}/ai-assistant/context`, "tok");
    await putContext("tok", T, "hello", 3);
    expect(request).toHaveBeenLastCalledWith(`/v1/tenants/${T}/ai-assistant/context`, "tok", { method: "PUT", body: JSON.stringify({ notes: "hello", expected_version: 3 }) });
    request.mockResolvedValue({ nope: 1 });
    await expect(getContext("tok", T)).rejects.toBeInstanceOf(ApiContractError);
    await expect(getContext("tok", "x")).rejects.toBeInstanceOf(ApiContractError);
  });
  it("send a file, the edited preview and the question in the contract's names", async () => {
    request.mockResolvedValue(PREVIEW);
    await understand("tok", T, { kind: "file", filename: "r.xlsx", contentBase64: "QUJD", language: "te" });
    expect(request).toHaveBeenLastCalledWith(`/v1/tenants/${T}/ai-assistant/context/understand`, "tok", { method: "POST", body: JSON.stringify({ kind: "file", filename: "r.xlsx", content_base64: "QUJD", language: "te" }) });
    request.mockResolvedValue(STATE);
    await saveUnderstood("tok", T, "pv_12345678", "## A", "append", 3);
    expect(request).toHaveBeenLastCalledWith(`/v1/tenants/${T}/ai-assistant/context/understand/pv_12345678/save`, "tok", { method: "POST", body: JSON.stringify({ notes_markdown: "## A", mode: "append", expected_version: 3 }) });
    await expect(saveUnderstood("tok", T, "../x", "a", "append", 1)).rejects.toBeInstanceOf(ApiContractError);
    request.mockResolvedValue({ answer: "ok", would_hand_over: false });
    await testContext("tok", T, "q".repeat(600), "en");
    expect(JSON.parse((request.mock.calls.at(-1)?.[2] as { body: string }).body)).toEqual({ question: "q".repeat(500), language: "en" });
  });
  it("turn a refusal into a closed word, and never into the API's own English", () => {
    const e = (status: number, code: string, reason?: string) => contextErrorOf(new ApiRequestError(status, code, "English text", reason));
    expect(e(409, "context_changed")).toBe("changed");
    expect(e(410, "preview_expired")).toBe("expired");
    expect(e(422, "not_for_schools", "marks")).toBe("schools_marks");
    expect(e(422, "not_for_schools", "children")).toBe("schools_children");
    expect(e(422, "not_for_schools")).toBe("schools_fees");
    expect(e(422, "sheet_refused")).toBe("refused");
    expect(e(422, "file_unreadable")).toBe("unreadable");
    expect(e(422, "file_too_large")).toBe("toolarge");
    expect(e(422, "file_too_long")).toBe("toolong"); // more than 25 pages
    expect(e(503, "vision_unavailable")).toBe("vision"); // the picture reader is off
    expect(e(502, "model_unavailable")).toBe("busy");
    expect(e(429, "rate_limited")).toBe("slow");
    expect(e(403, "forbidden")).toBe("forbidden");
    expect(e(500, "x")).toBe("down");
    expect(contextErrorOf(new Error("x"))).toBe("down");
  });
  it("the live door answers {ok:false} for a refusal", async () => {
    request.mockRejectedValue(new ApiRequestError(409, "context_changed", "x"));
    expect(await liveApi("tok", T).put("a", 1)).toEqual({ ok: false, error: "changed" });
  });
  it("the live door lets a lapsed sign-in through (the route answers 401)", async () => {
    const signedOut = new ApiAuthError("signed out");
    request.mockImplementation(() => Promise.reject(signedOut));
    let caught: unknown = null;
    try {
      await liveApi("tok", T).get();
    } catch (e) {
      caught = e;
    }
    expect(caught).toBe(signedOut);
  });
});

describe("the stand-in (mock mode)", () => {
  it("keeps the notes per workspace with versions; a stale version is refused; restoring makes a new version", async () => {
    const api = mockApi("11111111-1111-4111-8111-111111111111");
    expect((await api.get())).toMatchObject({ ok: true, data: { notes: "", version: 0 } });
    expect(await api.put("one", 0)).toMatchObject({ ok: true, data: { version: 1 } });
    expect(await api.put("two", 0)).toEqual({ ok: false, error: "changed" });
    expect(await api.put("two", 1)).toMatchObject({ ok: true, data: { version: 2 } });
    expect(await api.put("two", 2)).toMatchObject({ ok: true, data: { version: 2 } }); // the same text changes nothing
    expect(await api.restore(1)).toMatchObject({ ok: true, data: { notes: "one", version: 3 } });
    const v = await api.versions();
    expect(v.ok && v.data.map((x) => x.version)).toEqual([3, 2, 1]);
    expect(await mockApi("22222222-2222-4222-8222-222222222222").get()).toMatchObject({ data: { version: 0 } });
  });
  it("shows a preview and saves it only when told: append keeps the notes, an expired one is refused; a price question waits for the owner when the notes have no price", async () => {
    const api = mockApi("33333333-3333-4333-8333-333333333333");
    expect(await api.test("what is the price?")).toMatchObject({ ok: true, data: { wouldHandOver: true, reason: "asked_about_money" } });
    const p = await api.understand({ kind: "paste", text: "Paver blocks: 38 rupees" });
    if (!p.ok) throw new Error("preview");
    expect((await api.get()).ok && (await api.get())).toMatchObject({ data: { version: 0 } }); // nothing saved by the preview
    await api.put("We deliver on Sundays.", 0);
    expect(await api.save(p.data.previewId, p.data.notesMarkdown, "append", 1)).toMatchObject({ ok: true, data: { version: 2, notes: expect.stringContaining("We deliver on Sundays.") } });
    expect(await api.save(p.data.previewId, "x", "append", 2)).toEqual({ ok: false, error: "expired" });
    expect(await api.test("what is the price of paver blocks?")).toMatchObject({ ok: true, data: { wouldHandOver: false, used: [{ from: "notes" }] } });
  });
});
