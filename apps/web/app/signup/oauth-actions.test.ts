import { beforeEach, describe, expect, it, vi } from "vitest";

import { redirectMock } from "@/test/helpers";

const signInWithOAuth = vi.fn();
const cookieSet = vi.fn();
vi.mock("next/navigation", () => ({ redirect: (to: string) => redirectMock(to) }));
vi.mock("next/headers", () => ({ cookies: async () => ({ set: (...a: unknown[]) => cookieSet(...a) }) }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => ({ auth: { signInWithOAuth: (...a: unknown[]) => signInWithOAuth(...a) } }) }));

import { continueWithProvider } from "./oauth-actions";

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

beforeEach(() => {
  vi.clearAllMocks();
  signInWithOAuth.mockResolvedValue({ data: { url: "https://accounts.example.test/o/oauth2/auth?x=1" }, error: null });
});

describe("Continue with Google / Facebook (step 2 of the sign-up)", () => {
  it("remembers the kind of business in a short-lived cookie the page script cannot read, then sends the browser to the provider's address", async () => {
    expect(await where(form({ provider: "google", type: "construction" }))).toBe("https://accounts.example.test/o/oauth2/auth?x=1");
    const [name, value, options] = cookieSet.mock.calls[0];
    expect(name).toBe("s19_signup_pack");
    expect(value).toBe("construction");
    expect(options).toMatchObject({ httpOnly: true, sameSite: "lax", maxAge: 3600, path: "/" });
    const call = signInWithOAuth.mock.calls[0][0];
    expect(call.provider).toBe("google");
    expect(call.options.skipBrowserRedirect).toBe(true);
    expect(call.options.redirectTo).toMatch(/\/auth\/callback$/);
    expect(await where(form({ provider: "facebook", type: "education" }))).toContain("https://");
    expect(signInWithOAuth.mock.calls[1][0].provider).toBe("facebook");
  });
  it("trusts neither the provider nor the kind: another provider goes back to step 2, an unknown kind back to step 1, and nothing is remembered or asked", async () => {
    expect(await where(form({ provider: "github", type: "construction" }))).toBe("/signup?type=construction");
    expect(await where(form({ provider: "google", type: "nonsense" }))).toBe("/signup");
    expect(await where(form({ provider: "google" }))).toBe("/signup");
    expect(await where(form({ type: "education" }))).toBe("/signup?type=education");
    expect(signInWithOAuth).not.toHaveBeenCalled();
    expect(cookieSet).not.toHaveBeenCalled();
  });
  it("goes back to step 2 with one closed word when the provider is not switched on (nothing is created)", async () => {
    signInWithOAuth.mockResolvedValue({ data: { url: null }, error: { message: "Unsupported provider: provider is not enabled" } });
    expect(await where(form({ provider: "google", type: "education" }))).toBe("/signup?type=education&error=provider");
    signInWithOAuth.mockResolvedValue({ data: null, error: null });
    expect(await where(form({ provider: "facebook", type: "education" }))).toBe("/signup?type=education&error=provider");
  });
});
