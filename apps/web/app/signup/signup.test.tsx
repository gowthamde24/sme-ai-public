import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const push = vi.fn();
const signUp = vi.fn();
const providerAction = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("./actions", () => ({ signUp: (...a: unknown[]) => signUp(...a) }));
vi.mock("./oauth-actions", () => ({ continueWithProvider: (...a: unknown[]) => providerAction(...a) }));
vi.mock("@/design/fonts", () => ({ v2FontClassName: () => "font-vars" }));
const currentPolicies = vi.fn();
vi.mock("@/lib/api/policy", async (orig) => ({ ...(await orig<typeof import("@/lib/api/policy")>()), getCurrentPolicies: () => currentPolicies() }));
// the cards and the ways to sign in come from the API (job CK): here from the real pack files through the API's shapes
const packList = vi.fn();
const providers = vi.fn();
vi.mock("@/lib/api/pack", async (orig) => ({ ...(await orig<typeof import("@/lib/api/pack")>()), listPacks: () => packList(), getAuthProviders: () => providers() }));

import { parsePackSummary } from "@/lib/api/pack";
import { packsWire, selectableIds } from "@/lib/packs/pack-test-kit";

import CheckEmailPage from "./check-email/page";
import { SignUpForm, type SignUpWords } from "./sign-up-form";
import SignupPage from "./page";
import type { SignUpResult } from "@/lib/api/signup";

const words: SignUpWords = {
  email: "Email", password: "Password", passwordHint: "At least 12 characters.", submit: "Create account",
  errors: { weak_password: "Choose a stronger password.", terms_required: "You need to agree to the Terms and the Privacy notice.", unknown: "Something went wrong." },
};
const fill = () => {
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: " asha@example.test " } });
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: "a-long-password-1" } });
};
const props = (query: Record<string, string | string[] | undefined> = {}) => ({ searchParams: Promise.resolve(query), params: Promise.resolve({}) }) as never;

const SUMMARIES = packsWire().packs.map(parsePackSummary);
const IDS = selectableIds();
const [FIRST, SECOND, THIRD] = [IDS[0], IDS[1], IDS[2]];
const nameOf = (id: string) => SUMMARIES.find((p) => p.packId === id)!.names.en;
beforeEach(() => {
  vi.clearAllMocks();
  currentPolicies.mockResolvedValue({ terms: "2026-11-01", privacy: "2026-10-01" });
  packList.mockResolvedValue(SUMMARIES);
  providers.mockResolvedValue({ google: true, facebook: true });
});
afterEach(cleanup);

