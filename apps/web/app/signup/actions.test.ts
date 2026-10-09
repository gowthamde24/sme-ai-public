import { beforeEach, describe, expect, it, vi } from "vitest";

import { fakeSupabase } from "@/test/helpers";

const createClient = vi.fn();
const headerMap: Record<string, string> = {};
vi.mock("next/headers", () => ({ headers: async () => ({ get: (n: string) => headerMap[n] ?? null }) }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: () => createClient() }));

import { signUp } from "./actions";

const GOOD = {
  name: "Asha",
  email: "asha@example.test",
  password: "a long enough passphrase",
  businessName: "Sri Lakshmi Silks",
  acceptTerms: true,
};

describe("the signUp action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const k of Object.keys(headerMap)) delete headerMap[k];
  });

  it("signs up through the server's Auth client and answers check-email", async () => {
    const supabase = fakeSupabase({
      signUp: vi.fn(async () => ({ data: { user: { identities: [{}] } }, error: null })),
    });
    createClient.mockResolvedValue(supabase);
    headerMap["x-forwarded-for"] = "203.0.113.50";
    expect(await signUp(GOOD)).toEqual({ ok: true, next: "check-email" });
    expect(supabase.auth.signUp).toHaveBeenCalledOnce();
  });

  it("holds one address to five sign-ups an hour (the default), then says too_many_signups", async () => {
    const supabase = fakeSupabase({
      signUp: vi.fn(async () => ({ data: { user: { identities: [{}] } }, error: null })),
    });
    createClient.mockResolvedValue(supabase);
    headerMap["x-forwarded-for"] = "203.0.113.99";
    const out = [];
    for (let i = 0; i < 6; i += 1) out.push(await signUp({ ...GOOD, email: `n${i}@example.test` }));
    expect(out.filter((r) => r.ok)).toHaveLength(5);
    expect(out[5]).toEqual({ ok: false, error: "too_many_signups" });
  });

  it("has no way to be told a different business name or terms version than the form's own fields", async () => {
    const supabase = fakeSupabase({ signUp: vi.fn(async () => ({ data: { user: { identities: [{}] } }, error: null })) });
    createClient.mockResolvedValue(supabase);
    headerMap["x-forwarded-for"] = "203.0.113.60";
    await signUp({ ...GOOD, terms_version: "evil", role: "owner" } as unknown as typeof GOOD);
    const sent = supabase.auth.signUp.mock.calls[0][0];
    expect(Object.keys(sent.options.data).sort()).toEqual(["business_name", "display_name", "terms_version"]);
    expect(sent.options.data.terms_version).toBe("draft-1");
  });
});
