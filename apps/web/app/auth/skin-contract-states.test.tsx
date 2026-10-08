// The skin contract, form states: with the form's action state forced to an error, a message and "pending" (React's
// useActionState replaced by a fixed answer in THIS file only), the messages stay inside the <form> with their roles
// (e2e/auth.mjs reads `form [role="status"], form [role="alert"]`) and the pending words stay as they are.
import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

let answer: [unknown, () => void, boolean] = [undefined, () => undefined, false];
vi.mock("react", async (original) => ({ ...(await original<typeof import("react")>()), useActionState: () => answer }));
vi.mock("@/app/login/actions", () => ({ signIn: vi.fn() }));
vi.mock("@/app/auth/forgot/actions", () => ({ requestPasswordReset: vi.fn() }));
vi.mock("@/app/auth/confirm/actions", () => ({ confirmLink: vi.fn() }));
vi.mock("@/app/auth/mfa/actions", () => ({ verifyCode: vi.fn(), leaveChallenge: vi.fn() }));
vi.mock("@/app/auth/set-password/actions", () => ({ setPassword: vi.fn() }));

import { ConfirmForm } from "@/app/auth/confirm/confirm-form";
import { ForgotForm } from "@/app/auth/forgot/forgot-form";
import { MfaForm } from "@/app/auth/mfa/mfa-form";
import { SetPasswordForm } from "@/app/auth/set-password/set-password-form";
import { LoginForm } from "@/app/login/login-form";

const forms = {
  login: () => <LoginForm next="/app" />,
  forgot: () => <ForgotForm />,
  confirm: () => <ConfirmForm tokenHash="a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6" type="invite" next="/app" />,
  mfa: () => <MfaForm next="/app" />,
  setPassword: () => <SetPasswordForm />,
};

describe("messages stay inside the form with their roles", () => {
  it.each(Object.entries(forms))("%s: an error is a role=alert inside the first form", (_name, make) => {
    answer = [{ error: "Something specific went wrong." }, () => undefined, false];
    const { container } = render(make());
    const alert = container.querySelector('form [role="alert"]');
    expect(alert?.textContent).toBe("Something specific went wrong.");
    expect(container.querySelector('[role="alert"]')!.closest("form")).toBe(container.querySelector("form"));
  });
  it.each([["forgot", forms.forgot]])("%s: a message is a role=status inside the form", (_name, make) => {
    answer = [{ message: "Check your inbox." }, () => undefined, false];
    const { container } = render(make());
    expect(container.querySelector('form [role="status"]')?.textContent).toBe("Check your inbox.");
  });
});

describe("pending words and the disabled button", () => {
  it.each([
    ["login", forms.login, "Sign in"],
    ["forgot", forms.forgot, "Sending..."],
    ["confirm", forms.confirm, "Continue"],
    ["mfa", forms.mfa, "Checking..."],
    ["setPassword", forms.setPassword, "Saving..."],
  ])("%s: while pending the submit button says %s and is disabled", (_name, make, word) => {
    answer = [undefined, () => undefined, true];
    const { container } = render(make());
    const button = container.querySelector('button[type="submit"]') as HTMLButtonElement;
    expect(button.textContent).toBe(word);
    expect(button.disabled).toBe(true);
  });
  it("when idle the buttons are enabled", () => {
    answer = [undefined, () => undefined, false];
    for (const make of Object.values(forms)) {
      const { container, unmount } = render(make());
      expect((container.querySelector('button[type="submit"]') as HTMLButtonElement).disabled).toBe(false);
      unmount();
    }
  });
});
