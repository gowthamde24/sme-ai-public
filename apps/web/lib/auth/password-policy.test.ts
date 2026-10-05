import { describe, expect, it } from "vitest";

import { MAX_PASSWORD, MIN_PASSWORD, validateNewPassword } from "./password-policy";

const GOOD = "maple river lantern 42";

describe("validateNewPassword", () => {
  it("accepts a long passphrase that matches its confirmation", () => {
    expect(validateNewPassword(GOOD, GOOD, "a@example.test")).toBeNull();
  });

  it("asks for the minimum length and says what it is", () => {
    const short = "x".repeat(MIN_PASSWORD - 1);
    expect(validateNewPassword(short, short, null)).toMatch(new RegExp(`at least ${MIN_PASSWORD}`));
    expect(validateNewPassword("x".repeat(MIN_PASSWORD) + "y", "x".repeat(MIN_PASSWORD) + "y", null)).toBeNull();
  });

  it("refuses more than bcrypt keeps", () => {
    const long = "ab ".repeat(MAX_PASSWORD);
    expect(validateNewPassword(long, long, null)).toMatch(/at most/);
  });

  it("refuses a mismatch, a repeated character, a common password and the email name", () => {
    expect(validateNewPassword(GOOD, GOOD + "x", null)).toMatch(/not the same/);
    expect(validateNewPassword("a".repeat(20), "a".repeat(20), null)).toMatch(/repeats/);
    expect(validateNewPassword("PasswordPassword", "PasswordPassword", null)).toMatch(/common/);
    expect(validateNewPassword("my-priya-sharma-2026", "my-priya-sharma-2026", "priya@example.test")).toMatch(/email name/);
  });

  it("does not trip on a short email name", () => {
    expect(validateNewPassword(GOOD, GOOD, "al@example.test")).toBeNull();
  });
});
