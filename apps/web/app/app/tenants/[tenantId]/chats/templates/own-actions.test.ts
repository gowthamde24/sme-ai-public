import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ redirect: (to: string) => { throw new Error(`REDIRECT ${to}`); } }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
const requireUser = vi.fn();
const second = vi.fn();
vi.mock("@/lib/auth/session", () => ({ requireUser: () => requireUser(), freshSecondStep: (c: string) => second(c) }));
vi.mock("@/i18n/get-lang", () => ({ getLang: async () => "en" }));
const fetchTenant = vi.fn();
import { ApiRequestError } from "@/lib/api/client";
vi.mock("@/lib/api/client", async (orig) => ({ ...(await orig<typeof import("@/lib/api/client")>()), fetchTenant: (...a: unknown[]) => fetchTenant(...a) }));
const api = { writeOwnMessage: vi.fn(), submitOwnMessage: vi.fn(), patchJob: vi.fn() };
vi.mock("@/lib/api/jobs", () => ({ patchJob: (...a: unknown[]) => api.patchJob(...a) }));
vi.mock("@/lib/api/template-builder", () => ({ writeOwnMessage: (...a: unknown[]) => api.writeOwnMessage(...a), submitOwnMessage: (...a: unknown[]) => api.submitOwnMessage(...a) }));
const h = vi.hoisted(() => ({ mode: { v: "on" as "off" | "mock" | "on" } }));
vi.mock("@/lib/screens/flag", () => ({ jobsScreens: () => h.mode.v }));

import type { Message } from "@/lib/templates/meta-checks";

import { submitOwnMessageAction, useOwnMessageAction, writeOwnMessageAction } from "./own-actions";

const T = "22222222-2222-4222-8222-222222222222";
const GOOD: Message = { category: "utility", drafts: { te: { header: null, body: "నమస్కారం {name} గారు, మీ order వచ్చింది.", footer: null, buttons: [] }, en: { header: "Order", body: "Hello {name}, your order has come.", footer: null, buttons: ["OK"] } } };
const input = (m: Message = GOOD) => ({ title: { en: " Order update ", te: null }, message: m });
const sent = { id: "own-1", title: { en: "Order update", te: null }, category: "utility", status: "waiting", submittedAt: "2026-11-19T05:12:00Z", decidedAt: null, reason: null };

beforeEach(() => {
  vi.clearAllMocks();
  h.mode.v = "on";
  requireUser.mockResolvedValue({ id: "u", accessToken: "tok" });
  fetchTenant.mockResolvedValue({ role: "owner" });
  api.submitOwnMessage.mockResolvedValue(sent);
  api.writeOwnMessage.mockResolvedValue({ kind: "unclear" });
  second.mockResolvedValue({ ok: true, token: "fresh" });
});

describe("writing a draft (Owner and Admin; nothing is sent anywhere)", () => {
  it("asks the writer with the sentence and the message so far", async () => {
    expect(await writeOwnMessageAction(T, "the order is out", GOOD)).toEqual({ ok: true, data: { kind: "unclear" } });
    expect(api.writeOwnMessage).toHaveBeenCalledWith("tok", T, { text: "the order is out", previous: GOOD });
    await writeOwnMessageAction(T, "the order is out", null);
    expect(api.writeOwnMessage).toHaveBeenLastCalledWith("tok", T, { text: "the order is out", previous: null });
  });
  it("Sales and Viewer are refused; a short sentence or a message with other braces never reaches the API", async () => {
    fetchTenant.mockResolvedValue({ role: "sales" });
    expect(await writeOwnMessageAction(T, "the order is out", null)).toMatchObject({ ok: false, kind: "forbidden" });
    fetchTenant.mockResolvedValue({ role: "admin" });
    expect(await writeOwnMessageAction(T, "ab", null)).toMatchObject({ ok: false, kind: "invalid" });
    const braces = { ...GOOD, drafts: { ...GOOD.drafts, en: { ...GOOD.drafts.en, body: "Hello {{1}}" } } };
    expect(await writeOwnMessageAction(T, "the order is out", braces)).toMatchObject({ ok: false, kind: "invalid" });
    expect(api.writeOwnMessage).not.toHaveBeenCalled();
  });
});

