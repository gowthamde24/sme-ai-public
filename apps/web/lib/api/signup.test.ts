import { describe, expect, it } from "vitest";

import { BUSINESS_TYPES, SETUP_LANGUAGES, SIGNUP_ERRORS, type CompleteSetupInput, type SignUpError, type SignUpInput, type SignUpResult } from "./signup";

describe("the sign-up and setup types the screens import", () => {
  it("has exactly the contract's four sign-up error codes, and no 'email taken'", () => {
    expect([...SIGNUP_ERRORS]).toEqual(["weak_password", "terms_required", "too_many_signups", "invalid"]);
    expect(SIGNUP_ERRORS as readonly string[]).not.toContain("email_taken");
  });
  it("has exactly the contract's business types and languages", () => {
    expect([...BUSINESS_TYPES]).toEqual(["textiles", "construction", "other"]);
    expect([...SETUP_LANGUAGES]).toEqual(["en", "te", "hi", "kn"]);
  });
  it("the union types accept the contract's values (a compile-time check, run by tsc)", () => {
    const input: SignUpInput = { name: "A", email: "a@example.test", password: "x", businessName: "B", acceptTerms: true };
    const ok: SignUpResult = { ok: true, next: "check-email" };
    const errors: SignUpError[] = [...SIGNUP_ERRORS];
    const setup: CompleteSetupInput = { businessType: "textiles", language: "te" };
    expect([input.acceptTerms, ok.ok, errors.length, setup.language]).toEqual([true, true, 4, "te"]);
  });
});
