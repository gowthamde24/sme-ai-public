import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

describe("the first sign-in records the unticked marketing box (job DQ part 2)", () => {
  const cookieJar = new Map<string, string>();
  const changeMarketing = vi.fn();
  beforeEach(async () => {
    cookieJar.clear();
    changeMarketing.mockReset();
    changeMarketing.mockResolvedValue({ ok: true, consents: {} });
    submitAccountSetup.mockResolvedValue({ tenantId: "t", created: true });
    vi.stubEnv("DPDP_SCREENS", "1");
    vi.doMock("next/headers", () => ({ cookies: async () => ({ get: (n: string) => (cookieJar.has(n) ? { value: cookieJar.get(n) } : undefined), delete: (n: string) => cookieJar.delete(n) }) }));
    vi.doMock("@/lib/dpdp/source", () => ({ changeMarketing: (...a: unknown[]) => changeMarketing(...a) }));
    vi.resetModules();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.doUnmock("next/headers");
    vi.doUnmock("@/lib/dpdp/source");
  });
  const run = async () => (await import("./actions")).completeSetup({ businessType: "textiles", language: "en" });

  it("by e-mail (the account's metadata says so): recorded once, 'signup', after the business is made", async () => {
    user.mockReturnValue({ id: "u", accessToken: "tok", signupMarketing: true });
    expect(await run()).toEqual({ ok: true });
    expect(changeMarketing).toHaveBeenCalledTimes(1);
    expect(changeMarketing).toHaveBeenCalledWith("tok", true, "signup");
  });
  it("through Google (the cookie of the browser that went there): 'google'; through Facebook: 'signup'; the cookie is used up", async () => {
    user.mockReturnValue({ id: "u", accessToken: "tok" });
    cookieJar.set("sme_signup_marketing", "google");
    await run();
    expect(changeMarketing).toHaveBeenLastCalledWith("tok", true, "google");
    expect(cookieJar.has("sme_signup_marketing")).toBe(false);
    cookieJar.set("sme_signup_marketing", "facebook");
    await run();
    expect(changeMarketing).toHaveBeenLastCalledWith("tok", true, "signup");
  });
  it("nothing is recorded when the box was not ticked, when the cookie is not ours, when the consent API is off, or when the business could not be made", async () => {
    user.mockReturnValue({ id: "u", accessToken: "tok" });
    await run();
    cookieJar.set("sme_signup_marketing", "https://evil.example");
    await run();
    expect(changeMarketing).not.toHaveBeenCalled();
    user.mockReturnValue({ id: "u", accessToken: "tok", signupMarketing: true });
    vi.stubEnv("DPDP_SCREENS", "");
    await run();
    expect(changeMarketing).not.toHaveBeenCalled();
    vi.stubEnv("DPDP_SCREENS", "1");
    submitAccountSetup.mockRejectedValue(new Error("no"));
    await run();
    expect(changeMarketing).not.toHaveBeenCalled();
  });
});
