import { beforeEach, describe, expect, it, vi } from "vitest";

import { fakeSupabase, redirectMock, redirectTarget } from "@/test/helpers";

const createClient = vi.fn();
vi.mock("next/navigation", () => ({
  redirect: (to: string) => redirectMock(to),
}));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: () => createClient(),
}));

import { requireUser } from "./session";

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
});
