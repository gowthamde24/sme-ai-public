import { beforeEach, describe, expect, it, vi } from "vitest";

import { appT } from "@/i18n/app";
import { redirectMock } from "@/test/helpers";

vi.mock("next/navigation", () => ({ redirect: (to: string) => redirectMock(to) }));

import { ApiAuthError, ApiRequestError } from "./client";
import { escalate, failureOf, kindOf, rateSentence } from "./failure";

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
    expect(f.error).toMatch(/second step/);
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
  it("sends a person whose Terms or Privacy Policy changed to the page where they accept it, not to 'not open to you'", () => {
    expect(() => escalate(new ApiRequestError(403, "policy_acceptance_required", "x"))).toThrow("NEXT_REDIRECT:/app/accept");
  });
  it("lets anything else return, for the page to say what it says", () => {
    expect(() => escalate(new ApiRequestError(503, "api_unreachable", "x"))).not.toThrow();
    expect(() => escalate(new ApiRequestError(404, "not_found", "x"))).not.toThrow();
    expect(() => escalate(new Error("x"))).not.toThrow();
  });
});