describe("SignUpForm (the e-mail way of step 2)", () => {
  const ok = async (): Promise<SignUpResult> => ({ ok: true, next: "check-email" });
  it("asks an address and a password, nothing else: no name, no business name, no tick box", () => {
    render(<SignUpForm words={words} action={ok} businessType={SECOND} />);
    expect(screen.getAllByRole("textbox")).toHaveLength(1); // the address (a password field has no textbox role)
    expect(screen.getByLabelText("Password")).toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.queryByLabelText(/name/i)).toBeNull();
    expect(screen.getByRole("button", { name: "Create account" })).toBeEnabled();
  });
  it("sends the address, the password, the kind of business chosen on step 1 and the acceptance, and goes to 'check your email'", async () => {
    const action = vi.fn(ok);
    render(<SignUpForm words={words} action={action} businessType={THIRD} />);
    fill();
    fireEvent.submit(screen.getByRole("button", { name: "Create account" }).closest("form")!);
    await waitFor(() => expect(push).toHaveBeenCalledWith("/signup/check-email"));
    expect(action).toHaveBeenCalledWith({ email: "asha@example.test", password: "a-long-password-1", businessType: THIRD, acceptTerms: true, marketingOptIn: false });
  });
  it("shows the sentence of an error code, and the generic one for a code it does not know; nothing else happens", async () => {
    const action = vi.fn(async (): Promise<SignUpResult> => ({ ok: false, error: "weak_password" }));
    render(<SignUpForm words={words} action={action} businessType={FIRST} />);
    fill();
    fireEvent.submit(screen.getByRole("button", { name: "Create account" }).closest("form")!);
    expect(await screen.findByRole("alert")).toHaveTextContent("Choose a stronger password.");
    action.mockResolvedValue({ ok: false, error: "something_new" } as unknown as SignUpResult);
    fireEvent.submit(screen.getByRole("button", { name: "Create account" }).closest("form")!);
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Something went wrong."));
    expect(push).not.toHaveBeenCalled();
  });
  it("a server that cannot be reached says so in the generic sentence, and nothing is created", async () => {
    const action = vi.fn(async (): Promise<SignUpResult> => {
      throw new Error("network");
    });
    render(<SignUpForm words={words} action={action} businessType={FIRST} />);
    fill();
    fireEvent.submit(screen.getByRole("button", { name: "Create account" }).closest("form")!);
    expect(await screen.findByRole("alert")).toHaveTextContent("Something went wrong.");
    expect(push).not.toHaveBeenCalled();
  });
  it("the fields carry the password rule of the app (12 to 72 characters) and the right autocomplete", () => {
    render(<SignUpForm words={words} action={ok} businessType={FIRST} />);
    const pw = screen.getByLabelText("Password");
    expect(pw).toHaveAttribute("minlength", "12");
    expect(pw).toHaveAttribute("maxlength", "72");
    expect(pw).toHaveAttribute("autocomplete", "new-password");
    expect(screen.getByLabelText("Email")).toHaveAttribute("type", "email");
  });
  it("sends the Terms and Privacy notice versions the page showed (job CF), or none when the page could not read them", async () => {
    signUp.mockResolvedValue({ ok: true, next: "check-email" });
    const { unmount } = render(<SignUpForm words={words} action={(i) => signUp(i)} businessType={FIRST} policyVersions={{ terms: "2026-11-01", privacy: "2026-10-01" }} />);
    fill();
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));
    await waitFor(() => expect(signUp).toHaveBeenCalled());
    expect(signUp.mock.calls[0][0]).toMatchObject({ acceptTerms: true, policyVersions: { terms: "2026-11-01", privacy: "2026-10-01" } });
    unmount();
    signUp.mockClear();
    render(<SignUpForm words={words} action={(i) => signUp(i)} businessType={FIRST} />);
    fill();
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/signup/check-email"));
    expect("policyVersions" in signUp.mock.calls[0][0]).toBe(false);
  });
});

describe("/signup step 1: what kind of business do you run?", () => {
  it("shows a card for each kind of business as a plain link to step 2, and nothing else to fill in", async () => {
    render(await SignupPage(props()));
    expect(screen.getByRole("heading", { level: 1, name: "What kind of business do you run?" })).toBeInTheDocument();
    expect(screen.getByText("Step 1 of 2")).toBeInTheDocument();
    const cards = screen.getAllByRole("link").filter((a) => a.hasAttribute("data-pack-card"));
    expect(cards.map((a) => a.getAttribute("href"))).toEqual(IDS.map((id) => `/signup?type=${id}`));
    expect(within(cards[1]).getByText(nameOf(SECOND))).toBeInTheDocument();
    expect(within(cards[2]).getByText(SUMMARIES[2].summary.en)).toBeInTheDocument();
    expect(within(cards[1]).getByText("Not validated by a real owner yet")).toBeInTheDocument(); // no real owner of that trade has reviewed it
    expect(within(cards[0]).queryByText("Not validated by a real owner yet")).toBeNull();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/login");
  });
  it("is the first step for a type it does not know (an address is never trusted, never echoed), even a well-formed one the API does not offer", async () => {
    render(await SignupPage(props({ type: "<script>" })));
    expect(screen.getByText("Step 1 of 2")).toBeInTheDocument();
    expect(document.body.innerHTML).not.toContain("<script>");
    cleanup();
    render(await SignupPage(props({ type: "a_type_nobody_offers" })));
    expect(screen.getByText("Step 1 of 2")).toBeInTheDocument();
    expect(document.body.innerHTML).not.toContain("a_type_nobody_offers");
  });
  it("says in one sentence that sign-up is not available when the server cannot list the business types, instead of an empty page", async () => {
    packList.mockRejectedValue(new Error("down"));
    render(await SignupPage(props()));
    expect(screen.getByRole("alert")).toHaveTextContent("Sign-up is not available right now");
    expect(screen.getAllByRole("link").filter((a) => a.hasAttribute("data-pack-card"))).toHaveLength(0);
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/login");
  });
});

