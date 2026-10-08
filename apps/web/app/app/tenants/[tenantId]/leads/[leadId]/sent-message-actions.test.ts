import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiAuthError, ApiRequestError } from "@/lib/api/client";
import { redirectMock, redirectTarget } from "@/test/helpers";

const requireUser = vi.fn();
const api = { recordTouch: vi.fn() };
const revalidatePath = vi.fn();

vi.mock("next/navigation", () => ({ redirect: (to: string) => redirectMock(to) }));
vi.mock("next/cache", () => ({ revalidatePath: (p: string) => revalidatePath(p) }));
vi.mock("@/lib/auth/session", () => ({ requireUser: () => requireUser() }));
vi.mock("@/lib/api/followups", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/api/followups")>()), recordTouch: (...a: unknown[]) => api.recordTouch(...a) }));

import { recordSentMessageAction } from "./sent-message-actions";

const T = "22222222-2222-2222-2222-222222222222";
const L = "44444444-4444-4444-4444-444444444444";
const ID = "55555555-5555-4555-8555-555555555555";
const CANARY = "CANARY-8c2f19";
const PHONE = "+00 90000 20001";

function form(over: Record<string, string> = {}): FormData {
  const data = new FormData();
  for (const [k, v] of Object.entries({ touch_id: ID, channel: "whatsapp", happened_at: "", ...over })) data.set(k, v);
  return data;
}
const run = (over: Record<string, string> = {}) => recordSentMessageAction(T, L, undefined, form(over));

beforeEach(() => {
  vi.clearAllMocks();
  requireUser.mockResolvedValue({ id: "u", email: "e", accessToken: "tok", aal: "aal1" });
  api.recordTouch.mockResolvedValue({ touch_id: ID, lead_id: L, direction: "out", replayed: false });
});
afterEach(() => vi.useRealTimers());

describe("recordSentMessageAction: what it records", () => {
  it("authenticates first, then records an OUTGOING touch with the user's token, the page's id and the chosen channel", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-08T10:30:00.000Z"));
    const r = await run();
    expect(requireUser).toHaveBeenCalledTimes(1);
    expect(api.recordTouch).toHaveBeenCalledWith("tok", T, L, { id: ID, direction: "out", channel: "whatsapp" });
    expect(r).toEqual({ ok: true, channel: "whatsapp", at: "2026-10-08T10:30:00.000Z" });
  });
  it("the direction is fixed to outgoing: a form that claims 'in' is not believed", async () => {
    await run({ direction: "in" });
    expect(api.recordTouch.mock.calls[0][3].direction).toBe("out");
  });
  it("an empty time means now (no occurredAt is sent); a given India time is sent as an instant and echoed", async () => {
    await run();
    expect(api.recordTouch.mock.calls[0][3]).not.toHaveProperty("occurredAt");
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-08T12:00:00.000Z"));
    const r = await run({ happened_at: "2026-10-08T14:30" }); // 14:30 India time = 09:00 UTC
    expect(api.recordTouch.mock.calls[1][3].occurredAt).toBe("2026-10-08T09:00:00.000Z");
    expect(r).toMatchObject({ ok: true, at: "2026-10-08T09:00:00.000Z" });
  });
  it("revalidates the follow-up page and the due list, and NOT the lead page (that would re-render it with a new id and hide the success sentence)", async () => {
    await run();
    expect(revalidatePath).toHaveBeenCalledWith(`/app/tenants/${T}/leads/${L}/followup`);
    expect(revalidatePath).toHaveBeenCalledWith(`/app/tenants/${T}/followups`);
    expect(revalidatePath).not.toHaveBeenCalledWith(`/app/tenants/${T}/leads/${L}`);
  });
  it("the answer carries no phone number, no e-mail and nothing the API said", async () => {
    api.recordTouch.mockResolvedValue({ touch_id: ID, lead_id: L, direction: "out", replayed: false, phone: PHONE, email: "a@b.example.test", note: CANARY });
    const text = JSON.stringify(await run());
    expect(text).not.toMatch(/90000|@|CANARY/);
  });
});

