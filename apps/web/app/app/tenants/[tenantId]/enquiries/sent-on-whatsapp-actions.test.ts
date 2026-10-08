import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiAuthError, ApiRequestError } from "@/lib/api/client";
import { redirectMock, redirectTarget } from "@/test/helpers";

const requireUser = vi.fn();
const api = { recordTouch: vi.fn(), fetchQuote: vi.fn() };
const revalidatePath = vi.fn();

vi.mock("next/navigation", () => ({ redirect: (to: string) => redirectMock(to) }));
vi.mock("next/cache", () => ({ revalidatePath: (p: string) => revalidatePath(p) }));
vi.mock("@/lib/auth/session", () => ({ requireUser: () => requireUser() }));
vi.mock("@/lib/api/followups", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/api/followups")>()), recordTouch: (...a: unknown[]) => api.recordTouch(...a) }));
vi.mock("@/lib/api/quotes", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/api/quotes")>()), fetchQuote: (...a: unknown[]) => api.fetchQuote(...a) }));

import { recordQuoteSentAction } from "./sent-on-whatsapp-actions";

const T = "22222222-2222-2222-2222-222222222222";
const Q = "88888888-8888-4888-8888-888888888888";
const L = "33333333-3333-3333-3333-333333333333";
const OTHER_LEAD = "99999999-9999-4999-8999-999999999999";
const ID = "55555555-5555-4555-8555-555555555555";
const CANARY = "CANARY-5e7a31";
const PHONE = "+00 90000 20001";
const NOW = new Date("2026-10-08T10:30:00.000Z");

function form(over: Record<string, string> = {}): FormData {
  const data = new FormData();
  for (const [k, v] of Object.entries({ touch_id: ID, ...over })) data.set(k, v);
  return data;
}
const run = (over: Record<string, string> = {}) => recordQuoteSentAction(T, Q, undefined, form(over));
const quote = (over: Record<string, unknown> = {}) => ({ id: Q, lead_id: L, outcome: "approved", valid_until: "2026-10-21", ...over });

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  requireUser.mockResolvedValue({ id: "u", email: "e", accessToken: "tok", aal: "aal1" });
  api.fetchQuote.mockResolvedValue(quote());
  api.recordTouch.mockResolvedValue({ touch_id: ID, lead_id: L, direction: "out", replayed: false });
});
afterEach(() => vi.useRealTimers());

describe("recordQuoteSentAction: what it records", () => {
  it("authenticates, reads the quote, then records an OUTGOING WhatsApp touch for the quote's lead with the page's id, now", async () => {
    const r = await run();
    expect(requireUser).toHaveBeenCalledTimes(1);
    expect(api.fetchQuote).toHaveBeenCalledWith("tok", T, Q);
    expect(api.recordTouch).toHaveBeenCalledWith("tok", T, L, { id: ID, direction: "out", channel: "whatsapp" });
    expect(api.recordTouch.mock.calls[0][3]).not.toHaveProperty("occurredAt");
    expect(r).toEqual({ ok: true, channel: "whatsapp", at: "2026-10-08T10:30:00.000Z" });
  });

  it("the lead comes from the quote: a lead id in the form is not believed", async () => {
    await run({ lead_id: OTHER_LEAD, leadId: OTHER_LEAD, lead: OTHER_LEAD, contact_id: OTHER_LEAD });
    expect(api.recordTouch.mock.calls[0][2]).toBe(L);
  });

  it("the direction and the channel are fixed: a form that claims 'in', e-mail or a time is not believed", async () => {
    await run({ direction: "in", channel: "email", happened_at: "2026-10-01T10:00", occurred_at: "2026-10-01T10:00:00Z" });
    expect(api.recordTouch.mock.calls[0][3]).toEqual({ id: ID, direction: "out", channel: "whatsapp" });
  });

  it("an identical retry sends the same id (the database replays it)", async () => {
    await run();
    await run();
    expect(api.recordTouch.mock.calls.map((c) => c[3].id)).toEqual([ID, ID]);
  });

  it("revalidates the follow-up page and the due list, and NOT the quote page or the lead page", async () => {
    await run();
    expect(revalidatePath).toHaveBeenCalledWith(`/app/tenants/${T}/leads/${L}/followup`);
    expect(revalidatePath).toHaveBeenCalledWith(`/app/tenants/${T}/followups`);
    expect(revalidatePath).toHaveBeenCalledTimes(2);
  });

  it("the answer carries no phone number, no e-mail and nothing the API said", async () => {
    api.recordTouch.mockResolvedValue({ touch_id: ID, lead_id: L, direction: "out", replayed: false, phone: PHONE, email: "a@b.example.test", note: CANARY });
    expect(JSON.stringify(await run())).not.toMatch(/90000|@|CANARY/);
  });
});

