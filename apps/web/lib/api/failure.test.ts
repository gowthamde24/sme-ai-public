import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { appT } from "@/i18n/app";
import { redirectMock } from "@/test/helpers";

vi.mock("next/navigation", () => ({
  redirect: (to: string) => redirectMock(to),
  forbidden: () => {
    throw new Error("NEXT_HTTP_ERROR_FALLBACK;403");
  },
}));

import { ApiAuthError, ApiRequestError } from "./client";
import { CODE_WORDS, codeSentence, escalate, failureOf, kindOf, rateSentence } from "./failure";

const t = appT("en");
beforeEach(() => vi.clearAllMocks());

describe("what a failed call is", () => {
  it.each([
    [new ApiRequestError(403, "forbidden", "x"), "forbidden"],
    [new ApiRequestError(403, "mfa_required", "x"), "mfa"],
    [new ApiRequestError(429, "rate_limited", "x"), "rate_limited"],
    [new ApiRequestError(413, "payload_too_large", "x"), "too_big"],
    [new ApiRequestError(422, "validation_error", "x"), "invalid"],
    [new ApiRequestError(415, "file_not_xlsx", "x"), "invalid"],
    [new ApiRequestError(404, "not_found", "x"), "not_found"],
    [new ApiRequestError(409, "import_file_changed", "x"), "conflict"],
    [new ApiRequestError(503, "api_unreachable", "x"), "unavailable"],
    [new ApiRequestError(500, "http_error", "x"), "unavailable"],
    [new Error("boom"), "other"],
  ])("%j is %s", (error, kind) => {
    expect(kindOf(error)).toBe(kind);
  });
});

describe("the sentence for it", () => {
  it("is ours, never the API's own message", () => {
    const f = failureOf(new ApiRequestError(403, "forbidden", "SECRET internal text"), t);
    expect(f.error).toBe("Your role cannot do this. Ask the owner if you need it.");
    expect(JSON.stringify(f)).not.toContain("SECRET");
    expect(f.kind).toBe("forbidden");
  });
  it("a missing second step says so and is marked", () => {
    const f = failureOf(new ApiRequestError(403, "mfa_required", "x"), t);
    expect(f.mfa).toBe(true);
    expect(f.error).toMatch(/two-step code/);
  });
  it("a 429 says how long to wait when the API said, and 'a minute' when it did not or said a long time", () => {
    expect(failureOf(new ApiRequestError(429, "rate_limited", "x", undefined, undefined, 30), t).error).toMatch(/Wait 30 seconds/);
    expect(failureOf(new ApiRequestError(429, "rate_limited", "x"), t).error).toMatch(/Wait a minute/);
    expect(rateSentence(t, 4000)).toMatch(/Wait a minute/);
    expect(failureOf(new ApiRequestError(429, "rate_limited", "x", undefined, undefined, 30), t).retryAfter).toBe(30);
  });
  it("keeps a closed code for a screen that has a sentence of its own, and drops anything else", () => {
    expect(failureOf(new ApiRequestError(422, "file_malformed_csv", "x"), t).code).toBe("file_malformed_csv");
    expect(failureOf(new ApiRequestError(422, "<script>", "x"), t).code).toBeUndefined();
  });
  it("says in a form that the business type does not have this part when the API says `module_off`, not that the role cannot", () => {
    const f = failureOf(new ApiRequestError(403, "module_off", "SECRET"), t);
    expect(f).toMatchObject({ ok: false, kind: "forbidden", code: "module_off" });
    expect(f.error).toBe(t("apierr.module_off"));
    expect(f.error).not.toContain("SECRET");
    expect(f.error).not.toBe(t("apierr.forbidden"));
  });
  it("sends a rejected session to sign-in", () => {
    expect(() => failureOf(new ApiAuthError("x"), t)).toThrow("NEXT_REDIRECT:/login");
  });
});

describe("a page that failed to read", () => {
  it("goes to the friendly pages for a refusal and a rate limit, and to sign-in for a rejected session", () => {
    expect(() => escalate(new ApiRequestError(403, "forbidden", "x"))).toThrow("NEXT_REDIRECT:/app/problem/403");
    expect(() => escalate(new ApiRequestError(429, "rate_limited", "x"))).toThrow("NEXT_REDIRECT:/app/problem/429");
    expect(() => escalate(new ApiAuthError("x"))).toThrow("NEXT_REDIRECT:/login");
  });
  it("draws the 403 page of a part the business type does not have when the API says `module_off` (the same page as a typed address), not the plain 'not open to you' page", () => {
    expect(() => escalate(new ApiRequestError(403, "module_off", "x"))).toThrow("NEXT_HTTP_ERROR_FALLBACK;403");
    expect(() => escalate(new ApiRequestError(403, "forbidden", "x"))).toThrow("NEXT_REDIRECT:/app/problem/403");
  });
  it("sends a person whose Terms or Privacy Policy changed to the page where they accept it, not to 'not open to you'", () => {
    expect(() => escalate(new ApiRequestError(403, "policy_acceptance_required", "x"))).toThrow("NEXT_REDIRECT:/app/accept");
  });
  it("lets anything else return, for the page to say what it says", () => {
    expect(() => escalate(new ApiRequestError(503, "api_unreachable", "x"))).not.toThrow();
    expect(() => escalate(new ApiRequestError(404, "not_found", "x"))).not.toThrow();
    expect(() => escalate(new Error("x"))).not.toThrow();
  });
});