describe("sending to WhatsApp needs the second step", () => {
  it("checks the code on the person's own authenticator first, then sends with the fresh token", async () => {
    const r = await submitOwnMessageAction(T, input(), " 482 913 ");
    expect(r).toEqual({ ok: true, data: sent });
    expect(second).toHaveBeenCalledWith("482913");
    expect(api.submitOwnMessage).toHaveBeenCalledWith("fresh", T, { title: { en: "Order update", te: null }, message: GOOD });
  });
  it("a wrong code is refused in plain words and nothing is sent", async () => {
    second.mockResolvedValue({ ok: false, reason: "bad_code" });
    expect(await submitOwnMessageAction(T, input(), "111111")).toMatchObject({ ok: false, kind: "invalid", code: "bad_code", error: expect.stringContaining("That code did not work") });
    expect(api.submitOwnMessage).not.toHaveBeenCalled();
  });
  it("no authenticator: told to set one up (kind mfa), never let through", async () => {
    second.mockResolvedValue({ ok: false, reason: "no_factor" });
    expect(await submitOwnMessageAction(T, input(), "482913")).toMatchObject({ ok: false, kind: "mfa", mfa: true });
    expect(api.submitOwnMessage).not.toHaveBeenCalled();
    expect(api.submitOwnMessage).not.toHaveBeenCalled();
  });
  it("the API's own mfa_required refusal reads the same way", async () => {
    api.submitOwnMessage.mockRejectedValue(new ApiRequestError(403, "mfa_required", "x"));
    expect(await submitOwnMessageAction(T, input(), "482913")).toMatchObject({ ok: false, kind: "mfa", mfa: true });
  });
  it("a code that is not six digits, a message that fails the checks or a bad shape never gets as far as the authenticator", async () => {
    for (const code of ["12345", "1234567", "abcdef", ""]) expect(await submitOwnMessageAction(T, input(), code)).toMatchObject({ ok: false, kind: "invalid" });
    const shouted = { ...GOOD, drafts: { ...GOOD.drafts, en: { ...GOOD.drafts.en, body: "Hello {name}, READY NOW" } } };
    expect(await submitOwnMessageAction(T, input(shouted), "482913")).toMatchObject({ ok: false, kind: "invalid" });
    expect(await submitOwnMessageAction(T, { title: { en: "" }, message: GOOD }, "482913")).toMatchObject({ ok: false, kind: "invalid" });
    expect(await submitOwnMessageAction(T, null, "482913")).toMatchObject({ ok: false, kind: "invalid" });
    expect(second).not.toHaveBeenCalled();
    expect(api.submitOwnMessage).not.toHaveBeenCalled();
  });
  it("Sales is refused before anything", async () => {
    fetchTenant.mockResolvedValue({ role: "sales" });
    expect(await submitOwnMessageAction(T, input(), "482913")).toMatchObject({ ok: false, kind: "forbidden" });
    expect(second).not.toHaveBeenCalled();
  });
  it("JOBS=mock: six digits are enough, no authenticator is asked, nothing leaves (the adapter answers Waiting)", async () => {
    h.mode.v = "mock";
    expect(await submitOwnMessageAction(T, input(), "482913")).toMatchObject({ ok: true });
    expect(second).not.toHaveBeenCalled();
    expect(api.submitOwnMessage).toHaveBeenCalledWith("tok", T, expect.anything());
    expect(await submitOwnMessageAction(T, input(), "1234")).toMatchObject({ ok: false, kind: "invalid" });
  });
});

describe("JOBS off", () => {
  it("nothing is called: no draft, no second-step check, no send; the person and the API are not asked", async () => {
    h.mode.v = "off";
    expect(await writeOwnMessageAction(T, "the order is out", null)).toMatchObject({ ok: false, kind: "invalid" });
    expect(await submitOwnMessageAction(T, input(), "482913")).toMatchObject({ ok: false, kind: "invalid" });
    expect(requireUser).not.toHaveBeenCalled();
    expect(fetchTenant).not.toHaveBeenCalled();
    expect(second).not.toHaveBeenCalled();
    expect(api.writeOwnMessage).not.toHaveBeenCalled();
    expect(api.submitOwnMessage).not.toHaveBeenCalled();
  });
});