describe("recordSentMessageAction: what it refuses before the database", () => {
  it.each([
    [{ channel: "" }, "Choose the channel."],
    [{ channel: "pigeon" }, "Choose the channel."],
    [{ happened_at: "soon" }, /Enter the date and time/],
    [{ happened_at: "2999-01-01T10:00" }, /cannot be in the future/],
    [{ happened_at: "2026-02-30T10:00" }, /do not exist/],
    [{ touch_id: "x" }, /out of date/],
    [{ touch_id: "" }, /out of date/],
  ])("%j is refused and nothing is recorded", async (over, message) => {
    const r = await run(over as Record<string, string>);
    expect(r?.ok).toBe(false);
    expect(r?.error).toMatch(message);
    expect(api.recordTouch).not.toHaveBeenCalled();
  });
  it("a missing channel field (absent, not empty) is refused too", async () => {
    const data = form();
    data.delete("channel");
    expect((await recordSentMessageAction(T, L, undefined, data))?.error).toBe("Choose the channel.");
    expect(api.recordTouch).not.toHaveBeenCalled();
  });
  it("malformed workspace or lead ids never reach the API", async () => {
    expect((await recordSentMessageAction("x", L, undefined, form()))?.error).toBe("This lead is not available.");
    expect((await recordSentMessageAction(T, "../x", undefined, form()))?.error).toBe("This lead is not available.");
    expect(api.recordTouch).not.toHaveBeenCalled();
  });
});

describe("recordSentMessageAction: each refusal of the database has its own plain sentence", () => {
  const E = (status: number, code: string, reason?: string) => new ApiRequestError(status, code, CANARY, reason);
  it.each([
    [E(409, "contact_blocked", "consent"), /^There is no recorded consent for this channel, or this person has no number or e-mail for it\./, "consent"],
    [E(409, "contact_blocked", "contact"), /^This person has asked not to be contacted/, undefined],
    [E(409, "contact_blocked", "key"), /^This phone number or e-mail is on the do-not-contact list/, undefined],
    [E(409, "contact_blocked", "erased_key"), /^This phone number or e-mail is on the do-not-contact list/, undefined],
    [E(409, "contact_blocked", "erased"), /^This person's details were erased/, undefined],
    [E(409, "contact_blocked", "something_new"), /^This person cannot be contacted/, undefined],
    [E(409, "contact_blocked"), /^This person cannot be contacted/, undefined],
    [E(409, "no_suppression_key"), /^This person's number or e-mail has no suppression key yet.*Suppression keys page\./, undefined],
    [E(409, "no_followup_policy"), /^No follow-up policy is in force\. The owner must publish one/, undefined],
    [E(409, "followup_limit"), /^This lead has reached the limit of recorded touches\./, undefined],
    [E(409, "token_expiring"), /^Your session is about to expire\. Sign in again/, undefined],
    [E(409, "conflict"), /^This was already recorded with a different channel or time\./, undefined],
    [E(422, "invalid_value"), /^That channel or time was not accepted\./, undefined],
    [E(422, "validation_error"), /^That channel or time was not accepted\./, undefined],
    [E(403, "forbidden"), /^Your role cannot record that a message was sent\./, undefined],
    [E(404, "not_found"), /^This lead is not available\./, undefined],
    [E(429, "rate_limited"), /^Too many requests\./, undefined],
    [E(503, "api_unreachable"), /^Follow-ups are not available right now\./, undefined],
    [E(503, "followups_unavailable"), /^Follow-ups are not available right now\./, undefined],
    [E(500, "http_error"), /^Could not record this\. Try again\./, undefined],
    [new Error(CANARY), /^Could not record this\. Try again\./, undefined],
  ])("%s becomes one sentence of our own", async (error, sentence, reason) => {
    api.recordTouch.mockRejectedValue(error);
    const r = await run();
    expect(r?.ok).toBe(false);
    expect(r?.error).toMatch(sentence);
    expect(r?.reason).toBe(reason);
    expect(JSON.stringify(r)).not.toContain(CANARY);
    expect(r).not.toHaveProperty("at");
    expect(revalidatePath).not.toHaveBeenCalled();
  });
  it("only a consent refusal carries the consent flag", async () => {
    api.recordTouch.mockRejectedValue(new ApiRequestError(409, "contact_blocked", "x", "key"));
    expect((await run())?.reason).toBeUndefined();
  });
  it("a rejected session goes to sign-in", async () => {
    api.recordTouch.mockRejectedValue(new ApiAuthError("no"));
    expect(await redirectTarget(() => run())).toBe("/login");
  });
});
