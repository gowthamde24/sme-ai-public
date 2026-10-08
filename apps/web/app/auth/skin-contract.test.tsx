// The skin contract of Stage 3: the five sign-in and account PAGES, rendered the way the existing page tests render them
// (direct call, no frame: the frame is a route layout), keep every word, field attribute, hidden field and role that the
// server actions, the existing tests and e2e/auth.mjs depend on. Written first and green on the unchanged screens; it must
// stay green after every skin commit. Only markup facts are pinned here, never behaviour (that is the actions' tests).
import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { redirectMock } from "@/test/helpers";

const requireBefore = vi.fn();
const requireUser = vi.fn();
vi.mock("next/navigation", () => ({ redirect: (to: string) => redirectMock(to) }));
vi.mock("@/lib/auth/session", () => ({ requireUserBeforeSecondFactor: () => requireBefore(), requireUser: () => requireUser() }));
vi.mock("@/app/login/actions", () => ({ signIn: vi.fn(async () => undefined) }));
vi.mock("@/app/auth/forgot/actions", () => ({ requestPasswordReset: vi.fn(async () => undefined) }));
vi.mock("@/app/auth/confirm/actions", () => ({ confirmLink: vi.fn(async () => undefined) }));
vi.mock("@/app/auth/mfa/actions", () => ({ verifyCode: vi.fn(async () => undefined), leaveChallenge: vi.fn(async () => undefined) }));
vi.mock("@/app/auth/set-password/actions", () => ({ setPassword: vi.fn(async () => undefined) }));

import ConfirmPage from "@/app/auth/confirm/page";
import ForgotPage from "@/app/auth/forgot/page";
import MfaPage from "@/app/auth/mfa/page";
import SetPasswordPage from "@/app/auth/set-password/page";
import LoginPage from "@/app/login/page";
import { MAX_PASSWORD, MIN_PASSWORD } from "@/lib/auth/password-policy";

const TOKEN = "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6";
const q = <T extends (p: never) => unknown>(query: Record<string, string>) => ({ searchParams: Promise.resolve(query) }) as unknown as Parameters<T>[0];

beforeEach(() => {
  vi.clearAllMocks();
  requireBefore.mockResolvedValue({ aal: "aal1", hasSecondFactor: true });
  requireUser.mockResolvedValue({ aal: "aal1" });
});

/** The attributes the contract pins on one field. */
function field(root: HTMLElement, selector: string) {
  const el = root.querySelector(selector) as HTMLInputElement | null;
  expect(el, selector).not.toBeNull();
  return el!;
}
const attrs = (el: Element, names: string[]) => Object.fromEntries(names.map((n) => [n, el.getAttribute(n)]));
const text = (root: HTMLElement) => (root.textContent ?? "").replace(/\s+/g, " ").trim();
const labelOf = (root: HTMLElement, id: string) => (root.querySelector(`label[for="${id}"]`)?.textContent ?? "").trim();

function structure(root: HTMLElement) {
  expect(root.querySelectorAll("h1")).toHaveLength(1);
  expect(root.querySelectorAll("main")).toHaveLength(1);
  const main = root.querySelector("main")!;
  expect(main.querySelector("h1")).not.toBeNull();
  expect(main.querySelector("form")).not.toBeNull();
}

describe("/login", () => {
  it("words, fields, hidden next, notice, the one reset link", async () => {
    const { container } = render(await LoginPage(q<typeof LoginPage>({ next: "/app/x", notice: "reset" })));
    structure(container);
    expect(container.querySelector("h1")!.textContent).toBe("Sign in");
    expect(container.querySelector('input[name="next"]')).toHaveProperty("value", "/app/x");
    expect(container.querySelector('input[name="next"]')!.getAttribute("type")).toBe("hidden");
    expect(labelOf(container, "email")).toBe("Email");
    expect(attrs(field(container, "input#email"), ["name", "type", "autocomplete", "maxlength"])).toEqual({ name: "email", type: "email", autocomplete: "email", maxlength: "254" });
    expect(field(container, "input#email").hasAttribute("required")).toBe(true);
    expect(labelOf(container, "password")).toBe("Password");
    expect(attrs(field(container, "input#password"), ["name", "type", "autocomplete", "maxlength"])).toEqual({ name: "password", type: "password", autocomplete: "current-password", maxlength: "72" });
    expect(field(container, "input#password").hasAttribute("required")).toBe(true);
    const submit = container.querySelector('button[type="submit"]')!;
    expect(submit.textContent).toBe("Sign in");
    expect(container.querySelectorAll('a[href="/auth/forgot"]')).toHaveLength(1);
    expect(container.querySelector('a[href="/auth/forgot"]')!.textContent).toBe("Forgot your password?");
    expect(text(container)).toContain("Accounts are by invitation. Ask the owner of your workspace if you need one.");
    const status = container.querySelector('form [role="status"]')!;
    expect(status.textContent).toBe("Your password was changed. Sign in with the new one.");
  });
  it("the other notice, no notice, and a next that is not ours becomes /app", async () => {
    const link = render(await LoginPage(q<typeof LoginPage>({ notice: "link", next: "//evil.example" }))).container;
    expect(link.querySelector('form [role="status"]')!.textContent).toBe("That link has expired or was already used. Request a new one from \"Forgot your password?\".");
    expect(link.querySelector('input[name="next"]')).toHaveProperty("value", "/app");
    const none = render(await LoginPage(q<typeof LoginPage>({}))).container;
    expect(none.querySelector('[role="status"]')).toBeNull();
  });
});

