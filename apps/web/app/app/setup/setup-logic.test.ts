import { describe, expect, it, vi } from "vitest";

import { ApiAuthError, ApiRequestError } from "@/lib/api/client";

import { runCompleteSetup, SETUP_TEXT } from "./setup-logic";

const TENANT = "22222222-2222-4222-8222-222222222222";
const ok = () => vi.fn(async (...args: [string, unknown]) => ({ tenantId: TENANT, created: args.length > 0 }));

describe("runCompleteSetup", () => {
  it("sends the two choices with the caller's token and answers ok", async () => {
    const submit = ok();
    expect(await runCompleteSetup({ businessType: "textiles", language: "te" }, { token: "tok", submit })).toEqual({ ok: true });
    expect(submit).toHaveBeenCalledWith("tok", { businessType: "textiles", language: "te" });
  });

  it("sends a well-formed business type to the API, which refuses one a person may not choose: its fixed sentence is shown", async () => {
    const submit = vi.fn(async () => {
      throw new ApiRequestError(422, "business_type_unavailable", "That kind of business is not available yet. Choose one of the kinds on the sign-up page.");
    });
    expect(await runCompleteSetup({ businessType: "bakery", language: "en" }, { token: "t", submit })).toEqual({ ok: false, error: "That kind of business is not available yet. Choose one of the kinds on the sign-up page." });
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it("is ok again for a repeat (the API says nothing new was made)", async () => {
    const submit = vi.fn(async () => ({ tenantId: TENANT, created: false }));
    expect(await runCompleteSetup({ businessType: "other", language: "en" }, { token: "t", submit })).toEqual({ ok: true });
  });

  it.each([
    [{ businessType: "Bakery Shop", language: "en" }],
    [{ businessType: "../x", language: "en" }],
    [{ businessType: "a".repeat(40), language: "en" }],
    [{ businessType: "x", language: "en" }],
    [{ businessType: "other", language: "fr" }],
    [{ businessType: "other" }],
    [{ language: "en" }],
    [null],
    ["x"],
    [{ businessType: ["other"], language: "en" }],
  ])("%j is refused before the API is called", async (input) => {
    const submit = ok();
    expect(await runCompleteSetup(input, { token: "t", submit })).toEqual({ ok: false, error: SETUP_TEXT.invalid });
    expect(submit).not.toHaveBeenCalled();
  });

  it("passes on the extra fields it was never meant to forward: only the two choices are sent", async () => {
    const submit = ok();
    await runCompleteSetup({ businessType: "other", language: "kn", businessName: "Mine", tenant_id: TENANT }, { token: "t", submit });
    expect((submit.mock.calls[0] as unknown[])[1]).toEqual({ businessType: "other", language: "kn" });
  });

  it("explains the three refusals the API explains", async () => {
    for (const [code, message] of [
      ["terms_required", "Accept the terms when you sign up to continue."],
      ["email_not_confirmed", "Confirm your email address first: use the link we sent you."],
      ["workspace_limit_reached", "Your plan includes one workspace and you already have it. Ask us if you need another."],
    ] as const) {
      const submit = vi.fn(async () => { throw new ApiRequestError(403, code, message); });
      expect(await runCompleteSetup({ businessType: "other", language: "en" }, { token: "t", submit })).toEqual({ ok: false, error: message });
    }
  });

  it("says 'sign in again' for a rejected session and a generic line for anything else, without echoing the cause", async () => {
    const rejected = vi.fn(async () => { throw new ApiAuthError("x"); });
    expect(await runCompleteSetup({ businessType: "other", language: "en" }, { token: "t", submit: rejected })).toEqual({ ok: false, error: SETUP_TEXT.session });
    const down = vi.fn(async () => { throw new ApiRequestError(503, "api_unreachable", "The API is unreachable at 10.0.0.9"); });
    const out = await runCompleteSetup({ businessType: "other", language: "en" }, { token: "t", submit: down });
    expect(out).toEqual({ ok: false, error: SETUP_TEXT.generic });
    const other = vi.fn(async () => { throw new Error("boom 10.0.0.9"); });
    expect(await runCompleteSetup({ businessType: "other", language: "en" }, { token: "t", submit: other })).toEqual({ ok: false, error: SETUP_TEXT.generic });
  });
});

describe("recording the Terms and Privacy Policy accepted at sign-up (job CF)", () => {
  const POL = { terms: "2026-11-01", privacy: "2026-10-01" };
  it("sends the two versions with the setup", async () => {
    const submit = ok();
    await runCompleteSetup({ businessType: "textiles", language: "te" }, { token: "tok", submit, policies: POL });
    expect(submit).toHaveBeenCalledWith("tok", { businessType: "textiles", language: "te", acceptedTerms: "2026-11-01", acceptedPrivacy: "2026-10-01" });
  });
  it("sends none when the account kept none, or only one of the two", async () => {
    const submit = ok();
    await runCompleteSetup({ businessType: "other", language: "en" }, { token: "t", submit });
    await runCompleteSetup({ businessType: "other", language: "en" }, { token: "t", submit, policies: { terms: "x" } });
    expect(submit).toHaveBeenNthCalledWith(1, "t", { businessType: "other", language: "en" });
    expect(submit).toHaveBeenNthCalledWith(2, "t", { businessType: "other", language: "en" });
  });
  it("a version that changed since sign-up still makes the business, and nothing is recorded for a version the person did not see", async () => {
    const submit = vi.fn(async (_t: string, choices: object) => {
      if ("acceptedTerms" in choices) throw new ApiRequestError(409, "policy_version_outdated", "x");
      return { tenantId: TENANT, created: true };
    });
    expect(await runCompleteSetup({ businessType: "other", language: "en" }, { token: "t", submit, policies: POL })).toEqual({ ok: true });
    expect(submit).toHaveBeenCalledTimes(2);
    expect(submit).toHaveBeenLastCalledWith("t", { businessType: "other", language: "en" });
  });
  it("any other refusal is not retried", async () => {
    const submit = vi.fn(async () => {
      throw new ApiRequestError(409, "workspace_limit_reached", "Too many.");
    });
    expect(await runCompleteSetup({ businessType: "other", language: "en" }, { token: "t", submit, policies: POL })).toEqual({ ok: false, error: "Too many." });
    expect(submit).toHaveBeenCalledTimes(1);
  });
});

describe("the name and what an 'Other' business is", () => {
  const made = () => vi.fn(async () => ({ tenantId: TENANT, created: true }));
  it("saves the name the Owner typed right after the business is made, for the business that was made", async () => {
    const saveName = vi.fn(async () => undefined);
    expect(await runCompleteSetup({ businessType: "gym", language: "en", businessName: "  Iron Gym " }, { token: "t", submit: made(), saveName })).toEqual({ ok: true });
    expect(saveName).toHaveBeenCalledWith("t", TENANT, "Iron Gym");
  });
  it("a name that cannot be saved does not undo the set-up (it is changed in Settings), but a rejected session is passed on as such", async () => {
    expect(await runCompleteSetup({ businessType: "gym", language: "en", businessName: "Iron Gym" }, { token: "t", submit: made(), saveName: async () => { throw new Error("down"); } })).toEqual({ ok: true });
    expect(await runCompleteSetup({ businessType: "gym", language: "en", businessName: "Iron Gym" }, { token: "t", submit: made(), saveName: async () => { throw new ApiAuthError("x"); } })).toEqual({ ok: false, error: SETUP_TEXT.session });
  });
  it("no name is asked of the old callers: nothing is saved and nothing fails", async () => {
    const saveName = vi.fn();
    expect(await runCompleteSetup({ businessType: "gym", language: "en" }, { token: "t", submit: made(), saveName })).toEqual({ ok: true });
    expect(saveName).not.toHaveBeenCalled();
  });
  it.each([[{ businessName: "" }, SETUP_TEXT.name], [{ businessName: "x".repeat(121) }, SETUP_TEXT.name], [{ businessLabel: "x" }, SETUP_TEXT.label], [{ businessLabel: "x".repeat(61) }, SETUP_TEXT.label]])("%j is refused before any request", async (extra, error) => {
    const submit = made();
    expect(await runCompleteSetup({ businessType: "other", language: "en", ...extra }, { token: "t", submit })).toEqual({ ok: false, error });
    expect(submit).not.toHaveBeenCalled();
  });
  it("sends what the 'Other' business is with the choices", async () => {
    const submit = made();
    await runCompleteSetup({ businessType: "other", language: "te", businessName: "Rao", businessLabel: " Paver block dealer " }, { token: "t", submit });
    expect(submit).toHaveBeenCalledWith("t", { businessType: "other", language: "te", businessLabel: "Paver block dealer" });
  });
});
