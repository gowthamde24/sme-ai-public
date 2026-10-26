import { beforeEach, describe, expect, it, vi } from "vitest";

import { redirectMock } from "@/test/helpers";

const signInWithOAuth = vi.fn();
const cookieSet = vi.fn();
vi.mock("next/navigation", () => ({ redirect: (to: string) => redirectMock(to) }));
const cookieDelete = vi.fn();
vi.mock("next/headers", () => ({ cookies: async () => ({ set: (...a: unknown[]) => cookieSet(...a), delete: (...a: unknown[]) => cookieDelete(...a) }) }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => ({ auth: { signInWithOAuth: (...a: unknown[]) => signInWithOAuth(...a) } }) }));

import { continueWithProvider } from "./oauth-actions";

const form = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};
const packList = vi.fn();
vi.mock("@/lib/api/pack", async (orig) => ({ ...(await orig<typeof import("@/lib/api/pack")>()), listPacks: () => packList() }));

import { parsePackSummary } from "@/lib/api/pack";
import { packsWire, selectableIds } from "@/lib/packs/pack-test-kit";

const [, SECOND, THIRD] = selectableIds();
const where = async (data: FormData) => {
  try {
    await continueWithProvider(data);
  } catch (e) {
    return (e as { to?: string }).to ?? String(e);
  }
  return null;
};

const probe = vi.fn();
vi.stubGlobal("fetch", (...a: unknown[]) => probe(...a)); // the probe of lib/supabase/authorize-probe.ts goes through fetch

beforeEach(() => {
  vi.clearAllMocks();
  probe.mockResolvedValue({ status: 302 }); // the Auth server redirects to the provider: it is on
  signInWithOAuth.mockResolvedValue({ data: { url: "https://accounts.example.test/o/oauth2/auth?x=1" }, error: null });
  packList.mockResolvedValue(packsWire().packs.map(parsePackSummary));
});

describe("Continue with Google / Facebook (step 2 of the sign-up)", () => {
  it("remembers the kind of business in a short-lived cookie the page script cannot read, then sends the browser to the provider's address", async () => {
    expect(await where(form({ provider: "google", type: SECOND }))).toBe("https://accounts.example.test/o/oauth2/auth?x=1");
    const [name, value, options] = cookieSet.mock.calls[0];
    expect(name).toBe("s19_signup_pack");
    expect(value).toBe(SECOND);
    expect(options).toMatchObject({ httpOnly: true, sameSite: "lax", maxAge: 3600, path: "/" });
    const call = signInWithOAuth.mock.calls[0][0];
    expect(call.provider).toBe("google");
    expect(call.options.skipBrowserRedirect).toBe(true);
    expect(call.options.redirectTo).toMatch(/\/auth\/callback$/);
    expect(await where(form({ provider: "facebook", type: THIRD }))).toContain("https://");
    expect(signInWithOAuth.mock.calls[1][0].provider).toBe("facebook");
  });
  it("trusts neither the provider nor the kind: another provider goes back to step 2, an unknown kind back to step 1, and nothing is remembered or asked", async () => {
    expect(await where(form({ provider: "github", type: SECOND }))).toBe(`/signup?type=${SECOND}`);
    expect(await where(form({ provider: "google", type: "Not A Code" }))).toBe("/signup");
    expect(await where(form({ provider: "google", type: "a_type_nobody_offers" }))).toBe("/signup"); // well-formed, but not one of the cards the API offers
    packList.mockRejectedValueOnce(new Error("down"));
    expect(await where(form({ provider: "google", type: SECOND }))).toBe("/signup"); // the server cannot say: back to step 1, which says so
    expect(await where(form({ provider: "google" }))).toBe("/signup");
    expect(await where(form({ type: THIRD }))).toBe(`/signup?type=${THIRD}`);
    expect(signInWithOAuth).not.toHaveBeenCalled();
    expect(cookieSet).not.toHaveBeenCalled();
  });
  it("asks the authorize address once WITHOUT following it, and goes back to step 2 when the Auth server refuses it (the address is only built by signInWithOAuth; a provider that is off shows when it is followed)", async () => {
    probe.mockResolvedValue({ status: 400 });
    expect(await where(form({ provider: "google", type: SECOND }))).toBe(`/signup?type=${SECOND}&error=provider`);
    expect(probe.mock.calls[0][0]).toBe("https://accounts.example.test/o/oauth2/auth?x=1");
    expect(probe.mock.calls[0][1]).toMatchObject({ redirect: "manual" });
    probe.mockRejectedValue(new Error("network"));
    expect(await where(form({ provider: "facebook", type: SECOND }))).toBe(`/signup?type=${SECOND}&error=provider`);
  });
  it("goes back to step 2 with one closed word when the provider is not switched on (nothing is created)", async () => {
    signInWithOAuth.mockResolvedValue({ data: { url: null }, error: { message: "Unsupported provider: provider is not enabled" } });
    expect(await where(form({ provider: "google", type: THIRD }))).toBe(`/signup?type=${THIRD}&error=provider`);
    signInWithOAuth.mockResolvedValue({ data: null, error: null });
    expect(await where(form({ provider: "facebook", type: THIRD }))).toBe(`/signup?type=${THIRD}&error=provider`);
  });
});
