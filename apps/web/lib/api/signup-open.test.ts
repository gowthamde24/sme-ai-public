import { describe, expect, it } from "vitest";

import { parseSignupStatus } from "./signup-open";

describe("sign-up status: C1's answer, checked", () => {
  it("reads what is still missing", () => {
    expect(parseSignupStatus({ open: true, terms_version: "2026-11-26", privacy_version: "2026-11-26", email_confirmed: true, email_blocked: false, consent_done: false, phone_verified: false, trial_claimed: false })).toMatchObject({ open: true, consentDone: false, phoneVerified: false, termsVersion: "2026-11-26" });
  });
  it("a version that is not a plain version, or no body, is refused", () => {
    expect(() => parseSignupStatus({ open: true, terms_version: "<x>", privacy_version: "1" })).toThrow();
    expect(() => parseSignupStatus(null)).toThrow();
  });
});
