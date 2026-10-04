import { beforeEach, describe, expect, it, vi } from "vitest";

import { fakeSupabase, redirectMock, redirectTarget } from "@/test/helpers";

const createClient = vi.fn();
vi.mock("next/navigation", () => ({
  redirect: (to: string) => redirectMock(to),
}));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: () => createClient(),
}));

import { signIn, signUp } from "./actions";

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

describe("signUp", () => {
  beforeEach(() => vi.clearAllMocks());

  it("requires a minimum password length server-side", async () => {
    const supabase = fakeSupabase();
    createClient.mockResolvedValue(supabase);
    const result = await signUp(
      undefined,
      form({ email: "a@example.test", password: "short" }),
    );
    expect(result?.error).toMatch(/at least 8/);
    expect(supabase.auth.signUp).not.toHaveBeenCalled();
  });

  it("redirects to a validated target when a session is issued immediately", async () => {
    const supabase = fakeSupabase({
      signUp: vi.fn(async () => ({ data: { session: {} }, error: null })),
    });
    createClient.mockResolvedValue(supabase);
    expect(
      await redirectTarget(() =>
        signUp(undefined, form({ ...OK, next: "//evil.example" })),
      ),
    ).toBe("/app");
  });

  it("asks the user to confirm their email when no session is issued", async () => {
    createClient.mockResolvedValue(fakeSupabase());
    const result = await signUp(undefined, form(OK));
    expect(result?.message).toMatch(/Check your email/);
  });

  it("reports a generic failure without revealing whether the account exists", async () => {
    const supabase = fakeSupabase({
      signUp: vi.fn(async () => ({
        data: {},
        error: {
          message: "User already registered",
          code: "user_already_exists",
        },
      })),
    });
    createClient.mockResolvedValue(supabase);
    const result = await signUp(undefined, form(OK));
    expect(result).toEqual({ error: "Could not create the account." });
  });
});
