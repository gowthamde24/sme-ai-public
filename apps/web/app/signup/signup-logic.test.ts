import { describe, expect, it, vi } from "vitest";

import { createSignupLimiter } from "@/lib/auth/signup-limit";
import { TERMS_VERSION } from "@/lib/auth/terms";

import { runSignUp, type SignUpAuth } from "./signup-logic";

const GOOD = {
  name: "Asha Rao",
  email: "Asha@Example.test",
  password: "a long enough passphrase",
  businessName: "Sri Lakshmi Silks",
  acceptTerms: true,
};

function deps(over: Partial<{ signUp: SignUpAuth["signUp"]; allow: boolean }> = {}) {
  const signUp = vi.fn(over.signUp ?? (async () => ({ data: { user: { identities: [{}] } }, error: null })));
  const limiter = { allow: vi.fn(() => over.allow ?? true) };
  return { signUp, limiter, d: { auth: { signUp } as SignUpAuth, limiter, ip: "203.0.113.7" } };
}

describe("runSignUp", () => {
  it("signs up with the lower-cased address and sends the terms version, name and business name as metadata (never the password anywhere else)", async () => {
    const { signUp, d } = deps();
    expect(await runSignUp(GOOD, d)).toEqual({ ok: true, next: "check-email" });
    expect(signUp).toHaveBeenCalledOnce();
    expect(signUp).toHaveBeenCalledWith({
      email: "asha@example.test",
      password: GOOD.password,
      options: { data: { display_name: "Asha Rao", business_name: "Sri Lakshmi Silks", terms_version: TERMS_VERSION } },
    });
    expect(TERMS_VERSION).toBe("draft-1");
  });

  it.each([
    ["no name", { name: " " }],
    ["a name over 100 characters", { name: "x".repeat(101) }],
    ["no email", { email: "" }],
    ["a bad email", { email: "no-at-sign" }],
    ["an email over 254 characters", { email: `${"a".repeat(250)}@b.test` }],
    ["no business name", { businessName: "  " }],
    ["a business name over 120 characters", { businessName: "x".repeat(121) }],
  ])("%s is invalid and never reaches the Auth server or the brake", async (_label, over) => {
    const { signUp, limiter, d } = deps();
    expect(await runSignUp({ ...GOOD, ...over }, d)).toEqual({ ok: false, error: "invalid" });
    expect(signUp).not.toHaveBeenCalled();
    expect(limiter.allow).not.toHaveBeenCalled();
  });

  it.each([null, undefined, "x", 5, [], {}])("a body that is %j is invalid", async (body) => {
    const { signUp, d } = deps();
    expect(await runSignUp(body, d)).toEqual({ ok: false, error: "invalid" });
    expect(signUp).not.toHaveBeenCalled();
  });

  it.each([false, undefined, "true", 1, null])("terms %j are not accepted", async (acceptTerms) => {
    const { signUp, d } = deps();
    expect(await runSignUp({ ...GOOD, acceptTerms }, d)).toEqual({ ok: false, error: "terms_required" });
    expect(signUp).not.toHaveBeenCalled();
  });

  it.each(["short", "password1234", "a".repeat(73), "asha@example.test!!", "aaaaaaaaaaaaaaaa", 12345678901234, undefined])(
    "the password %j is weak",
    async (password) => {
      const { signUp, d } = deps();
      expect(await runSignUp({ ...GOOD, password }, d)).toEqual({ ok: false, error: "weak_password" });
      expect(signUp).not.toHaveBeenCalled();
    },
  );

  it("refuses with too_many_signups when the address is at its limit, before the Auth server is asked", async () => {
    const { signUp, limiter, d } = deps({ allow: false });
    expect(await runSignUp(GOOD, d)).toEqual({ ok: false, error: "too_many_signups" });
    expect(limiter.allow).toHaveBeenCalledWith("203.0.113.7");
    expect(signUp).not.toHaveBeenCalled();
  });

  it("holds the real brake to N per hour per address", async () => {
    const real = createSignupLimiter({ maxPerHour: 5, now: () => 1 });
    const { signUp } = deps();
    const results = [];
    for (let i = 0; i < 7; i += 1) {
      results.push(await runSignUp({ ...GOOD, email: `p${i}@example.test` }, { auth: { signUp } as SignUpAuth, limiter: real, ip: "198.51.100.9" }));
    }
    expect(results.filter((r) => r.ok)).toHaveLength(5);
    expect(results.slice(5)).toEqual([{ ok: false, error: "too_many_signups" }, { ok: false, error: "too_many_signups" }]);
    // a different address is not held back
    expect(await runSignUp(GOOD, { auth: { signUp } as SignUpAuth, limiter: real, ip: "198.51.100.10" })).toEqual({ ok: true, next: "check-email" });
  });

  it.each([
    [{ code: "user_already_exists", status: 422 }, "email_taken"],
    [{ code: "email_exists", status: 422 }, "email_taken"],
    [{ code: "weak_password", status: 422 }, "weak_password"],
    [{ code: "over_email_send_rate_limit", status: 429 }, "too_many_signups"],
    [{ code: "over_request_rate_limit", status: 429 }, "too_many_signups"],
    [{ status: 429 }, "too_many_signups"],
    [{ code: "signup_disabled", status: 422 }, "invalid"],
    [{ code: "unexpected_failure", status: 500 }, "invalid"],
    [{}, "invalid"],
  ])("maps the Auth error %j to %s", async (error, want) => {
    const { d } = deps({ signUp: async () => ({ data: null, error }) });
    expect(await runSignUp(GOOD, d)).toEqual({ ok: false, error: want });
  });

  it("treats a user with no identities (a project that hides existing accounts) as email_taken", async () => {
    const { d } = deps({ signUp: async () => ({ data: { user: { identities: [] } }, error: null }) });
    expect(await runSignUp(GOOD, d)).toEqual({ ok: false, error: "email_taken" });
  });

  it("a thrown network error is 'invalid', never a crash, and says nothing about the cause", async () => {
    const { d } = deps({ signUp: async () => { throw new Error("ECONNREFUSED 10.1.2.3"); } });
    expect(await runSignUp(GOOD, d)).toEqual({ ok: false, error: "invalid" });
  });

  it("never puts the password or the address in what it returns", async () => {
    const { d } = deps({ signUp: async () => ({ data: null, error: { code: "weak_password" } }) });
    const out = JSON.stringify(await runSignUp(GOOD, d));
    expect(out).not.toContain(GOOD.password);
    expect(out.toLowerCase()).not.toContain("example.test");
  });
});
