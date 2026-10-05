import { beforeEach, describe, expect, it, vi } from "vitest";

import { fakeSupabase, redirectMock, redirectTarget } from "@/test/helpers";

const requireBefore = vi.fn();
const createClient = vi.fn();
vi.mock("next/navigation", () => ({ redirect: (to: string) => redirectMock(to) }));
vi.mock("@/lib/auth/session", () => ({ requireUserBeforeSecondFactor: () => requireBefore() }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: () => createClient() }));

import { leaveChallenge, verifyCode } from "./actions";

function form(values: Record<string, string>): FormData {
  const data = new FormData();
  for (const [k, v] of Object.entries(values)) data.set(k, v);
  return data;
}
const withFactor = (overrides = {}) =>
  fakeSupabase({
    mfa: {
      ...fakeSupabase().auth.mfa,
      listFactors: vi.fn(async () => ({ data: { all: [], totp: [{ id: "f1" }] }, error: null })),
      ...overrides,
    },
  });

describe("verifyCode", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireBefore.mockResolvedValue({ id: "u", aal: "aal1", hasSecondFactor: true });
  });

  it("needs a session; a password-only one is what the page is for", async () => {
    requireBefore.mockImplementation(() => redirectMock("/login"));
    expect(await redirectTarget(() => verifyCode(undefined, form({ code: "123456" })))).toBe("/login");
  });

  it("answers the challenge with the typed code and goes to a same-site next", async () => {
    const supabase = withFactor();
    createClient.mockResolvedValue(supabase);
    expect(await redirectTarget(() => verifyCode(undefined, form({ code: "123 456", next: "/app/tenants/1" })))).toBe("/app/tenants/1");
    expect(supabase.auth.mfa.challengeAndVerify).toHaveBeenCalledWith({ factorId: "f1", code: "123456" });
  });

  it.each(["//evil.example", "https://evil.example", "/login", ""])("never follows the untrusted next %j", async (next) => {
    createClient.mockResolvedValue(withFactor());
    expect(await redirectTarget(() => verifyCode(undefined, form({ code: "123456", next })))).toBe("/app");
  });

  it.each(["", "12345", "1234567", "abcdef", "12 34 5"])("a malformed code (%j) never reaches the Auth server", async (code) => {
    const supabase = withFactor();
    createClient.mockResolvedValue(supabase);
    expect((await verifyCode(undefined, form({ code })))?.error).toMatch(/six digits/);
    expect(supabase.auth.mfa.challengeAndVerify).not.toHaveBeenCalled();
  });

  it("a wrong or reused code gets one fixed message and no redirect", async () => {
    createClient.mockResolvedValue(withFactor({ challengeAndVerify: vi.fn(async () => ({ data: null, error: { message: "CANARY Invalid TOTP code entered" } })) }));
    const result = await verifyCode(undefined, form({ code: "000000" }));
    expect(result?.error).toMatch(/did not work/);
    expect(JSON.stringify(result)).not.toContain("CANARY");
    expect(JSON.stringify(result)).not.toContain("000000");
  });

  it("a person with no authenticator is sent to set one up, not asked for a code", async () => {
    createClient.mockResolvedValue(fakeSupabase());
    expect(await redirectTarget(() => verifyCode(undefined, form({ code: "123456" })))).toBe("/app/security");
  });

  it("signing out from the challenge ends the session", async () => {
    const supabase = fakeSupabase();
    createClient.mockResolvedValue(supabase);
    expect(await redirectTarget(() => leaveChallenge())).toBe("/login");
    expect(supabase.auth.signOut).toHaveBeenCalled();
  });
});