describe("/signup step 2: Google, Facebook or e-mail, and the terms line", () => {
  it("names the chosen kind, offers the three ways in, and says 'by continuing you agree' with both links in a new tab", async () => {
    render(await SignupPage(props({ type: SECOND })));
    expect(screen.getByText("Step 2 of 2")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "Create your account" })).toBeInTheDocument();
    expect(document.querySelector("[data-chosen-pack]")).toHaveTextContent(nameOf(SECOND));
    expect(screen.getByRole("link", { name: "Change" })).toHaveAttribute("href", "/signup");
    expect(screen.getByRole("button", { name: "Continue with Google" })).toHaveAttribute("value", "google");
    expect(screen.getByRole("button", { name: "Continue with Facebook" })).toHaveAttribute("value", "facebook");
    expect(screen.getByText("Continue with e-mail")).toBeInTheDocument();
    const hidden = document.querySelector('form input[name="type"]') as HTMLInputElement;
    expect(hidden.value).toBe(SECOND);
    const line = screen.getByText(/By continuing, you agree/).closest("p")!;
    expect(line).toHaveAttribute("lang", "en"); // the terms sentence stays English until a person reviews the translation
    expect(within(line).getByRole("link", { name: /^Terms/ })).toHaveAttribute("href", "/terms");
    expect(within(line).getByRole("link", { name: /^Privacy notice/ })).toHaveAttribute("href", "/privacy");
    for (const a of within(line).getAllByRole("link")) {
      expect(a).toHaveAttribute("target", "_blank");
      expect(a.getAttribute("rel")).toContain("noopener");
    }
    expect(screen.queryByRole("checkbox")).toBeNull();
  });
  it("offers Google and Facebook only when the server says they are on (GET /v1/auth/providers); e-mail is always there", async () => {
    providers.mockResolvedValue({ google: true, facebook: false });
    render(await SignupPage(props({ type: FIRST })));
    expect(screen.getByRole("button", { name: "Continue with Google" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Continue with Facebook" })).toBeNull();
    cleanup();
    providers.mockResolvedValue({ google: false, facebook: false });
    render(await SignupPage(props({ type: FIRST })));
    expect(screen.queryByRole("button", { name: /Continue with (Google|Facebook)/ })).toBeNull();
    expect(document.querySelector('form input[name="type"]')).toBeNull(); // no provider form at all
    expect(screen.getByText("Continue with e-mail")).toBeInTheDocument();
    expect(screen.getByText(/By continuing, you agree/)).toBeInTheDocument();
  });
  it("puts the e-mail form behind the third button (a native disclosure: no script needed) and wires it to the real action", async () => {
    signUp.mockResolvedValue({ ok: true, next: "check-email" });
    render(await SignupPage(props({ type: THIRD })));
    const details = document.querySelector("details[data-signup='email']") as HTMLDetailsElement;
    expect(details).not.toBeNull();
    expect(details.open).toBe(false);
    expect(within(details).getByText("At least 12 characters.")).toBeInTheDocument();
    fill();
    fireEvent.submit(screen.getByRole("button", { name: "Create account" }).closest("form")!);
    await waitFor(() => expect(push).toHaveBeenCalledWith("/signup/check-email"));
    expect(signUp.mock.calls[0][0]).toMatchObject({ businessType: THIRD, acceptTerms: true, policyVersions: { terms: "2026-11-01", privacy: "2026-10-01" } });
  });
  it("knows exactly the four refusals the action can give, and 'email taken' is not one of them", async () => {
    render(await SignupPage(props({ type: FIRST })));
    fill();
    for (const [code, text] of [["weak_password", "Choose a stronger password: at least 12 characters"], ["terms_required", /agree to the Terms/], ["too_many_signups", /Too many tries/], ["invalid", /Check your/]] as const) {
      signUp.mockResolvedValue({ ok: false, error: code });
      fireEvent.submit(screen.getByRole("button", { name: "Create account" }).closest("form")!);
      await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(text));
    }
  });
  it("says in one sentence when a provider is not available yet, and keeps the e-mail way", async () => {
    render(await SignupPage(props({ type: FIRST, error: "provider" })));
    expect(screen.getByRole("alert")).toHaveTextContent("That way of signing in is not available yet");
    expect(screen.getByText("Continue with e-mail")).toBeInTheDocument();
  });
  it("reads the versions in force; when it cannot, the form is still there", async () => {
    render(await SignupPage(props({ type: FIRST })));
    expect(currentPolicies).toHaveBeenCalled();
    cleanup();
    currentPolicies.mockRejectedValue(new Error("down"));
    render(await SignupPage(props({ type: FIRST })));
    expect(screen.getByRole("button", { name: /Create account/i })).toBeInTheDocument();
  });
  it("shows no 'Not available yet' and is wired (the buttons are real submit buttons)", async () => {
    render(await SignupPage(props({ type: FIRST })));
    expect(screen.queryByText(/Not available yet/)).toBeNull();
    for (const name of ["Continue with Google", "Continue with Facebook"]) expect(screen.getByRole("button", { name })).toHaveAttribute("type", "submit");
  });
});

