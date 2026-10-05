import { beforeEach, describe, expect, it, vi } from "vitest";

import { fakeSupabase, redirectMock, redirectTarget } from "@/test/helpers";

const createClient = vi.fn();
vi.mock("next/navigation", () => ({ redirect: (to: string) => redirectMock(to) }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: () => createClient() }));

import { confirmLink } from "./actions";

const TOKEN = "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2";
const BAD = "This link has expired or was already used. Request a new one.";

function form(values: Record<string, string>): FormData {
  const data = new FormData();
  for (const [k, v] of Object.entries(values)) data.set(k, v);
  return data;
}

describe("confirmLink", () => {
  beforeEach(() => vi.clearAllMocks());

  it("an invite or a reset goes to choose a password", async () => {
    for (const type of ["invite", "recovery"]) {
      const supabase = fakeSupabase();
      createClient.mockResolvedValue(supabase);
      expect(await redirectTarget(() => confirmLink(undefined, form({ token_hash: TOKEN, type })))).toBe(`/auth/set-password?type=${type}`);
      expect(supabase.auth.verifyOtp).toHaveBeenCalledWith({ type, token_hash: TOKEN });
    }
  });

  it("an e-mail confirmation goes to a same-site next, or the default", async () => {
    createClient.mockResolvedValue(fakeSupabase());
    expect(await redirectTarget(() => confirmLink(undefined, form({ token_hash: TOKEN, type: "email", next: "/app/tenants/1?x=2" })))).toBe("/app/tenants/1?x=2");
    expect(await redirectTarget(() => confirmLink(undefined, form({ token_hash: TOKEN, type: "email" })))).toBe("/app");
  });

  it.each([
    "//evil.example",
    "https://evil.example/app",
    "/\\evil.example",
    "javascript:alert(1)",
    "/%2f%2fevil.example",
    "/%5Cevil.example",
    "//evil.example/%2e%2e",
    "/login",
    " /app",
    "/app\r\nLocation: https://evil.example",
    "http://localhost:3000.evil.example",
  ])("never redirects to the untrusted target %j", async (next) => {
    createClient.mockResolvedValue(fakeSupabase());
    const to = await redirectTarget(() => confirmLink(undefined, form({ token_hash: TOKEN, type: "email", next })));
    expect(to).toBe("/app");
  });

  it("an invite or reset never follows `next` at all", async () => {
    createClient.mockResolvedValue(fakeSupabase());
    expect(await redirectTarget(() => confirmLink(undefined, form({ token_hash: TOKEN, type: "recovery", next: "https://evil.example" })))).toBe("/auth/set-password?type=recovery");
  });

  it("an expired, reused or unknown token gets the one fixed message and no redirect", async () => {
    for (const message of ["Email link is invalid or has expired", "Token has expired or is invalid", "otp_expired", "weird"]) {
      createClient.mockResolvedValue(
        fakeSupabase({ verifyOtp: vi.fn(async () => ({ data: {}, error: { message, code: "otp_expired", status: 403 } })) }),
      );
      const result = await confirmLink(undefined, form({ token_hash: TOKEN, type: "invite" }));
      expect(result).toEqual({ error: BAD });
    }
  });

  it("a second use of the same link fails the same way (the Auth server consumed it)", async () => {
    const verifyOtp = vi.fn().mockResolvedValueOnce({ data: {}, error: null }).mockResolvedValueOnce({ data: {}, error: { message: "used", code: "otp_expired" } });
    createClient.mockResolvedValue(fakeSupabase({ verifyOtp }));
    expect(await redirectTarget(() => confirmLink(undefined, form({ token_hash: TOKEN, type: "invite" })))).toBe("/auth/set-password?type=invite");
    expect(await confirmLink(undefined, form({ token_hash: TOKEN, type: "invite" }))).toEqual({ error: BAD });
  });

  it.each(["signup", "magiclink", "email_change", "reauthentication", "INVITE", "", "../recovery"])(
    "refuses the type %j without asking the Auth server",
    async (type) => {
      const supabase = fakeSupabase();
      createClient.mockResolvedValue(supabase);
      expect(await confirmLink(undefined, form({ token_hash: TOKEN, type }))).toEqual({ error: BAD });
      expect(supabase.auth.verifyOtp).not.toHaveBeenCalled();
    },
  );

  it.each(["", "short", "has space in it 12345", "x".repeat(300), "tok/en12345", "tok;en12345"])(
    "refuses the token %j without asking the Auth server",
    async (token_hash) => {
      const supabase = fakeSupabase();
      createClient.mockResolvedValue(supabase);
      expect(await confirmLink(undefined, form({ token_hash, type: "invite" }))).toEqual({ error: BAD });
      expect(supabase.auth.verifyOtp).not.toHaveBeenCalled();
    },
  );

  it("never echoes the token or the Auth server's words", async () => {
    createClient.mockResolvedValue(
      fakeSupabase({ verifyOtp: vi.fn(async () => ({ data: {}, error: { message: `CANARY ${TOKEN}`, code: "x" } })) }),
    );
    const result = await confirmLink(undefined, form({ token_hash: TOKEN, type: "invite" }));
    expect(JSON.stringify(result)).not.toContain("CANARY");
    expect(JSON.stringify(result)).not.toContain(TOKEN);
  });
});
