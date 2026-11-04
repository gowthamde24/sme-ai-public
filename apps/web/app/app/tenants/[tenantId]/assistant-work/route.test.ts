import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiRequestError } from "@/lib/api/client";

const T = "11111111-1111-4111-8111-111111111111";
const P = "a1000000-0000-4000-8000-000000000001";
const S = "c1000000-0000-4000-8000-000000000001";
const KEY = "IM-CRM-0a1b2c3d4e5f-9931";
const h = vi.hoisted(() => ({ role: "owner", decide: vi.fn(), secret: vi.fn(), upload: vi.fn(), test: vi.fn(), undo: vi.fn(), undoAction: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireUser: async () => ({ accessToken: "tok" }) }));
vi.mock("@/lib/api/client", async (orig) => ({ ...(await orig<typeof import("@/lib/api/client")>()), fetchTenant: async () => ({ id: T, name: "Sri Lakshmi Silks", slug: "sls", role: h.role }) }));
vi.mock("@/lib/api/assistant-work", () => ({ decidePlan: (...a: unknown[]) => h.decide(...a), undoPlan: (...a: unknown[]) => h.undo(...a), saveAssistantSecret: (...a: unknown[]) => h.secret(...a), runSetupTest: (...a: unknown[]) => h.test(...a), undoAssistantAction: (...a: unknown[]) => h.undoAction(...a), uploadAssistantFile: (...a: unknown[]) => h.upload(...a) }));

import { POST } from "./route";
import { POST as UPLOAD } from "./upload/route";

const HOST = "app.example.test";
const same = { origin: `https://${HOST}`, host: HOST };
const post = (body: unknown, headers: Record<string, string> = same) => POST(new NextRequest(`https://${HOST}/app/tenants/${T}/assistant-work`, { method: "POST", headers, body: JSON.stringify(body) }), { params: Promise.resolve({ tenantId: T }) });
const plan = { planId: P, title: "x", steps: [{ tool: "a", summary: "b", undoable: true, status: "done", error: null }], sensitive: null, ownerOnly: false, needsSecondFactor: false, status: "done", expiresAt: null };

beforeEach(() => {
  vi.stubEnv("ASSISTANT_WORK_SCREENS", "1");
  h.role = "owner";
  for (const f of [h.decide, h.secret, h.upload, h.test, h.undo, h.undoAction]) f.mockReset();
});
afterEach(() => vi.unstubAllEnvs());

describe("POST /app/tenants/[id]/assistant-work", () => {
  it("is not there unless ASSISTANT_WORK_SCREENS is 1 (mock answers in the browser), and never for another site", async () => {
    vi.stubEnv("ASSISTANT_WORK_SCREENS", "mock");
    expect((await post({ op: "undo", planId: P })).status).toBe(404);
    vi.stubEnv("ASSISTANT_WORK_SCREENS", "1");
    expect((await post({ op: "undo", planId: P }, { origin: "https://evil.example", host: HOST })).status).toBe(404);
  });
  it("Do it passes the decision and the Owner's confirm; a refusal is a closed word", async () => {
    h.decide.mockResolvedValue(plan);
    expect(await (await post({ op: "decide", planId: P, decision: "do", confirmed: true })).json()).toEqual({ ok: true, plan });
    expect(h.decide).toHaveBeenCalledWith("tok", T, P, "do", true);
    h.decide.mockRejectedValue(new ApiRequestError(403, "mfa_required", "Your second factor, please."));
    expect(await (await post({ op: "decide", planId: P, decision: "do", confirmed: true })).json()).toEqual({ ok: false, error: "mfa" });
    h.decide.mockRejectedValue(new ApiRequestError(409, "plan_expired", "Old."));
    expect(await (await post({ op: "decide", planId: P, decision: "cancel" })).json()).toEqual({ ok: false, error: "expired" });
    // the contract's other 409s: a sensitive plan without its second tap, a plan that is no longer proposed, an Undo with nothing to undo
    for (const code of ["confirm_needed", "plan_state"]) {
      h.decide.mockRejectedValue(new ApiRequestError(409, code, "No."));
      expect(await (await post({ op: "decide", planId: P, decision: "do", confirmed: false })).json()).toEqual({ ok: false, error: "state" });
    }
    h.undo.mockRejectedValue(new ApiRequestError(409, "nothing_to_undo", "Nothing."));
    expect(await (await post({ op: "undo", planId: P })).json()).toEqual({ ok: false, error: "state" });
    h.undo.mockRejectedValue(new ApiRequestError(403, "forbidden", "Archiving is the Owner's."));
    expect(await (await post({ op: "undo", planId: P })).json()).toEqual({ ok: false, error: "forbidden" });
    expect((await post({ op: "decide", planId: "x", decision: "do" })).status).toBe(400);
  });
  it("a Viewer can do nothing here", async () => {
    h.role = "viewer";
    expect(await (await post({ op: "undo", planId: P })).json()).toEqual({ ok: false, error: "forbidden" });
    expect(h.undo).not.toHaveBeenCalled();
  });
  it("THE SECRET: only the Owner; the value goes to its one API call; the answer carries the last four only; nothing is logged", async () => {
    const logs = [vi.spyOn(console, "log"), vi.spyOn(console, "error"), vi.spyOn(console, "warn"), vi.spyOn(console, "info")];
    h.secret.mockResolvedValue({ last4: "9931" });
    const r = await post({ op: "secret", requestId: S, value: KEY });
    const text = await r.text();
    expect(JSON.parse(text)).toEqual({ ok: true, last4: "9931" });
    expect(text).not.toContain(KEY);
    expect(h.secret).toHaveBeenCalledWith("tok", T, S, KEY);
    h.secret.mockRejectedValue(new ApiRequestError(422, "secret_rejected", `bad key ${KEY}`));
    const refused = await (await post({ op: "secret", requestId: S, value: KEY })).text();
    expect(JSON.parse(refused)).toEqual({ ok: false, error: "rejected" });
    expect(refused).not.toContain(KEY);
    h.role = "sales";
    h.secret.mockReset();
    expect(await (await post({ op: "secret", requestId: S, value: KEY })).json()).toEqual({ ok: false, error: "forbidden" });
    expect(h.secret).not.toHaveBeenCalled();
    for (const l of logs) for (const call of l.mock.calls) expect(JSON.stringify(call)).not.toContain(KEY);
    for (const l of logs) l.mockRestore();
  });
  it("a live test and an Activity undo", async () => {
    h.test.mockResolvedValue({ ok: true, reason: null, detail: null, at: null });
    expect(await (await post({ op: "test", setupId: S, test: "pull_now" })).json()).toMatchObject({ ok: true, result: { ok: true } });
    expect((await post({ op: "test", setupId: S, test: "drop_tables" })).status).toBe(400);
    h.undoAction.mockRejectedValue(new ApiRequestError(409, "undo_expired", "Too late."));
    expect(await (await post({ op: "undo_action", actionId: S })).json()).toEqual({ ok: false, error: "expired" });
  });
});

