import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("@/design/fonts", () => ({ v2FontClassName: () => "font-vars" }));

import CheckEmailPage from "./check-email/page";
import { SignUpForm, type SignUpWords } from "./sign-up-form";
import SignupPage from "./page";
import type { ActionResult } from "./contract";

const words: SignUpWords = {
  name: "Your name", email: "Email", password: "Password", passwordHint: "At least 12 characters.", business: "Business name", terms: "I accept the terms of use and the privacy notice.",
  submit: "Create account", have: "Already have an account?", signin: "Sign in", notAvailable: "Not available yet.",
  errors: { email_taken: "This email already has an account.", terms: "You need to accept the terms.", unknown: "Something went wrong." },
};
const fill = (accept = true) => {
  fireEvent.change(screen.getByLabelText("Your name"), { target: { value: " Asha " } });
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: "asha@example.test" } });
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: "a-long-password-1" } });
  fireEvent.change(screen.getByLabelText("Business name"), { target: { value: "Asha Silks" } });
  if (accept) fireEvent.click(screen.getByRole("checkbox"));
};

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

describe("SignUpForm", () => {
  it("without the server action it is drawn but cannot be sent, and says 'Not available yet' (it never pretends)", () => {
    render(<SignUpForm words={words} />);
    expect(screen.getByRole("status")).toHaveTextContent("Not available yet.");
    expect(screen.getByRole("button", { name: "Create account" })).toBeDisabled();
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/login");
  });
  it("sends the five inputs of the contract and goes to 'check your email' on success; the terms must be accepted first", async () => {
    const action = vi.fn(async (): Promise<ActionResult> => ({ ok: true }));
    render(<SignUpForm words={words} action={action} />);
    fill(false);
    fireEvent.submit(screen.getByRole("button", { name: "Create account" }).closest("form")!);
    expect(await screen.findByRole("alert")).toHaveTextContent("You need to accept the terms.");
    expect(action).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.submit(screen.getByRole("button", { name: "Create account" }).closest("form")!);
    await waitFor(() => expect(push).toHaveBeenCalledWith("/signup/check-email"));
    expect(action).toHaveBeenCalledWith({ name: "Asha", email: "asha@example.test", password: "a-long-password-1", businessName: "Asha Silks", acceptTerms: true });
  });
  it("shows the sentence of an error code, and the generic one for a code it does not know; nothing else happens", async () => {
    const action = vi.fn(async (): Promise<ActionResult> => ({ ok: false, error: "email_taken" }));
    render(<SignUpForm words={words} action={action} />);
    fill();
    fireEvent.submit(screen.getByRole("button", { name: "Create account" }).closest("form")!);
    expect(await screen.findByRole("alert")).toHaveTextContent("This email already has an account.");
    action.mockResolvedValue({ ok: false, error: "something_new" });
    fireEvent.submit(screen.getByRole("button", { name: "Create account" }).closest("form")!);
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Something went wrong."));
    expect(push).not.toHaveBeenCalled();
  });
  it("the fields carry the password rule of the app (12 to 72 characters) and the right autocomplete", () => {
    render(<SignUpForm words={words} />);
    const pw = screen.getByLabelText("Password");
    expect(pw).toHaveAttribute("minlength", "12");
    expect(pw).toHaveAttribute("maxlength", "72");
    expect(pw).toHaveAttribute("autocomplete", "new-password");
    expect(screen.getByLabelText("Email")).toHaveAttribute("type", "email");
  });
});

describe("the pages", () => {
  it("/signup draws the title, the form and the hint with the minimum length; the terms sentence stays English", async () => {
    render(await SignupPage());
    expect(screen.getByRole("heading", { level: 1, name: "Create your account" })).toBeInTheDocument();
    expect(screen.getByText("At least 12 characters.")).toBeInTheDocument();
    expect(screen.getByText("I accept the terms of use and the privacy notice.")).toHaveAttribute("lang", "en");
    expect(screen.getByRole("status")).toHaveTextContent("Not available yet.");
  });
  it("/signup/check-email says where to look and names no address", async () => {
    render(await CheckEmailPage());
    expect(screen.getByRole("heading", { level: 1, name: "Check your email" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to sign in" })).toHaveAttribute("href", "/login");
    expect(document.body.textContent).not.toMatch(/@/);
  });
});
