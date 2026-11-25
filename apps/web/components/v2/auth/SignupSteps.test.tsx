import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { signupT } from "@/i18n/signup";
import type { Step } from "@/lib/api/signup-open";

import { SignupSteps } from "./SignupSteps";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));
afterEach(() => {
  cleanup();
  refresh.mockClear();
});

const t = signupT("en");
const KEYS = ["su.terms", "su.privacy", "su.read.terms", "su.read.privacy", "su.agree", "su.phone.l", "su.phone.h", "su.phone.send", "su.code.sent", "su.code.l", "su.code.verify", "su.code.resend", "su.err.code_wrong", "su.err.rate_limited", "su.err.unavailable"] as const;
const words = Object.fromEntries(KEYS.map((k) => [k, t(k)]));
const ok = async (): Promise<Step> => ({ ok: true });
const props = { words, versions: { terms: "2026-11-26", privacy: "2026-11-26" }, links: { terms: "/terms", privacy: "/privacy" } };

describe("opening sign-up: the checks", () => {
  it("consent: two ticks, each with the version in force; the button waits for both; then the page is read again", async () => {
    const consent = vi.fn(ok);
    render(<SignupSteps {...props} step="consent" actions={{ consent, start: ok, verify: ok }} />);
    expect(screen.getByText(/Terms of Use \(version 2026-11-26\)/)).toBeInTheDocument();
    const agree = screen.getByRole("button", { name: "Agree and continue" });
    expect(agree).toBeDisabled();
    fireEvent.click(screen.getByLabelText(/Terms of Use/));
    expect(agree).toBeDisabled();
    fireEvent.click(screen.getByLabelText(/Privacy Policy/));
    fireEvent.click(agree);
    await waitFor(() => expect(consent).toHaveBeenCalledWith({ terms: true, privacy: true }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });
  it("phone: send the code, then the 6 digits; a wrong code is one plain sentence and nothing moves on", async () => {
    const start = vi.fn(ok);
    const verify = vi.fn(async (): Promise<Step> => ({ ok: false, reason: "code_wrong" }));
    render(<SignupSteps {...props} step="phone" actions={{ consent: ok, start, verify }} />);
    fireEvent.change(screen.getByLabelText("Mobile number"), { target: { value: "98480 12345" } });
    fireEvent.click(screen.getByRole("button", { name: "Send the code" }));
    await waitFor(() => expect(start).toHaveBeenCalledWith("98480 12345"));
    expect(await screen.findByText("We sent a code. It works for 10 minutes.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Check the code" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("The 6-digit code"), { target: { value: "12a3456" } });
    fireEvent.click(screen.getByRole("button", { name: "Check the code" }));
    await waitFor(() => expect(verify).toHaveBeenCalledWith("123456"));
    expect(await screen.findByRole("alert")).toHaveTextContent("That code is not right");
    expect(refresh).not.toHaveBeenCalled();
  });
  it("a refusal of the number is drawn in plain words", async () => {
    render(<SignupSteps {...props} step="phone" actions={{ consent: ok, start: async () => ({ ok: false, reason: "rate_limited" }), verify: ok }} />);
    fireEvent.change(screen.getByLabelText("Mobile number"), { target: { value: "9848012345" } });
    fireEvent.click(screen.getByRole("button", { name: "Send the code" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Too many tries");
  });
});