describe("POST /app/tenants/[id]/assistant-work/upload", () => {
  const up = (name: string, body: BodyInit, headers: Record<string, string> = {}) => UPLOAD(new NextRequest(`https://${HOST}/app/tenants/${T}/assistant-work/upload?name=${encodeURIComponent(name)}`, { method: "POST", headers: { ...same, "content-type": "text/csv", ...headers }, body }), { params: Promise.resolve({ tenantId: T }) });
  it("passes a file the chat takes on to the API, and answers its id", async () => {
    h.upload.mockResolvedValue({ fileId: "b2000000-0000-4000-8000-000000000001", name: "leads.csv", size: 7, kind: "sheet", expiresAt: null });
    expect(await (await up("leads.csv", "a,b\n1,2")).json()).toEqual({ ok: true, file: { file_id: "b2000000-0000-4000-8000-000000000001", name: "leads.csv", size_bytes: 7, kind: "sheet", expires_at: null } });
    expect(h.upload.mock.calls[0][2]).toMatchObject({ name: "leads.csv", contentType: "text/csv" });
  });
  it("refuses a kind it does not take, an empty body and a body over 10 MB before calling the API", async () => {
    expect(await (await up("run.exe", "MZ")).json()).toEqual({ ok: false, error: "type" });
    expect(await (await up("run.exe", "MZ", { "content-type": "image/png" })).json()).toEqual({ ok: false, error: "type" }); // an extension the chat does not take: the type does not save it
    expect(await (await up("big.csv", "x", { "content-length": String(11 * 1024 * 1024) })).json()).toEqual({ ok: false, error: "size" });
    expect(await (await up("empty.csv", "")).json()).toEqual({ ok: false, error: "empty" });
    expect(h.upload).not.toHaveBeenCalled();
  });
  it("takes a PDF, a photo (HEIC with no type, as a phone sends it) and a Word file, and a camera picture with no extension by its type", async () => {
    h.upload.mockResolvedValue({ fileId: "b2000000-0000-4000-8000-000000000001", name: "x", size: 2, kind: "pdf", expiresAt: null });
    for (const [name, type] of [["brochure.pdf", "application/pdf"], ["IMG_2041.HEIC", ""], ["IMG_2042.heif", "image/heif"], ["rates.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"], ["IMG_2043", "image/jpeg"]]) {
      expect(await (await up(name, "%P", { "content-type": type })).json(), name).toMatchObject({ ok: true });
    }
    expect(h.upload).toHaveBeenCalledTimes(5);
  });
  it("the API's refusals (the contract: 413 file_too_large, 415 file_type, 422 file_empty) are the chip's closed words", async () => {
    for (const [status, code, word] of [[413, "file_too_large", "size"], [415, "file_type", "type"], [422, "file_empty", "empty"], [403, "forbidden", "forbidden"], [500, "internal", "down"]] as const) {
      h.upload.mockRejectedValue(new ApiRequestError(status, code, "English the chip never shows"));
      expect(await (await up("leads.csv", "a,b")).json(), code).toEqual({ ok: false, error: word });
    }
  });
});
