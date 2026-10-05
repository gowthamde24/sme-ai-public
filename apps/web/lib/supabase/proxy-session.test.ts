// @vitest-environment node
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getUser = vi.fn();
const getSession = vi.fn();
let capturedCookies:
  { setAll: (c: unknown[], h: Record<string, string>) => void } | undefined;

vi.mock("@supabase/ssr", () => ({
  createServerClient: (
    _url: string,
    _key: string,
    options: { cookies: typeof capturedCookies },
  ) => {
    capturedCookies = options.cookies;
    return { auth: { getUser, getSession } };
  },
}));

import { refreshSession } from "./proxy-session";

const request = () => new NextRequest("http://localhost:3000/app");

describe("refreshSession", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon");
  });

  it("identifies the user with getUser() and never reads getSession()", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "u" } }, error: null });
    const { user } = await refreshSession(request());
    expect(user).toEqual({ id: "u" });
    expect(getSession).not.toHaveBeenCalled();
  });

  it.each([
    [
      "an auth error",
      async () => ({ data: { user: null }, error: { message: "bad jwt" } }),
    ],
    [
      "no user and no error",
      async () => ({ data: { user: null }, error: null }),
    ],
    [
      "a thrown network failure",
      async () => {
        throw new Error("network down");
      },
    ],
  ])("treats %s as signed out", async (_name, impl) => {
    getUser.mockImplementation(impl);
    expect((await refreshSession(request())).user).toBeNull();
  });

  it("writes refreshed cookies HttpOnly, with the library's no-store headers", async () => {
    // A real token refresh calls setAll while getUser() is running.
    getUser.mockImplementation(async () => {
      capturedCookies?.setAll(
        [
          {
            name: "sb-x",
            value: "v",
            options: { httpOnly: false, maxAge: 60 },
          },
        ],
        {
          "Cache-Control":
            "private, no-cache, no-store, must-revalidate, max-age=0",
        },
      );
      return { data: { user: { id: "u" } }, error: null };
    });
    const { response } = await refreshSession(request());
    const cookie = response.cookies.get("sb-x");
    expect(cookie?.value).toBe("v");
    expect(cookie).toMatchObject({
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60,
    });
    expect(response.headers.get("cache-control")).toContain("no-store");
  });

  it("fails closed when Supabase is not configured", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    await expect(refreshSession(request())).rejects.toThrow(/not configured/);
  });

  describe("needsSecondFactor", () => {
    const enrolled = { id: "u", factors: [{ status: "verified", factor_type: "totp" }] };

    it("is false for a person with no authenticator", async () => {
      getUser.mockResolvedValue({ data: { user: { id: "u" } }, error: null });
      expect((await refreshSession(request())).needsSecondFactor).toBe(false);
    });

    it("is false for an unverified (unfinished) factor", async () => {
      getUser.mockResolvedValue({ data: { user: { id: "u", factors: [{ status: "unverified", factor_type: "totp" }] } }, error: null });
      expect((await refreshSession(request())).needsSecondFactor).toBe(false);
    });

    it("is true for an enrolled person whose session is not aal2, and fails closed when the level is unreadable", async () => {
      getUser.mockResolvedValue({ data: { user: enrolled }, error: null });
      expect((await refreshSession(request())).needsSecondFactor).toBe(true);
    });
  });
});
