import { beforeEach, describe, expect, it, vi } from "vitest";

import { fakeSupabase, redirectMock, redirectTarget } from "@/test/helpers";

const createClient = vi.fn();
vi.mock("next/navigation", () => ({
  redirect: (to: string) => redirectMock(to),
}));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: () => createClient(),
}));

import { signIn } from "./actions";

function form(values: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

const OK = { email: "a@example.test", password: "correct horse battery" };

describe("signIn", () => {
  beforeEach(() => vi.clearAllMocks());

  it("redirects to a validated relative target after success", async () => {
    const supabase = fakeSupabase({
      signInWithPassword: vi.fn(async () => ({ data: {}, error: null })),
    });
    createClient.mockResolvedValue(supabase);
    expect(
      await redirectTarget(() =>
        signIn(undefined, form({ ...OK, next: "/app?x=1" })),
      ),
    ).toBe("/app?x=1");
  });

  it.each([
    "//evil.example",
    "https://evil.example",
    "/\\evil.example",
    "javascript:alert(1)",
    "/%2f%2fevil.example",
    "",
  ])("never redirects to the untrusted target %j", async (next) => {
    const supabase = fakeSupabase({
      signInWithPassword: vi.fn(async () => ({ data: {}, error: null })),
    });
    createClient.mockResolvedValue(supabase);
    expect(
      await redirectTarget(() => signIn(undefined, form({ ...OK, next }))),
    ).toBe("/app");
  });

  it("ignores a missing next field", async () => {
    const supabase = fakeSupabase({
      signInWithPassword: vi.fn(async () => ({ data: {}, error: null })),
    });
    createClient.mockResolvedValue(supabase);
    expect(await redirectTarget(() => signIn(undefined, form(OK)))).toBe(
      "/app",
    );
  });

  it("says plainly when the address was never confirmed (the password was right, so nothing is revealed)", async () => {
    createClient.mockResolvedValue(
      fakeSupabase({
        signInWithPassword: vi.fn(async () => ({ data: {}, error: { code: "email_not_confirmed", message: "Email not confirmed" } })),
      }),
    );
    expect(await signIn(undefined, form({ ...OK, next: "/app" }))).toEqual({
      error: "Confirm your email first: use the link we sent you.",
    });
  });

  it("returns one generic error for any failure and does not redirect", async () => {
    createClient.mockResolvedValue(fakeSupabase());
    const result = await signIn(undefined, form({ ...OK, next: "/app" }));
    expect(result).toEqual({ error: "Invalid email or password." });
  });

  it.each([
    {},
    { email: "", password: "x" },
    { email: "not-an-email", password: "x" },
    { email: "a@example.test", password: "" },
    { email: "a@example.test", password: "x".repeat(73) },
    { email: "a@" + "x".repeat(260) + ".test", password: "x" },
  ])(
    "rejects malformed credentials %j before calling Supabase",
    async (values) => {
      const supabase = fakeSupabase();
      createClient.mockResolvedValue(supabase);
      const result = await signIn(
        undefined,
        form(values as Record<string, string>),
      );
      expect(result?.error).toBeTruthy();
      expect(supabase.auth.signInWithPassword).not.toHaveBeenCalled();
    },
  );

  it("does not echo the submitted password or email back", async () => {
    createClient.mockResolvedValue(fakeSupabase());
    const result = await signIn(undefined, form(OK));
    expect(JSON.stringify(result)).not.toContain(OK.password);
    expect(JSON.stringify(result)).not.toContain(OK.email);
  });

  it("normalises the email before sending it", async () => {
    const supabase = fakeSupabase({
      signInWithPassword: vi.fn(async () => ({ data: {}, error: null })),
    });
    createClient.mockResolvedValue(supabase);
    await redirectTarget(() =>
      signIn(undefined, form({ email: "  A@Example.TEST ", password: "pw" })),
    );
    expect(supabase.auth.signInWithPassword).toHaveBeenCalledWith({
      email: "a@example.test",
      password: "pw",
    });
  });
});

describe("sign-in with an authenticator (ADR 0016)", () => {
  beforeEach(() => vi.clearAllMocks());

  const okSignIn = vi.fn(async () => ({ data: {}, error: null }));

  it("sends a person who has an authenticator to the challenge, keeping a validated next", async () => {
    createClient.mockResolvedValue(
      fakeSupabase({
        signInWithPassword: okSignIn,
        mfa: {
          ...fakeSupabase().auth.mfa,
          getAuthenticatorAssuranceLevel: vi.fn(async () => ({
            data: { currentLevel: "aal1", nextLevel: "aal2" },
            error: null,
          })),
        },
      }),
    );
    expect(
      await redirectTarget(() => signIn(undefined, form({ ...OK, next: "/app/tenants?x=1" }))),
    ).toBe("/auth/mfa?next=%2Fapp%2Ftenants%3Fx%3D1");
  });

  it("never carries an untrusted next into the challenge", async () => {
    createClient.mockResolvedValue(
      fakeSupabase({
        signInWithPassword: okSignIn,
        mfa: {
          ...fakeSupabase().auth.mfa,
          getAuthenticatorAssuranceLevel: vi.fn(async () => ({
            data: { currentLevel: "aal1", nextLevel: "aal2" },
            error: null,
          })),
        },
      }),
    );
    expect(
      await redirectTarget(() => signIn(undefined, form({ ...OK, next: "//evil.example" }))),
    ).toBe("/auth/mfa?next=%2Fapp");
  });

  it("goes straight to the app when no second step is needed, or the level cannot be read", async () => {
    createClient.mockResolvedValue(fakeSupabase({ signInWithPassword: okSignIn }));
    expect(await redirectTarget(() => signIn(undefined, form(OK)))).toBe("/app");
    createClient.mockResolvedValue(
      fakeSupabase({
        signInWithPassword: okSignIn,
        mfa: {
          ...fakeSupabase().auth.mfa,
          getAuthenticatorAssuranceLevel: vi.fn(async () => {
            throw new Error("down");
          }),
        },
      }),
    );
    // not reading the level never grants anything: the app's own gate (requireUser) sends an enrolled person to the challenge
    expect(await redirectTarget(() => signIn(undefined, form(OK)))).toBe("/app");
  });

  it("has no sign-up: the module exports no signUp and the form has no way to create an account", async () => {
    const actions = await import("./actions");
    expect(Object.keys(actions)).toEqual(["signIn"]);
  });
});
