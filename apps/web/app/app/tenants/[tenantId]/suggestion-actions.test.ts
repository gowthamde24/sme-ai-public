import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiAuthError, ApiRequestError } from "@/lib/api/client";
import { redirectMock, redirectTarget } from "@/test/helpers";

const requireUser = vi.fn();
const reviewClaim = vi.fn();
const revalidatePath = vi.fn();

vi.mock("next/navigation", () => ({ redirect: (to: string) => redirectMock(to) }));
vi.mock("next/cache", () => ({ revalidatePath: (p: string) => revalidatePath(p) }));
vi.mock("@/lib/auth/session", () => ({ requireUser: () => requireUser() }));
vi.mock("@/lib/api/agents", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/agents")>()),
  reviewClaim: (...args: unknown[]) => reviewClaim(...args),
}));

import { reviewClaimAction } from "./suggestion-actions";

const TENANT = "22222222-2222-2222-2222-222222222222";
const TARGET = "33333333-3333-3333-3333-333333333333";
const CLAIM = "44444444-4444-4444-4444-444444444444";
const REVIEW = "55555555-5555-4555-8555-555555555555";

function form(values: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}
const run = (values: Record<string, string>, target: "companies" | "leads" = "companies") =>
  reviewClaimAction(TENANT, target, TARGET, CLAIM, true, undefined, form(values));

describe("reviewClaimAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireUser.mockResolvedValue({ id: "u", email: "e", accessToken: "tok" });
    reviewClaim.mockResolvedValue({ review_id: REVIEW, replayed: false, self_review: false });
  });

  it("accepts with the confidence the PERSON chose, using the id from the form", async () => {
    const res = await run({ review_id: REVIEW, decision: "accepted", confidence: "medium" });
    expect(res?.ok).toBe(true);
    expect(reviewClaim).toHaveBeenCalledWith("tok", TENANT, CLAIM, {
      id: REVIEW,
      decision: "accepted",
      confidence: "medium",
    });
    expect(revalidatePath).toHaveBeenCalledWith(`/app/tenants/${TENANT}/companies/${TARGET}`);
  });

  it("rejects with a reason and revalidates the lead page for a lead target", async () => {
    const res = await run({ review_id: REVIEW, decision: "rejected", reason_code: "outdated" }, "leads");
    expect(res?.ok).toBe(true);
    expect(reviewClaim).toHaveBeenCalledWith("tok", TENANT, CLAIM, {
      id: REVIEW,
      decision: "rejected",
      reason_code: "outdated",
    });
    expect(revalidatePath).toHaveBeenCalledWith(`/app/tenants/${TENANT}/leads/${TARGET}`);
  });

  it("only says 'counts toward the score' when the predicate is one the profile reads", async () => {
    const scored = await reviewClaimAction(TENANT, "companies", TARGET, CLAIM, true, undefined, form({ review_id: REVIEW, decision: "accepted", confidence: "low" }));
    expect(scored?.message).toMatch(/counts toward the score/);
    const unscored = await reviewClaimAction(TENANT, "companies", TARGET, CLAIM, false, undefined, form({ review_id: REVIEW, decision: "accepted", confidence: "low" }));
    expect(unscored?.message).not.toMatch(/counts toward the score/);
    expect(unscored?.message).toMatch(/not part of any score/);
  });

  it("never sends more than the decision: no origin, tenant, confidence of the agent's own or extra fields", async () => {
    await run({
      review_id: REVIEW,
      decision: "accepted",
      confidence: "low",
      created_via: "manual",
      tenant_id: "x",
      self_review: "false",
      claim_confidence: "high",
    });
    expect(Object.keys(reviewClaim.mock.calls[0][3]).sort()).toEqual(["confidence", "decision", "id"]);
  });

  it.each([
    ["no review id", { decision: "accepted", confidence: "low" }],
    ["a malformed review id", { review_id: "nope", decision: "accepted", confidence: "low" }],
    ["no decision", { review_id: REVIEW }],
    ["an unknown decision", { review_id: REVIEW, decision: "maybe", confidence: "low" }],
    ["accept without a confidence", { review_id: REVIEW, decision: "accepted" }],
    ["accept as 'unverified'", { review_id: REVIEW, decision: "accepted", confidence: "unverified" }],
    ["accept as 'certain'", { review_id: REVIEW, decision: "accepted", confidence: "certain" }],
    ["reject without a reason", { review_id: REVIEW, decision: "rejected" }],
    ["reject with an unknown reason", { review_id: REVIEW, decision: "rejected", reason_code: "because" }],
  ])("refuses %s without calling the API", async (_label, values) => {
    const res = await run(values);
    expect(res?.ok).toBe(false);
    expect(reviewClaim).not.toHaveBeenCalled();
  });

  it("refuses malformed workspace, target or claim references", async () => {
    for (const args of [
      ["bad", "companies", TARGET, CLAIM],
      [TENANT, "companies", "bad", CLAIM],
      [TENANT, "companies", TARGET, "bad"],
      [TENANT, "contacts", TARGET, CLAIM],
    ] as const) {
      const res = await reviewClaimAction(
        args[0],
        args[1] as "companies",
        args[2],
        args[3],
        true,
        undefined,
        form({ review_id: REVIEW, decision: "rejected", reason_code: "duplicate" }),
      );
      expect(res?.ok).toBe(false);
    }
    expect(reviewClaim).not.toHaveBeenCalled();
  });

  it("maps every API failure to a short generic message, never the API's body or the submitted values", async () => {
    const cases: [number, string, RegExp][] = [
      [403, "forbidden", /owner or admin/],
      [404, "not_found", /not available/],
      [409, "conflict", /out of date/],
      [422, "invalid_value", /supporting evidence/],
      [500, "http_error", /Could not save/],
    ];
    for (const [status, code, message] of cases) {
      reviewClaim.mockRejectedValueOnce(new ApiRequestError(status, code, "CANARY-api-body"));
      const res = await run({ review_id: REVIEW, decision: "accepted", confidence: "high" });
      expect(res?.ok).toBe(false);
      expect(res?.error).toMatch(message);
      expect(JSON.stringify(res)).not.toContain("CANARY");
    }
    reviewClaim.mockRejectedValueOnce(new Error("CANARY-network"));
    expect(JSON.stringify(await run({ review_id: REVIEW, decision: "accepted", confidence: "low" }))).not.toContain("CANARY");
  });

  it("sends a rejected session to the login page", async () => {
    reviewClaim.mockRejectedValueOnce(new ApiAuthError("expired"));
    expect(
      await redirectTarget(() => run({ review_id: REVIEW, decision: "accepted", confidence: "low" })),
    ).toBe("/login");
  });

  it("requires a signed-in user before anything else", async () => {
    requireUser.mockRejectedValueOnce(new Error("NEXT_REDIRECT"));
    await expect(run({ review_id: REVIEW, decision: "accepted", confidence: "low" })).rejects.toThrow();
    expect(reviewClaim).not.toHaveBeenCalled();
  });
});
