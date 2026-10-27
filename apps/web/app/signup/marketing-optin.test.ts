import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { redirectMock } from "@/test/helpers";

const signUpAuth = vi.fn();
vi.mock("next/headers", () => ({ headers: async () => ({ get: () => null }), cookies: async () => ({ set: (...a: unknown[]) => cookieSet(...a), delete: (...a: unknown[]) => cookieDelete(...a) }) }));
vi.mock("next/navigation", () => ({ redirect: (to: string) => redirectMock(to) }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => ({ auth: { signUp: (...a: unknown[]) => signUpAuth(...a), signInWithOAuth: async () => ({ data: { url: "https://accounts.example.test/x" }, error: null }) } }) }));
vi.mock("@/lib/supabase/authorize-probe", () => ({ providerIsOn: async () => true }));
vi.mock("@/lib/api/pack", async (orig) => ({ ...(await orig<typeof import("@/lib/api/pack")>()), listPacks: async () => (await import("@/lib/api/pack").then((m) => import("@/lib/packs/pack-test-kit").then((k) => k.packsWire().packs.map(m.parsePackSummary)))) }));
const cookieSet = vi.fn();
const cookieDelete = vi.fn();

import { selectableIds } from "@/lib/packs/pack-test-kit";

import { signUp } from "./actions";
import { continueWithProvider } from "./oauth-actions";

const [FIRST] = selectableIds();
const input = { email: "asha@example.test", password: "a-long-password-1", businessType: FIRST, acceptTerms: true };
beforeEach(() => {
  vi.clearAllMocks();
  signUpAuth.mockResolvedValue({ data: { user: { identities: [{}] } }, error: null });
  vi.stubEnv("NEXT_PUBLIC_SIGNUP_OPEN", "1");
});
afterEach(() => vi.unstubAllEnvs());
const meta = () => signUpAuth.mock.calls[0][0].options.data as Record<string, string>;
const form = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};
const where = async (data: FormData) => {
  try {
    await continueWithProvider(data);
  } catch (e) {
    return (e as { to?: string }).to ?? String(e);
  }
  return null;
};

describe("the unticked marketing box, by e-mail (job DQ part 2)", () => {
  it("is kept in the account's metadata only when it was exactly true AND the consent API is on", async () => {
    vi.stubEnv("DPDP_SCREENS", "mock");
    await signUp({ ...input, marketingOptIn: true });
    expect(meta().signup_marketing_opt_in).toBe("1");
    signUpAuth.mockClear();
    await signUp({ ...input, marketingOptIn: false });
    expect(meta()).not.toHaveProperty("signup_marketing_opt_in");
    signUpAuth.mockClear();
    await signUp({ ...input, marketingOptIn: "true" as never });
    expect(meta()).not.toHaveProperty("signup_marketing_opt_in");
    signUpAuth.mockClear();
    await signUp(input);
    expect(meta()).not.toHaveProperty("signup_marketing_opt_in");
  });
  it("is dropped while the consent API is off, however the post was forged", async () => {
    await signUp({ ...input, marketingOptIn: true });
    expect(meta()).not.toHaveProperty("signup_marketing_opt_in");
  });
});

describe("the unticked marketing box, through Google or Facebook", () => {
  it("a ticked box leaves a short-lived cookie naming the provider; an unticked one leaves none and clears an old one", async () => {
    vi.stubEnv("DPDP_SCREENS", "mock");
    expect(await where(form({ provider: "google", type: FIRST, marketing: "on" }))).toContain("https://");
    const call = cookieSet.mock.calls.find((c) => c[0] === "sme_signup_marketing")!;
    expect(call[1]).toBe("google");
    expect(call[2]).toMatchObject({ httpOnly: true, sameSite: "lax", maxAge: 3600, path: "/" });
    cookieSet.mockClear();
    expect(await where(form({ provider: "facebook", type: FIRST }))).toContain("https://");
    expect(cookieSet.mock.calls.find((c) => c[0] === "sme_signup_marketing")).toBeUndefined();
    expect(cookieDelete).toHaveBeenCalledWith("sme_signup_marketing");
  });
  it("is ignored while the consent API is off", async () => {
    await where(form({ provider: "google", type: FIRST, marketing: "on" }));
    expect(cookieSet.mock.calls.find((c) => c[0] === "sme_signup_marketing")).toBeUndefined();
  });
});
