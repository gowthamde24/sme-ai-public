import { beforeEach, describe, expect, it, vi } from "vitest";

const submitAccountSetup = vi.fn();
const revalidatePath = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath: (...a: unknown[]) => revalidatePath(...a) }));
const user = vi.fn();
const currentPolicies = vi.fn();
vi.mock("@/lib/auth/session", () => ({ requireUser: async () => user() }));
vi.mock("@/lib/api/policy", async (orig) => ({ ...(await orig<typeof import("@/lib/api/policy")>()), getCurrentPolicies: () => currentPolicies() }));
vi.mock("@/lib/api/account", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/account")>()),
  submitAccountSetup: (...a: unknown[]) => submitAccountSetup(...a),
}));

import { completeSetup } from "./actions";

describe("the completeSetup action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    user.mockReturnValue({ id: "u", accessToken: "token-9" });
    currentPolicies.mockResolvedValue({ terms: "2026-11-01", privacy: "2026-10-01" });
  });

  it("uses the signed-in person's own token and refreshes /app on success", async () => {
    submitAccountSetup.mockResolvedValue({ tenantId: "t", created: true });
    expect(await completeSetup({ businessType: "textiles", language: "hi" })).toEqual({ ok: true });
    expect(submitAccountSetup).toHaveBeenCalledWith("token-9", { businessType: "textiles", language: "hi", acceptedTerms: "2026-11-01", acceptedPrivacy: "2026-10-01" });
    expect(revalidatePath).toHaveBeenCalledWith("/app");
  });

  it("an account made by e-mail sends the versions it accepted on the sign-up page, not today's", async () => {
    user.mockReturnValue({ id: "u", accessToken: "token-9", signupPolicies: { terms: "2026-09-01", privacy: "2026-09-02" } });
    submitAccountSetup.mockResolvedValue({ tenantId: "t", created: true });
    await completeSetup({ businessType: "textiles", language: "en" });
    expect(submitAccountSetup).toHaveBeenCalledWith("token-9", { businessType: "textiles", language: "en", acceptedTerms: "2026-09-01", acceptedPrivacy: "2026-09-02" });
    expect(currentPolicies).not.toHaveBeenCalled();
  });

  it("an account made through Google or Facebook has no sign-up form: the setup records the versions in force, and still makes the business when they cannot be read", async () => {
    submitAccountSetup.mockResolvedValue({ tenantId: "t", created: true });
    currentPolicies.mockRejectedValue(new Error("down"));
    expect(await completeSetup({ businessType: "textiles", language: "en" })).toEqual({ ok: true });
    expect(submitAccountSetup).toHaveBeenCalledWith("token-9", { businessType: "textiles", language: "en" });
  });

  it("does not refresh anything when it fails", async () => {
    expect(await completeSetup({ businessType: "Bad Type" as never, language: "en" })).toMatchObject({ ok: false });
    expect(submitAccountSetup).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
