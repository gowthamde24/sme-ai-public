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

  it("is ok again for a repeat (the API says nothing new was made)", async () => {
    const submit = vi.fn(async () => ({ tenantId: TENANT, created: false }));
    expect(await runCompleteSetup({ businessType: "other", language: "en" }, { token: "t", submit })).toEqual({ ok: true });
  });

  it.each([
    [{ businessType: "bakery", language: "en" }],
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
