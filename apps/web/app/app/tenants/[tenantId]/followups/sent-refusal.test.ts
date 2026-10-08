import { describe, expect, it, vi } from "vitest";

import { ApiAuthError, ApiRequestError } from "@/lib/api/client";
import { redirectMock, redirectTarget } from "@/test/helpers";

vi.mock("next/navigation", () => ({ redirect: (to: string) => redirectMock(to) }));

import { NOT_AVAILABLE, sentRefusal } from "./sent-refusal";

describe("sentRefusal (shared by the lead page and the approved quote)", () => {
  it("keeps item g's wording and the default 'not available' sentence", () => {
    expect(NOT_AVAILABLE).toBe("This lead is not available.");
    expect(sentRefusal(new ApiRequestError(404, "not_found", "x"))).toEqual({ ok: false, error: "This lead is not available." });
  });
  it("takes the 'not available' sentence from the caller, and changes nothing else", () => {
    expect(sentRefusal(new ApiRequestError(404, "not_found", "x"), "This quote is not available.")).toEqual({ ok: false, error: "This quote is not available." });
    expect(sentRefusal(new ApiRequestError(403, "forbidden", "x"), "This quote is not available.")?.error).toMatch(/^Your role cannot/);
  });
  it("a rejected session is the sign-in redirect", async () => {
    expect(await redirectTarget(async () => sentRefusal(new ApiAuthError("no")))).toBe("/login");
  });
  it("an error that is not ours is the generic sentence with no text", () => {
    expect(sentRefusal(new Error("secret"))?.error).toMatch(/^Could not record this\. Try again\./);
    expect(JSON.stringify(sentRefusal(new Error("secret")))).not.toContain("secret");
  });
});
