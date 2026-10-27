import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { redirectMock } from "@/test/helpers";

const providers = vi.fn();
vi.mock("@/lib/api/pack", async (orig) => ({ ...(await orig<typeof import("@/lib/api/pack")>()), getAuthProviders: () => providers() }));
vi.mock("./actions", () => ({ signIn: vi.fn() }));
vi.mock("@/design/fonts", () => ({ v2FontClassName: () => "font-vars" }));

const signInWithOAuth = vi.fn();
const probe = vi.fn();
vi.mock("next/navigation", () => ({ redirect: (to: string) => redirectMock(to) }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => ({ auth: { signInWithOAuth: (...a: unknown[]) => signInWithOAuth(...a) } }) }));
vi.stubGlobal("fetch", (...a: unknown[]) => probe(...a)); // the probe of lib/supabase/authorize-probe.ts goes through fetch

import LoginPage from "./page";
import { signInWithGoogle } from "./google-action";

afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  providers.mockResolvedValue({ google: true, facebook: false });
  probe.mockResolvedValue({ status: 302 });
  signInWithOAuth.mockResolvedValue({ data: { url: "https://accounts.example.test/o/oauth2/auth?x=1" }, error: null });
});

const where = async () => {
  try {
    await signInWithGoogle();
  } catch (e) {
    return (e as { to?: string }).to ?? String(e);
  }
  return null;
};

describe("Continue with Google on the sign-in page", () => {
  it("is drawn when the server says Google is on, whether or not sign-up is open", async () => {
    render(await LoginPage({ searchParams: Promise.resolve({}) } as never));
    expect(screen.getByRole("button", { name: "Continue with Google" })).toBeInTheDocument();
    expect(document.querySelector('[data-part="google-sign-in"]')).not.toBeNull();
  });
  it("is not drawn when Google is off, or when the server cannot say", async () => {
    providers.mockResolvedValue({ google: false, facebook: true });
    render(await LoginPage({ searchParams: Promise.resolve({}) } as never));
    expect(screen.queryByRole("button", { name: /Google/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Facebook/ })).toBeNull(); // sign-in offers Google only
  });
  it("says plainly that there is no account when the Auth server refused a new address, and only then", async () => {
    render(await LoginPage({ searchParams: Promise.resolve({ notice: "nosignup" }) } as never));
    expect(screen.getByRole("status").textContent).toMatch(/no account for that Google address/);
  });
});

describe("the sign-in action", () => {
  it("sends the browser to Google with the callback as the return, remembers no kind of business and sets no cookie", async () => {
    expect(await where()).toBe("https://accounts.example.test/o/oauth2/auth?x=1");
    const call = signInWithOAuth.mock.calls[0][0];
    expect(call.provider).toBe("google");
    expect(call.options.skipBrowserRedirect).toBe(true);
    expect(call.options.redirectTo).toMatch(/\/auth\/callback$/);
  });
  it("goes back to sign-in with one sentence when the provider is off or the address cannot be built", async () => {
    probe.mockResolvedValue({ status: 400 });
    expect(await where()).toBe("/login?notice=provider");
    signInWithOAuth.mockResolvedValue({ data: null, error: { message: "x" } });
    expect(await where()).toBe("/login?notice=provider");
  });
});