describe("plain words for the codes a shop meets (error-words job)", () => {
  const catalog = JSON.parse(readFileSync(resolve(__dirname, "../../../../packages/contracts/error_codes.json"), "utf8")) as { code: string }[] | { codes: { code: string }[] };
  const known = new Set((Array.isArray(catalog) ? catalog : catalog.codes).map((c) => c.code));
  const NOT_ERROR_CODES = ["dnd", "no_consent"]; // the do-not-disturb list and an unconfirmed consent: refusal reasons of a call and counts of an import, not codes of the API's error body

  it("every code in the list is a published code of the catalog (or one of the two refusal reasons), so a rename cannot go unnoticed", () => {
    expect(Object.keys(CODE_WORDS).filter((c) => !known.has(c) && !NOT_ERROR_CODES.includes(c))).toEqual([]);
  });
  it("says a code's own sentence, in the person's language, never the API's message", () => {
    const f = failureOf(new ApiRequestError(409, "import_file_changed", "SECRET internal text"), t);
    expect(f.error).toBe("This is not the file that was checked, so nothing was imported. Choose the file again and check it again.");
    expect(JSON.stringify(f)).not.toContain("SECRET");
    expect(failureOf(new ApiRequestError(409, "import_file_changed", "x"), appT("te")).error).toMatch(/[ఀ-౿]/);
    expect(failureOf(new ApiRequestError(429, "search_cap_reached", "x", undefined, undefined, 30), t).error).toBe("Today's searches are used up. Try again tomorrow."); // its own sentence wins over the general "wait N seconds"
  });
  it("tells the person to sign in again AND to check the last save when the session is about to end", () => {
    const f = failureOf(new ApiRequestError(409, "token_expiring", "x"), t);
    expect(f.error).toMatch(/Sign in again/);
    expect(f.error).toMatch(/check that your last change was saved/);
  });
  it("money, consent, privacy and the stop list are English in every language until a person reviews them", () => {
    for (const code of ["contact_suppressed", "customer_stopped", "plan_limit_reached", "not_in_plan", "workspace_limit_reached", "voice_allowance_used", "dnd", "no_consent"]) {
      const en = codeSentence(code, t);
      expect(en, code).toBeTruthy();
      for (const lang of ["te", "kn", "hi"] as const) expect(codeSentence(code, appT(lang))?.replaceAll("\u2060", ""), `${code}:${lang}`).toBe(en); // the invisible word joiner after a hyphen is the only difference allowed
    }
  });
  it("says 'nothing was ...' only where that is certain", () => {
    expect(codeSentence("dnd", t)).toMatch(/WhatsApp, but it cannot be called/);
    expect(codeSentence("no_consent", t)).toMatch(/nothing was sent/);
    expect(codeSentence("import_file_changed", t)).toMatch(/nothing was imported/);
    for (const code of ["call_provider_failed", "model_busy", "order_changed", "quote_stale", "token_expiring"]) expect(codeSentence(code, t), code).not.toMatch(/nothing was|nothing is/i);
  });
  it("an unknown code, a made-up one and an object property name fall back to the sentence of its kind, never to a code or the API's text", () => {
    expect(failureOf(new ApiRequestError(500, "brand_new_code", "SECRET"), t).error).toBe(t("apierr.unavailable"));
    expect(failureOf(new ApiRequestError(400, "brand_new_code", "SECRET"), t).error).toBe(t("apierr.generic"));
    expect(failureOf(new ApiRequestError(400, "constructor", "x"), t).error).toBe(t("apierr.generic"));
    expect(failureOf(new Error("boom"), t).error).toBe(t("apierr.generic"));
  });
  it("the calm fallback does not claim that nothing changed, and says what to do next", () => {
    for (const key of ["apierr.generic", "apierr.unavailable"] as const) {
      expect(t(key)).not.toMatch(/nothing was changed/i);
      expect(t(key)).toMatch(/try again in a moment/i);
      expect(t(key)).toMatch(/contact us/i);
    }
    expect(t("apierr.generic")).toBe("Something went wrong. Please try again in a moment. If it keeps happening, contact us.");
  });
});
