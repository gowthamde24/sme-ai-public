import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiAuthError, ApiRequestError } from "@/lib/api/client";
import { redirectMock, redirectTarget } from "@/test/helpers";

const requireUser = vi.fn();
const api = { recordConsent: vi.fn() };
const revalidatePath = vi.fn();

vi.mock("next/navigation", () => ({ redirect: (to: string) => redirectMock(to) }));
vi.mock("next/cache", () => ({ revalidatePath: (p: string) => revalidatePath(p) }));
vi.mock("@/lib/auth/session", () => ({ requireUser: () => requireUser() }));
vi.mock("@/lib/api/consent", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/api/consent")>()), recordConsent: (...a: unknown[]) => api.recordConsent(...a) }));

import { recordConsentAction } from "./actions";

const T = "22222222-2222-2222-2222-222222222222";
const C = "44444444-4444-4444-4444-444444444444";
const CANARY = "CANARY-77d0c1";
const NOW = { whatsapp: "granted", phone: "unknown", email: "unknown" };

function form(over: Record<string, string> = {}): FormData {
  const data = new FormData();
  const base: Record<string, string> = { channel: "whatsapp", status: "granted", basis: "explicit_consent", evidence_kind: "verbal", evidence_label: "call-2026-10-08" };
  for (const [k, v] of Object.entries({ ...base, ...over })) data.set(k, v);
  return data;
}
const run = (over: Record<string, string> = {}) => recordConsentAction(T, C, undefined, form(over));

beforeEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
  requireUser.mockResolvedValue({ id: "u", email: "asha@example.test", accessToken: "tok", aal: "aal1" });
  api.recordConsent.mockResolvedValue(NOW);
});

describe("recordConsentAction", () => {
  it("authenticates first and sends a granted entry with the user's token", async () => {
    const r = await run();
    expect(requireUser).toHaveBeenCalledTimes(1);
    expect(api.recordConsent).toHaveBeenCalledWith("tok", T, C, { channel: "whatsapp", status: "granted", basis: "explicit_consent", evidenceKind: "verbal", evidenceLabel: "call-2026-10-08" });
    expect(revalidatePath).toHaveBeenCalledWith(`/app/tenants/${T}/contacts/${C}/consent`);
    expect(r?.ok).toBe(true);
    expect(r?.consents).toEqual(NOW);
  });
  it("says who recorded it and when: the signed-in person and the moment the action ran", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-08T10:30:00.000Z"));
    const r = await run();
    expect(r?.by).toBe("asha@example.test");
    expect(r?.at).toBe("2026-10-08T10:30:00.000Z");
  });
  it("an account without an e-mail is named plainly, not left blank", async () => {
    requireUser.mockResolvedValue({ id: "u", email: null, accessToken: "tok", aal: "aal1" });
    expect((await run())?.by).toBe("your account");
  });
  it("a second factor is not asked for: a password-only session is passed to the API, which decides", async () => {
    expect((await run())?.ok).toBe(true);
    expect(api.recordConsent).toHaveBeenCalledTimes(1);
  });
  it("a withdrawn entry sends no basis and no evidence, whatever the form carried", async () => {
    await run({ status: "withdrawn", channel: "phone" });
    expect(api.recordConsent).toHaveBeenCalledWith("tok", T, C, { channel: "phone", status: "withdrawn" });
  });
  it("the answer carries no verdict word and no number or address", async () => {
    const text = JSON.stringify(await run());
    expect(text).not.toMatch(/valid|lawful|compliant|90000/i);
  });
  it.each([
    [{ channel: "pigeon" }, /Choose the channel/],
    [{ channel: "" }, /Choose the channel/],
    [{ status: "unknown" }, /Choose Granted or Withdrawn/],
    [{ status: "" }, /Choose Granted or Withdrawn/],
    [{ basis: "vibes" }, /Choose the basis/],
    [{ evidence_kind: "imported" }, /kind of evidence/],
    [{ evidence_label: "" }, /short label/],
    [{ evidence_label: "two words" }, /short label/],
    [{ evidence_label: "a@b" }, /short label/],
    [{ evidence_label: "x".repeat(97) }, /short label/],
  ])("refuses %j before the API is called", async (over, message) => {
    const r = await run(over);
    expect(r?.ok).toBe(false);
    expect(r?.error).toMatch(message);
    expect(api.recordConsent).not.toHaveBeenCalled();
  });
  it("a malformed ids never reach the API", async () => {
    expect((await recordConsentAction("x", C, undefined, form()))?.error).toBe("This person is not available.");
    expect((await recordConsentAction(T, "../x", undefined, form()))?.error).toBe("This person is not available.");
    expect(api.recordConsent).not.toHaveBeenCalled();
  });
  it("a rejected session goes to sign-in", async () => {
    api.recordConsent.mockRejectedValue(new ApiAuthError("no"));
    expect(await redirectTarget(() => run())).toBe("/login");
  });
  it.each([
    [new ApiRequestError(403, "forbidden", CANARY), /Your role cannot record consent/],
    [new ApiRequestError(404, "not_found", CANARY), /This person is not available/],
    [new ApiRequestError(409, "conflict", CANARY), /cannot be recorded for this person right now/],
    [new ApiRequestError(422, "validation_error", CANARY), /Check the values/],
    [new ApiRequestError(503, "api_unreachable", CANARY), /Could not record this/],
    [new Error(CANARY), /Could not record this/],
  ])("%s becomes a short sentence of our own, and nothing the API said is echoed", async (error, sentence) => {
    api.recordConsent.mockRejectedValue(error);
    const r = await run();
    expect(r?.ok).toBe(false);
    expect(r?.error).toMatch(sentence);
    expect(JSON.stringify(r)).not.toContain(CANARY);
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