describe("/auth/forgot", () => {
  it("words, the email field, the button, the way back", () => {
    const { container } = render(<>{ForgotPage()}</>);
    structure(container);
    expect(container.querySelector("h1")!.textContent).toBe("Reset your password");
    expect(text(container)).toContain("Enter the email address of your account. If it has one, we send a link that lets you choose a new password.");
    expect(labelOf(container, "email")).toBe("Email");
    expect(attrs(field(container, "input#email"), ["name", "type", "autocomplete", "maxlength"])).toEqual({ name: "email", type: "email", autocomplete: "email", maxlength: "254" });
    expect(field(container, "input#email").hasAttribute("required")).toBe(true);
    expect(container.querySelector('button[type="submit"]')!.textContent).toBe("Send the link");
    const back = container.querySelector('a[href="/login"]')!;
    expect(back.textContent).toBe("Back to sign in");
  });
});

describe("/auth/confirm", () => {
  it.each([
    ["invite", "You are invited", "Press Continue, then choose a password for your account."],
    ["recovery", "Reset your password", "Press Continue, then choose a password for your account."],
    ["email", "Confirm your email", "Press Continue to confirm your email address."],
  ])("the form state for %s", async (type, heading, sentence) => {
    const { container } = render(await ConfirmPage(q<typeof ConfirmPage>({ token_hash: TOKEN, type, next: "/app/x" })));
    structure(container);
    expect(container.querySelector("h1")!.textContent).toBe(heading);
    expect(text(container)).toContain(sentence);
    expect(container.querySelector('button[type="submit"]')!.textContent).toBe("Continue");
    expect(container.querySelector('input[name="token_hash"]')).toHaveProperty("value", TOKEN);
    expect(container.querySelector('input[name="type"]')).toHaveProperty("value", type);
    expect(container.querySelector('input[name="next"]')).toHaveProperty("value", "/app/x");
    for (const n of ["token_hash", "type", "next"]) expect(container.querySelector(`input[name="${n}"]`)!.getAttribute("type")).toBe("hidden");
  });
  it("the error state: heading, alert, two ways out, no form and no Continue button", async () => {
    const { container } = render(await ConfirmPage(q<typeof ConfirmPage>({})));
    expect(container.querySelectorAll("h1")).toHaveLength(1);
    expect(container.querySelectorAll("main")).toHaveLength(1);
    expect(container.querySelector("h1")!.textContent).toBe("This link does not work");
    expect(container.querySelector('[role="alert"]')!.textContent).toBe("This link has expired or was already used. Request a new one.");
    expect(container.querySelector("button")).toBeNull();
    expect(container.querySelector('a[href="/auth/forgot"]')!.textContent).toBe("Reset your password");
    expect(container.querySelector('a[href="/login"]')!.textContent).toBe("Sign in");
  });
});

describe("/auth/mfa", () => {
  it("words, the code field and its attributes, the hidden next, two separate forms", async () => {
    const { container } = render(await MfaPage(q<typeof MfaPage>({ next: "/app/tenants/1" })));
    expect(container.querySelectorAll("h1")).toHaveLength(1);
    expect(container.querySelectorAll("main")).toHaveLength(1);
    expect(container.querySelector("h1")!.textContent).toBe("Enter your code");
    expect(text(container)).toContain("Open your authenticator app and type the six digits it shows for this account.");
    expect(container.querySelector('input[name="next"]')).toHaveProperty("value", "/app/tenants/1");
    expect(labelOf(container, "code")).toBe("Code from your authenticator app");
    const code = field(container, "input#code");
    expect(attrs(code, ["name", "inputmode", "autocomplete", "pattern", "maxlength"])).toEqual({ name: "code", inputmode: "numeric", autocomplete: "one-time-code", pattern: "[0-9 ]*", maxlength: "7" });
    expect(code.hasAttribute("required")).toBe(true);
    expect(document.activeElement).toBe(code); // autoFocus
    const forms = container.querySelectorAll("form");
    expect(forms).toHaveLength(2);
    expect(forms[0].querySelector('button[type="submit"]')!.textContent).toBe("Verify");
    expect(forms[1].querySelector('button[type="submit"]')!.textContent).toBe("Sign out");
    expect(text(container)).toContain("Lost your phone? Ask the operator of this system.");
    expect(text(container)).toContain("Until then you can sign in, but not erase data, export, or change members and settings.");
  });
});

describe("/auth/set-password", () => {
  it.each([
    [{ type: "invite" }, "Welcome: choose a password"],
    [{}, "Choose a new password"],
  ])("heading for %j", async (query, heading) => {
    const { container } = render(await SetPasswordPage(q<typeof SetPasswordPage>(query)));
    structure(container);
    expect(container.querySelector("h1")!.textContent).toBe(heading);
  });
  it("two password fields with the policy's limits, the hint and the button", async () => {
    const { container } = render(await SetPasswordPage(q<typeof SetPasswordPage>({})));
    expect(labelOf(container, "password")).toBe("New password");
    expect(attrs(field(container, "input#password"), ["name", "type", "autocomplete", "minlength", "maxlength"])).toEqual({ name: "password", type: "password", autocomplete: "new-password", minlength: String(MIN_PASSWORD), maxlength: String(MAX_PASSWORD) });
    expect(field(container, "input#password").hasAttribute("required")).toBe(true);
    expect(labelOf(container, "confirm")).toBe("Type it again");
    expect(attrs(field(container, "input#confirm"), ["name", "type", "autocomplete", "maxlength"])).toEqual({ name: "confirm", type: "password", autocomplete: "new-password", maxlength: String(MAX_PASSWORD) });
    expect(field(container, "input#confirm").hasAttribute("required")).toBe(true);
    expect(text(container)).toContain(`At least ${MIN_PASSWORD} characters. A few words in a row work well.`);
    expect(container.querySelector('button[type="submit"]')!.textContent).toBe("Save password");
  });
});
