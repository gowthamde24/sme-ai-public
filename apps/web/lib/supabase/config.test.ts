import { afterEach, describe, expect, it, vi } from "vitest";

import { getSupabasePublicConfig } from "./config";

afterEach(() => vi.unstubAllEnvs());

describe("getSupabasePublicConfig", () => {
  it("reads the publishable key", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "pub");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");
    expect(getSupabasePublicConfig()).toEqual({ url: "http://127.0.0.1:54321", anonKey: "pub" });
  });

  it("still accepts the legacy anon name", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "legacy");
    expect(getSupabasePublicConfig().anonKey).toBe("legacy");
  });

  it("the publishable name wins when both are set", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "pub");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "legacy");
    expect(getSupabasePublicConfig().anonKey).toBe("pub");
  });

  it("fails closed with neither key, naming both", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");
    expect(() => getSupabasePublicConfig()).toThrow(/PUBLISHABLE_KEY.*ANON_KEY/);
  });
});