describe("recordQuoteSentAction: what it refuses before it records anything", () => {
  it.each([
    [{ touch_id: "x" }, /out of date/],
    [{ touch_id: "" }, /out of date/],
    [{ touch_id: ID.toUpperCase().replace(/-/g, "") }, /out of date/],
  ])("%j is refused and nothing is read or recorded", async (over, message) => {
    const r = await run(over);
    expect(r?.ok).toBe(false);
    expect(r?.error).toMatch(message);
    expect(api.fetchQuote).not.toHaveBeenCalled();
    expect(api.recordTouch).not.toHaveBeenCalled();
  });

  it("a missing touch id (absent, not empty) is refused too", async () => {
    const data = form();
    data.delete("touch_id");
    expect((await recordQuoteSentAction(T, Q, undefined, data))?.error).toMatch(/out of date/);
    expect(api.recordTouch).not.toHaveBeenCalled();
  });

  it("malformed workspace or quote ids never reach the API", async () => {
    expect((await recordQuoteSentAction("x", Q, undefined, form()))?.error).toBe("This quote is not available.");
    expect((await recordQuoteSentAction(T, "../x", undefined, form()))?.error).toBe("This quote is not available.");
    expect(api.fetchQuote).not.toHaveBeenCalled();
    expect(api.recordTouch).not.toHaveBeenCalled();
  });

  it.each(["draft", "rejected", "withdrawn", "superseded"])("a %s quote: nothing is recorded", async (outcome) => {
    api.fetchQuote.mockResolvedValue(quote({ outcome }));
    const r = await run();
    expect(r).toEqual({ ok: false, error: "This quote is not approved (any more), so nothing was recorded." });
    expect(api.recordTouch).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("an expired quote: nothing is recorded, and the sentence points at the lead page; valid through its last day (India)", async () => {
    api.fetchQuote.mockResolvedValue(quote({ valid_until: "2026-10-08" }));
    expect((await run())?.ok).toBe(true);
    api.fetchQuote.mockResolvedValue(quote({ valid_until: "2026-10-07" }));
    const r = await run();
    expect(r?.ok).toBe(false);
    expect(r?.error).toMatch(/has expired, so nothing was recorded\. If you did send something, use "I sent a message" on the lead page\.$/);
    expect(api.recordTouch).toHaveBeenCalledTimes(1);
  });

  it("an unknown or foreign quote (404) says the quote is not available and records nothing", async () => {
    api.fetchQuote.mockRejectedValue(new ApiRequestError(404, "not_found", CANARY));
    expect(await run()).toEqual({ ok: false, error: "This quote is not available." });
    expect(api.recordTouch).not.toHaveBeenCalled();
  });

  it("a rejected session goes to sign-in, whether the quote read or the record says so", async () => {
    api.fetchQuote.mockRejectedValue(new ApiAuthError("no"));
    expect(await redirectTarget(() => run())).toBe("/login");
    api.fetchQuote.mockResolvedValue(quote());
    api.recordTouch.mockRejectedValue(new ApiAuthError("no"));
    expect(await redirectTarget(() => run())).toBe("/login");
  });
});

describe("recordQuoteSentAction: each refusal of the database has its own plain sentence (the shared wording)", () => {
  const E = (status: number, code: string, reason?: string) => new ApiRequestError(status, code, CANARY, reason);
  it.each([
    [E(409, "contact_blocked", "consent"), /^There is no recorded consent for this channel/, "consent"],
    [E(409, "contact_blocked", "contact"), /^This person has asked not to be contacted/, undefined],
    [E(409, "contact_blocked", "key"), /^This phone number or e-mail is on the do-not-contact list/, undefined],
    [E(409, "contact_blocked", "erased"), /^This person's details were erased/, undefined],
    [E(409, "no_suppression_key"), /^This person's number or e-mail has no suppression key yet/, undefined],
    [E(409, "no_followup_policy"), /^No follow-up policy is in force\./, undefined],
    [E(409, "followup_limit"), /^This lead has reached the limit of recorded touches\./, undefined],
    [E(409, "conflict"), /^This was already recorded with a different channel or time\./, undefined],
    [E(403, "forbidden"), /^Your role cannot record that a message was sent\./, undefined],
    [E(404, "not_found"), /^This quote is not available\./, undefined],
    [E(429, "rate_limited"), /^Too many requests\./, undefined],
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

  it("a failed quote read that is not a 404 becomes one of the same sentences, with no API text", async () => {
    api.fetchQuote.mockRejectedValue(new ApiRequestError(503, "api_unreachable", CANARY));
    const r = await run();
    expect(r?.error).toMatch(/^Follow-ups are not available right now\./);
    expect(JSON.stringify(r)).not.toContain(CANARY);
    expect(api.recordTouch).not.toHaveBeenCalled();
  });
});
