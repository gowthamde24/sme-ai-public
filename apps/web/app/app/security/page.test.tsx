import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { redirectMock, redirectTarget } from "@/test/helpers";

const requireUser = vi.fn();
vi.mock("next/navigation", () => ({ redirect: (to: string) => redirectMock(to) }));
vi.mock("@/lib/auth/session", () => ({ requireUser: () => requireUser() }));
vi.mock("./actions", () => ({
  startEnrolment: vi.fn(async () => undefined),
  finishEnrolment: vi.fn(async () => undefined),
  removeAuthenticator: vi.fn(async () => undefined),
}));

import SecurityPage from "./page";

const props = (q: Record<string, string> = {}) =>
  ({ searchParams: Promise.resolve(q) }) as unknown as Parameters<typeof SecurityPage>[0];
const user = (hasSecondFactor: boolean, aal = "aal1") => ({ id: "u", email: "o@example.test", accessToken: "t", aal, hasSecondFactor });

describe("/app/security", () => {
  beforeEach(() => vi.clearAllMocks());

  it("authenticates first", async () => {
    requireUser.mockImplementation(() => redirectMock("/login"));
    expect(await redirectTarget(() => SecurityPage(props()))).toBe("/login");
  });

  it("offers setup to someone with no authenticator, and says who needs one and why", async () => {
    requireUser.mockResolvedValue(user(false));
    render(await SecurityPage(props()));
    expect(screen.getByRole("button", { name: "Set up an authenticator" })).toBeInTheDocument();
    expect(screen.getByText(/Owners and Admins need an authenticator app to erase data, export, change members or roles/)).toBeInTheDocument();
    expect(screen.getByText("password only")).toBeInTheDocument();
  });

  it("shows the state and the removal form (with a code box) when one exists", async () => {
    requireUser.mockResolvedValue(user(true, "aal2"));
    render(await SecurityPage(props()));
    expect(screen.getByText("verified with your authenticator")).toBeInTheDocument();
    expect(screen.getByLabelText(/type a current code/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Set up an authenticator" })).toBeNull();
  });

  it("gives recovery guidance in the page itself", async () => {
    requireUser.mockResolvedValue(user(true, "aal2"));
    render(await SecurityPage(props()));
    expect(screen.getByRole("heading", { name: "If you lose your phone" })).toBeInTheDocument();
    expect(screen.getByText(/There are no backup codes. Ask the operator/)).toBeInTheDocument();
  });

  it("confirms what just happened", async () => {
    requireUser.mockResolvedValue(user(true, "aal2"));
    render(await SecurityPage(props({ done: "1" })));
    expect(screen.getByRole("status")).toHaveTextContent(/authenticator is on/i);
  });
});
