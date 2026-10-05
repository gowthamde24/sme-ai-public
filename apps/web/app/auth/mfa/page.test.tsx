import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { redirectMock, redirectTarget } from "@/test/helpers";

const requireBefore = vi.fn();
vi.mock("next/navigation", () => ({ redirect: (to: string) => redirectMock(to) }));
vi.mock("@/lib/auth/session", () => ({ requireUserBeforeSecondFactor: () => requireBefore() }));
vi.mock("./actions", () => ({ verifyCode: vi.fn(async () => undefined), leaveChallenge: vi.fn(async () => undefined) }));

import MfaPage from "./page";

const props = (q: Record<string, string> = {}) =>
  ({ searchParams: Promise.resolve(q) }) as unknown as Parameters<typeof MfaPage>[0];

describe("/auth/mfa", () => {
  beforeEach(() => vi.clearAllMocks());

  it("asks for the code, tells a person who lost their phone what to do, and keeps a validated next", async () => {
    requireBefore.mockResolvedValue({ aal: "aal1", hasSecondFactor: true });
    render(await MfaPage(props({ next: "/app/tenants/1" })));
    expect(screen.getByLabelText(/code from your authenticator/i)).toHaveAttribute("autocomplete", "one-time-code");
    expect((document.querySelector('input[name="next"]') as HTMLInputElement).value).toBe("/app/tenants/1");
    expect(screen.getByText(/Lost your phone\? Ask the operator/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign out" })).toBeInTheDocument();
  });

  it("never carries an untrusted next", async () => {
    requireBefore.mockResolvedValue({ aal: "aal1", hasSecondFactor: true });
    render(await MfaPage(props({ next: "//evil.example" })));
    expect((document.querySelector('input[name="next"]') as HTMLInputElement).value).toBe("/app");
  });

  it("an aal2 session has nothing to do here, a person with no authenticator goes to set one up", async () => {
    requireBefore.mockResolvedValue({ aal: "aal2", hasSecondFactor: true });
    expect(await redirectTarget(() => MfaPage(props({ next: "/app/x" })))).toBe("/app/x");
    requireBefore.mockResolvedValue({ aal: "aal1", hasSecondFactor: false });
    expect(await redirectTarget(() => MfaPage(props()))).toBe("/app/security");
  });

  it("without a session the gate sends the visitor to sign in", async () => {
    requireBefore.mockImplementation(() => redirectMock("/login"));
    expect(await redirectTarget(() => MfaPage(props()))).toBe("/login");
  });
});
