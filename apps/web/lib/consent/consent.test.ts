import { afterEach, describe, expect, it } from "vitest";

import { analyticsAllowed, whenAnalyticsAllowed } from "./analytics";
import { CONSENT_COOKIE, CONSENT_MAX_AGE, consentValue, cookieFrom, NOT_ASKED, readConsent, serializeConsent } from "./consent";

afterEach(() => {
  document.cookie = `${CONSENT_COOKIE}=; Path=/; Max-Age=0`;
});

describe("the cookie choice (job BH)", () => {
  it("no cookie, or anything but the two exact values, is 'not asked' with analytics OFF", () => {
    for (const raw of [undefined, null, "", "1", "1.a2", "0.a1", "1.A1", "a1", "1.a1; x", "true", "1.a0 ", "javascript:alert(1)"]) expect(readConsent(raw), String(raw)).toEqual(NOT_ASKED);
    expect(NOT_ASKED).toEqual({ decided: false, analytics: false });
  });
  it("reads the two answers", () => {
    expect(readConsent("1.a0")).toEqual({ decided: true, analytics: false });
    expect(readConsent("1.a1")).toEqual({ decided: true, analytics: true });
  });
  it("writes one year, site-wide, SameSite=Lax, and Secure only over https; analytics off writes a0", () => {
    expect(consentValue(false)).toBe("1.a0");
    expect(consentValue(true)).toBe("1.a1");
    expect(serializeConsent(false, false)).toBe(`sme_consent=1.a0; Path=/; SameSite=Lax; Max-Age=${CONSENT_MAX_AGE}`);
    expect(serializeConsent(true, true)).toBe(`sme_consent=1.a1; Path=/; SameSite=Lax; Max-Age=${CONSENT_MAX_AGE}; Secure`);
    expect(CONSENT_MAX_AGE).toBe(31_536_000);
    expect(serializeConsent(false, false)).not.toMatch(/HttpOnly/i); // the browser writes it
  });
  it("finds a cookie by its exact name in a document.cookie string", () => {
    expect(cookieFrom("a=1; sme_consent=1.a1; b=2", "sme_consent")).toBe("1.a1");
    expect(cookieFrom("xsme_consent=1.a1", "sme_consent")).toBeUndefined();
    expect(cookieFrom("", "sme_consent")).toBeUndefined();
    expect(cookieFrom("sme_consent", "sme_consent")).toBeUndefined();
  });
});

describe("analytics is behind one door and never loads by itself (job BH)", () => {
  it("is not allowed with no choice, with 'OK', or with a forged value", () => {
    expect(analyticsAllowed("")).toBe(false);
    expect(analyticsAllowed("sme_consent=1.a0")).toBe(false);
    expect(analyticsAllowed("sme_consent=1.a9")).toBe(false);
    expect(analyticsAllowed("other=1.a1")).toBe(false);
  });
  it("is allowed only after the Analytics switch was saved on", () => {
    expect(analyticsAllowed("sme_consent=1.a1")).toBe(true);
  });
  it("reads the browser's own cookie when no string is given", () => {
    expect(analyticsAllowed()).toBe(false);
    document.cookie = "sme_consent=1.a1; Path=/";
    expect(analyticsAllowed()).toBe(true);
  });
  it("the loader runs only when allowed", () => {
    let loads = 0;
    expect(whenAnalyticsAllowed(() => loads++)).toBe(false);
    document.cookie = "sme_consent=1.a0; Path=/";
    expect(whenAnalyticsAllowed(() => loads++)).toBe(false);
    expect(loads).toBe(0);
    document.cookie = "sme_consent=1.a1; Path=/";
    expect(whenAnalyticsAllowed(() => loads++)).toBe(true);
    expect(loads).toBe(1);
  });
});