describe("`422 checks_failed`: our checks and the API's disagree", () => {
  it("is said in plain words (change the message and try again) and logged without the owner's words", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    api.submitOwnMessage.mockRejectedValueOnce(new ApiRequestError(422, "checks_failed", "no"));
    const r = await submitOwnMessageAction(T, input(), "482913");
    expect(r).toMatchObject({ ok: false, kind: "invalid", code: "checks_failed", error: "Our checks and WhatsApp's disagree. Change the message and try again." });
    expect(log).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(log.mock.calls)).not.toContain("order has come");
    log.mockRestore();
  });
  it("a missing second step stays the Security path, and any other refusal keeps the sentence of its kind", async () => {
    api.submitOwnMessage.mockRejectedValueOnce(new ApiRequestError(403, "mfa_required", "no"));
    expect(await submitOwnMessageAction(T, input(), "482913")).toMatchObject({ ok: false, kind: "mfa", mfa: true });
    api.submitOwnMessage.mockRejectedValueOnce(new ApiRequestError(503, "down", "no"));
    expect(await submitOwnMessageAction(T, input(), "482913")).toMatchObject({ ok: false, kind: "unavailable" });
  });
});

describe("\"Use it in a job\": PATCH /jobs/{id} {message_id}", () => {
  const J = "66666666-6666-4666-8666-666666666606";
  it("sends the message id (or null for the default) for the job, Owner and Admin only", async () => {
    api.patchJob.mockResolvedValue({ customName: null, enabled: true, status: "running", says: null });
    expect(await useOwnMessageAction(T, J, "6a1b2c3d-0000-4000-8000-000000000001")).toEqual({ ok: true, data: { jobId: J, messageId: "6a1b2c3d-0000-4000-8000-000000000001" } });
    expect(api.patchJob).toHaveBeenCalledWith("tok", T, J, { messageId: "6a1b2c3d-0000-4000-8000-000000000001" });
    await useOwnMessageAction(T, J, null);
    expect(api.patchJob).toHaveBeenLastCalledWith("tok", T, J, { messageId: null });
    fetchTenant.mockResolvedValue({ role: "sales" });
    expect(await useOwnMessageAction(T, J, null)).toMatchObject({ ok: false, kind: "forbidden" });
    expect(api.patchJob).toHaveBeenCalledTimes(2);
  });
  it("a job id or a message id that is not one never reaches the API; JOBS off: nothing happens", async () => {
    expect(await useOwnMessageAction(T, "nope", "m-1")).toMatchObject({ ok: false, kind: "invalid" });
    expect(await useOwnMessageAction(T, J, "bad id")).toMatchObject({ ok: false, kind: "invalid" });
    h.mode.v = "off";
    expect(await useOwnMessageAction(T, J, "m-1")).toMatchObject({ ok: false, kind: "invalid" });
    expect(api.patchJob).not.toHaveBeenCalled();
  });
  it("`422 setting_invalid` with fields [message_id] (not approved, or not a kind the job sends) is a plain error; a 404 or a 5xx is shown by its kind", async () => {
    api.patchJob.mockRejectedValueOnce(new ApiRequestError(422, "setting_invalid", "no", undefined, undefined, undefined, { fields: ["message_id"] }));
    expect(await useOwnMessageAction(T, J, "m-1")).toMatchObject({ ok: false, kind: "invalid", fields: ["message_id"], error: "That choice was not accepted. Pick another one." });
    api.patchJob.mockRejectedValueOnce(new ApiRequestError(404, "not_found", "no"));
    expect(await useOwnMessageAction(T, J, "m-1")).toMatchObject({ ok: false, kind: "not_found" });
    api.patchJob.mockRejectedValueOnce(new ApiRequestError(503, "down", "no"));
    expect(await useOwnMessageAction(T, J, "m-1")).toMatchObject({ ok: false, kind: "unavailable" });
  });
});