describe("the check-your-email page", () => {
  it("says where to look and names no address", async () => {
    render(await CheckEmailPage());
    expect(screen.getByRole("heading", { level: 1, name: "Check your email" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to sign in" })).toHaveAttribute("href", "/login");
    expect(document.body.textContent).not.toMatch(/@/);
  });
});

describe("the separate marketing box and the consent line (job DQ part 2)", () => {
  afterEach(() => vi.unstubAllEnvs());
  it("under the buttons: 'By continuing, you agree to the Terms and have read the Privacy notice.', both links", async () => {
    render(await SignupPage(props({ type: SECOND })));
    const line = screen.getByText(/By continuing, you agree/).closest("p")!;
    expect(line.textContent).toBe("By continuing, you agree to the Terms (opens in a new tab) and have read the Privacy notice (opens in a new tab).");
    expect(within(line).getAllByRole("link").map((a) => a.getAttribute("href"))).toEqual(["/terms", "/privacy"]);
  });
  it("no marketing box while the consent API is off (the page is as it was)", async () => {
    render(await SignupPage(props({ type: SECOND })));
    expect(screen.queryByRole("checkbox")).toBeNull();
  });
  it("with the consent API on there is ONE box for news and offers: not ticked, not required, separate from the terms line, and it belongs to the provider buttons' form", async () => {
    vi.stubEnv("DPDP_SCREENS", "mock");
    render(await SignupPage(props({ type: SECOND })));
    const box = screen.getByRole("checkbox", { name: /news and offers/i });
    expect(box).not.toBeChecked();
    expect(box).not.toBeRequired();
    expect(box).toHaveAttribute("name", "marketing");
    expect(box).toHaveAttribute("form", "signup-provider-form");
    expect(document.getElementById("signup-provider-form")).not.toBeNull();
    expect(screen.getAllByRole("checkbox")).toHaveLength(1);
    expect(screen.getByText("Also send me news and offers about Stack19 (optional).")).toBeInTheDocument();
    expect(box.closest("p")).toBeNull(); // it is not part of the terms sentence
  });
  it("the e-mail way sends marketingOptIn true only when that box was ticked", async () => {
    vi.stubEnv("DPDP_SCREENS", "mock");
    signUp.mockResolvedValue({ ok: true, next: "check-email" });
    render(await SignupPage(props({ type: THIRD })));
    fill();
    fireEvent.submit(screen.getByRole("button", { name: "Create account" }).closest("form")!);
    await waitFor(() => expect(signUp).toHaveBeenCalledTimes(1));
    expect(signUp.mock.calls[0][0]).toMatchObject({ marketingOptIn: false });
    fireEvent.click(screen.getByRole("checkbox", { name: /news and offers/i }));
    fireEvent.submit(screen.getByRole("button", { name: "Create account" }).closest("form")!);
    await waitFor(() => expect(signUp).toHaveBeenCalledTimes(2));
    expect(signUp.mock.calls[1][0]).toMatchObject({ marketingOptIn: true });
  });
});
