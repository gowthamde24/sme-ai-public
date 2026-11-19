import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ redirect: (to: string) => { throw new Error(`REDIRECT ${to}`); } }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
const requireUser = vi.fn();
vi.mock("@/lib/auth/session", () => ({ requireUser: () => requireUser() }));
vi.mock("@/i18n/get-lang", () => ({ getLang: async () => "en" }));
const fetchTenant = vi.fn();
import { ApiRequestError } from "@/lib/api/client";
vi.mock("@/lib/api/client", async (orig) => ({ ...(await orig<typeof import("@/lib/api/client")>()), fetchTenant: (...a: unknown[]) => fetchTenant(...a) }));
const api = { writeOwnMessage: vi.fn(), submitOwnMessage: vi.fn() };
vi.mock("@/lib/api/template-builder", () => ({ writeOwnMessage: (...a: unknown[]) => api.writeOwnMessage(...a), submitOwnMessage: (...a: unknown[]) => api.submitOwnMessage(...a) }));
const h = vi.hoisted(() => ({ mode: { v: "on" as "off" | "mock" | "on" } }));
vi.mock("@/lib/screens/flag", () => ({ jobsScreens: () => h.mode.v }));
const mfa = { listFactors: vi.fn(), challengeAndVerify: vi.fn() };
const getSession = vi.fn();
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => ({ auth: { mfa, getSession } }) }));

import type { Message } from "@/lib/templates/meta-checks";

import { submitOwnMessageAction, writeOwnMessageAction } from "./own-actions";

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
  mfa.listFactors.mockResolvedValue({ data: { totp: [{ id: "factor-1" }] } });
  mfa.challengeAndVerify.mockResolvedValue({ error: null });
  getSession.mockResolvedValue({ data: { session: { access_token: "fresh" } } });
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
    expect(mfa.challengeAndVerify).toHaveBeenCalledWith({ factorId: "factor-1", code: "482913" });
    expect(api.submitOwnMessage).toHaveBeenCalledWith("fresh", T, { title: { en: "Order update", te: null }, message: GOOD });
  });
  it("a wrong code is refused in plain words and nothing is sent", async () => {
    mfa.challengeAndVerify.mockResolvedValue({ error: { message: "invalid" } });
    expect(await submitOwnMessageAction(T, input(), "111111")).toMatchObject({ ok: false, kind: "invalid", code: "bad_code", error: expect.stringContaining("That code did not work") });
    expect(api.submitOwnMessage).not.toHaveBeenCalled();
  });
  it("no authenticator: told to set one up (kind mfa), never let through", async () => {
    mfa.listFactors.mockResolvedValue({ data: { totp: [] } });
    expect(await submitOwnMessageAction(T, input(), "482913")).toMatchObject({ ok: false, kind: "mfa", mfa: true });
    expect(mfa.challengeAndVerify).not.toHaveBeenCalled();
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
    expect(mfa.listFactors).not.toHaveBeenCalled();
    expect(api.submitOwnMessage).not.toHaveBeenCalled();
  });
  it("Sales is refused before anything", async () => {
    fetchTenant.mockResolvedValue({ role: "sales" });
    expect(await submitOwnMessageAction(T, input(), "482913")).toMatchObject({ ok: false, kind: "forbidden" });
    expect(mfa.listFactors).not.toHaveBeenCalled();
  });
  it("JOBS=mock: six digits are enough, no authenticator is asked, nothing leaves (the adapter answers Waiting)", async () => {
    h.mode.v = "mock";
    expect(await submitOwnMessageAction(T, input(), "482913")).toMatchObject({ ok: true });
    expect(mfa.listFactors).not.toHaveBeenCalled();
    expect(api.submitOwnMessage).toHaveBeenCalledWith("tok", T, expect.anything());
    expect(await submitOwnMessageAction(T, input(), "1234")).toMatchObject({ ok: false, kind: "invalid" });
  });
});
