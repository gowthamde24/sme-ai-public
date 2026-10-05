import { beforeEach, describe, expect, it, vi } from "vitest";

import { fakeSupabase, redirectMock, redirectTarget } from "@/test/helpers";

const createClient = vi.fn();
vi.mock("next/navigation", () => ({
  redirect: (to: string) => redirectMock(to),
}));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: () => createClient(),
}));

import { requireUser, requireUserBeforeSecondFactor } from "./session";

const USER = {
  id: "11111111-1111-1111-1111-111111111111",
  email: "a@example.test",
};

describe("requireUser", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("authenticates with getUser() and forwards the access token", async () => {
    const supabase = fakeSupabase({
      getUser: vi.fn(async () => ({ data: { user: USER }, error: null })),
      getSession: vi.fn(async () => ({
        data: { session: { access_token: "tok" } },
      })),
    });
    createClient.mockResolvedValue(supabase);

    await expect(requireUser()).resolves.toEqual({
      id: USER.id,
      email: USER.email,
      accessToken: "tok",
      aal: "aal1",
      hasSecondFactor: false,
    });
    expect(supabase.auth.getUser).toHaveBeenCalledTimes(1);
  });

  it("redirects to /login when getUser() fails, and never reads the cookie session instead", async () => {
    // A forged or expired cookie still yields a session from getSession(); getUser() is what
    // rejects it. The session must not be consulted at all once getUser() has said no.
    const supabase = fakeSupabase({
      getUser: vi.fn(async () => ({
        data: { user: null },
        error: { message: "invalid JWT" },
      })),
      getSession: vi.fn(async () => ({
        data: { session: { access_token: "forged-but-present" } },
      })),
    });
    createClient.mockResolvedValue(supabase);

    expect(await redirectTarget(() => requireUser())).toBe("/login");
    expect(supabase.auth.getSession).not.toHaveBeenCalled();
  });

  it("redirects when getUser() returns no user without an error", async () => {
    const supabase = fakeSupabase({
      getUser: vi.fn(async () => ({ data: { user: null }, error: null })),
    });
    createClient.mockResolvedValue(supabase);
    expect(await redirectTarget(() => requireUser())).toBe("/login");
    expect(supabase.auth.getSession).not.toHaveBeenCalled();
  });

  it("redirects when the user is valid but no access token is available", async () => {
    const supabase = fakeSupabase({
      getUser: vi.fn(async () => ({ data: { user: USER }, error: null })),
      getSession: vi.fn(async () => ({ data: { session: null } })),
    });
    createClient.mockResolvedValue(supabase);
    expect(await redirectTarget(() => requireUser())).toBe("/login");
  });

  describe("the second factor (ADR 0016)", () => {
    const enrolled = {
      ...USER,
      factors: [{ status: "verified", factor_type: "totp" }],
    };
    const withLevel = (user: object, currentLevel: string | null) =>
      fakeSupabase({
        getUser: vi.fn(async () => ({ data: { user }, error: null })),
        getSession: vi.fn(async () => ({
          data: { session: { access_token: "tok" } },
        })),
        mfa: {
          ...fakeSupabase().auth.mfa,
          getAuthenticatorAssuranceLevel: vi.fn(async () =>
            currentLevel === null
              ? { data: null, error: { message: "x" } }
              : { data: { currentLevel, nextLevel: "aal2" }, error: null },
          ),
        },
      });

    it("sends an enrolled person on a password-only session to the challenge", async () => {
      createClient.mockResolvedValue(withLevel(enrolled, "aal1"));
      expect(await redirectTarget(() => requireUser())).toBe("/auth/mfa");
    });

    it("fails closed: an unreadable level counts as password-only", async () => {
      createClient.mockResolvedValue(withLevel(enrolled, null));
      expect(await redirectTarget(() => requireUser())).toBe("/auth/mfa");
    });

    it("lets an aal2 session through and reports it", async () => {
      createClient.mockResolvedValue(withLevel(enrolled, "aal2"));
      await expect(requireUser()).resolves.toMatchObject({ aal: "aal2", hasSecondFactor: true });
    });

    it("does not ask a person with no authenticator", async () => {
      createClient.mockResolvedValue(withLevel(USER, "aal1"));
      await expect(requireUser()).resolves.toMatchObject({ aal: "aal1", hasSecondFactor: false });
    });

    it("ignores an unverified factor (setup that was never finished)", async () => {
      createClient.mockResolvedValue(withLevel({ ...USER, factors: [{ status: "unverified", factor_type: "totp" }] }, "aal1"));
      await expect(requireUser()).resolves.toMatchObject({ hasSecondFactor: false });
    });

    it("the challenge page itself loads for a password-only session", async () => {
      createClient.mockResolvedValue(withLevel(enrolled, "aal1"));
      await expect(requireUserBeforeSecondFactor()).resolves.toMatchObject({ aal: "aal1", hasSecondFactor: true });
    });
  });
});
