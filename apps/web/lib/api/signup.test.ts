import { describe, expect, it } from "vitest";

import { BUSINESS_TYPES, SETUP_LANGUAGES, SIGNUP_ERRORS, type CompleteSetupInput, type SignUpError, type SignUpInput, type SignUpResult } from "./signup";

describe("the sign-up and setup types the screens import", () => {
  it("has exactly the contract's five sign-up error codes", () => {
    expect([...SIGNUP_ERRORS]).toEqual(["email_taken", "weak_password", "terms_required", "too_many_signups", "invalid"]);
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
    expect([input.acceptTerms, ok.ok, errors.length, setup.language]).toEqual([true, true, 5, "te"]);
  });
});
