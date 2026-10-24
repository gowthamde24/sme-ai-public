import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const createClient = vi.fn();
const packList = vi.fn();
const providers = vi.fn();
const redirect = vi.fn((to: string) => {
  throw new Error(`REDIRECT ${to}`);
});
const jarValues: Record<string, string> = {};
vi.mock("next/headers", () => ({
  headers: async () => ({ get: () => null }),
  cookies: async () => ({ get: (name: string) => (name in jarValues ? { name, value: jarValues[name] } : undefined), set: vi.fn() }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }), redirect: (to: string) => redirect(to) }));
vi.mock("@/design/fonts", () => ({ v2FontClassName: () => "font-vars" }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: () => createClient() }));
vi.mock("@/lib/api/pack", async (orig) => ({ ...(await orig<typeof import("@/lib/api/pack")>()), listPacks: () => packList(), getAuthProviders: () => providers() }));

import { isSignupOpen } from "@/lib/auth/signup-open";
import { signupDict } from "@/i18n/signup";
import { LANGS } from "@/i18n/lang";

import { signUp } from "./actions";
import { continueWithProvider } from "./oauth-actions";
import SignupPage from "./page";

const props = (query: Record<string, string> = {}) => ({ searchParams: Promise.resolve(query), params: Promise.resolve({}) }) as never;
const GOOD = { name: "Asha", email: "asha@example.test", password: "a long enough passphrase", businessName: "Sri Lakshmi Silks", acceptTerms: true };
let prev: string | undefined;
beforeEach(() => {
  vi.clearAllMocks();
  for (const k of Object.keys(jarValues)) delete jarValues[k];
  prev = process.env.NEXT_PUBLIC_SIGNUP_OPEN;
});
afterEach(() => {
  cleanup();
  if (prev === undefined) delete process.env.NEXT_PUBLIC_SIGNUP_OPEN;
  else process.env.NEXT_PUBLIC_SIGNUP_OPEN = prev;
});

describe("the one setting (job DH)", () => {
  it("only \"0\" closes sign-up: unset and anything else leave it open, as it always was", () => {
    expect(isSignupOpen({})).toBe(true);
    expect(isSignupOpen({ NEXT_PUBLIC_SIGNUP_OPEN: "1" })).toBe(true);
    expect(isSignupOpen({ NEXT_PUBLIC_SIGNUP_OPEN: "" })).toBe(true);
    expect(isSignupOpen({ NEXT_PUBLIC_SIGNUP_OPEN: "0" })).toBe(false);
  });
});

describe("/signup while sign-up is closed", () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_SIGNUP_OPEN = "0";
  });
  it("says it kindly, shows the early-access address as selectable text with Copy, offers sign-in, and has no form, no business cards, no e-mail button, no Google or Facebook", async () => {
    render(await SignupPage(props()));
    expect(screen.getByRole("heading", { level: 1, name: "We are opening to businesses soon" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Request early access" })).toBeInTheDocument();
    const box = screen.getByRole("region", { name: "Request early access" });
    expect(within(box).getByText("hello@stack19.com")).toBeInTheDocument(); // plain text, selectable
    expect(within(box).getByText("hello@stack19.com").tagName).toBe("SPAN");
    expect(within(box).getByRole("button", { name: /Copy hello@stack19\.com/ })).toBeInTheDocument();
    expect(within(box).getByRole("link", { name: /Write an e-mail to hello@stack19\.com/ })).toHaveAttribute("href", "mailto:hello@stack19.com"); // mailto only as an extra
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/login");
    expect(document.querySelector("form")).toBeNull();
    expect(document.querySelectorAll("input")).toHaveLength(0);
    expect(document.querySelector("[data-pack-card]")).toBeNull();
    expect(screen.queryByText(/Continue with/)).toBeNull();
    expect(screen.queryByText(/Step 1 of 2|Step 2 of 2/)).toBeNull();
  });
  it("asks the API for nothing, even with a business type in the address", async () => {
    render(await SignupPage(props({ type: "textiles" })));
    expect(packList).not.toHaveBeenCalled();
    expect(providers).not.toHaveBeenCalled();
    expect(screen.getByText("We are opening to businesses soon")).toBeInTheDocument();
  });
  it.each(["te", "hi", "kn"] as const)("%s: the note is in that language", async (lang) => {
    jarValues.sme_lang = lang;
    render(await SignupPage(props()));
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(signupDict(lang)["signup.closed.title"]);
    expect(screen.getByRole("heading", { level: 1 }).textContent).not.toBe("We are opening to businesses soon");
  });
  it("the sign-up action refuses without touching the Auth server, and the provider action goes back to the note", async () => {
    expect(await signUp(GOOD)).toEqual({ ok: false, error: "closed" });
    expect(createClient).not.toHaveBeenCalled();
    const fd = new FormData();
    fd.set("provider", "google");
    fd.set("type", "textiles");
    await expect(continueWithProvider(fd)).rejects.toThrow("REDIRECT /signup");
    expect(createClient).not.toHaveBeenCalled();
    expect(packList).not.toHaveBeenCalled();
  });
});

describe("/signup while sign-up is open (today's behaviour)", () => {
  beforeEach(() => {
    delete process.env.NEXT_PUBLIC_SIGNUP_OPEN;
    packList.mockResolvedValue([]);
    providers.mockResolvedValue({ google: false, facebook: false });
  });
  it("asks the API for the business types and shows step 1, not the closed note", async () => {
    render(await SignupPage(props()));
    expect(packList).toHaveBeenCalled();
    expect(screen.queryByText("We are opening to businesses soon")).toBeNull();
    expect(screen.getByText(/Step 1 of 2/)).toBeInTheDocument();
  });
  it("every language has the closed-note words (strings are checked for placeholders and script elsewhere)", () => {
    for (const l of LANGS) for (const k of ["signup.closed.title", "signup.closed.body", "signup.closed.early", "signup.closed.write", "signup.err.closed"] as const) expect(signupDict(l)[k], `${l}:${k}`).toBeTruthy();
  });
});
