import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fakeSupabase } from "@/test/helpers";

const createClient = vi.fn();
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: () => createClient() }));

import { RESET_MESSAGE } from "@/lib/auth/messages";

import { requestPasswordReset } from "./actions";

function form(email: string): FormData {
  const data = new FormData();
  data.set("email", email);
  return data;
}


describe("requestPasswordReset", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  it("says exactly the same thing whether or not the address has an account, or the Auth server complained", async () => {
    const outcomes: Record<string, () => Promise<unknown>> = {
      known: async () => ({ data: {}, error: null }),
      unknown: async () => ({ data: {}, error: null }),
      "rate limited": async () => ({ data: {}, error: { message: "email rate limit exceeded", code: "over_email_send_rate_limit", status: 429 } }),
      "user not found": async () => ({ data: {}, error: { message: "User not found", code: "user_not_found", status: 404 } }),
      "network down": async () => {
        throw new Error("ECONNREFUSED");
      },
    };
    const results: string[] = [];
    for (const impl of Object.values(outcomes)) {
      createClient.mockResolvedValue(fakeSupabase({ resetPasswordForEmail: vi.fn(impl) }));
      const promise = requestPasswordReset(undefined, form("someone@example.test"));
      await vi.advanceTimersByTimeAsync(2000);
      results.push(JSON.stringify(await promise));
    }
    expect(new Set(results).size).toBe(1);
    expect(results[0]).toBe(JSON.stringify({ message: RESET_MESSAGE }));
  });

  it("takes the same time on a fast path and a slow one (held to a minimum)", async () => {
    const fast = vi.fn(async () => ({ data: {}, error: null }));
    const slow = vi.fn(() => new Promise((resolve) => setTimeout(() => resolve({ data: {}, error: null }), 300)));
    const took: number[] = [];
    for (const impl of [fast, slow]) {
      createClient.mockResolvedValue(fakeSupabase({ resetPasswordForEmail: impl }));
      const start = Date.now();
      const promise = requestPasswordReset(undefined, form("someone@example.test")).then((r) => {
        took.push(Date.now() - start);
        return r;
      });
      await vi.advanceTimersByTimeAsync(2000);
      await promise;
    }
    expect(took[0]).toBeGreaterThanOrEqual(800);
    expect(took[1]).toBeGreaterThanOrEqual(800);
    expect(Math.abs(took[0] - took[1])).toBeLessThanOrEqual(10);
  });

  it("never reveals the address or the Auth server's words", async () => {
    createClient.mockResolvedValue(
      fakeSupabase({ resetPasswordForEmail: vi.fn(async () => ({ data: {}, error: { message: "CANARY someone@example.test" } })) }),
    );
    const promise = requestPasswordReset(undefined, form("someone@example.test"));
    await vi.advanceTimersByTimeAsync(2000);
    const text = JSON.stringify(await promise);
    expect(text).not.toContain("CANARY");
    expect(text).not.toContain("someone@example.test");
  });

  it("normalises the address and sends no redirect target of its own (the mail's link comes from the project's template)", async () => {
    const reset = vi.fn(async () => ({ data: {}, error: null }));
    createClient.mockResolvedValue(fakeSupabase({ resetPasswordForEmail: reset }));
    const promise = requestPasswordReset(undefined, form("  Someone@Example.TEST "));
    await vi.advanceTimersByTimeAsync(2000);
    await promise;
    expect(reset).toHaveBeenCalledWith("someone@example.test");
  });

  it.each(["", "not-an-email", "a@b", "a@" + "x".repeat(260) + ".test"])("a malformed address (%j) is the only thing it names, and asks nothing of the Auth server", async (email) => {
    const reset = vi.fn(async () => ({ data: {}, error: null }));
    createClient.mockResolvedValue(fakeSupabase({ resetPasswordForEmail: reset }));
    expect(await requestPasswordReset(undefined, form(email))).toEqual({ error: "Enter a valid email address." });
    expect(reset).not.toHaveBeenCalled();
  });
});
