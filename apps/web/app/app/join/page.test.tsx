import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const requireUser = vi.fn(async () => ({ id: "u", email: "e@example.test", accessToken: "tok" }));
vi.mock("@/lib/auth/session", () => ({ requireUser: () => requireUser() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));
vi.mock("./actions", () => ({ acceptInvitationAction: vi.fn() }));

import JoinPage, { metadata } from "./page";

describe("/app/join", () => {
  it("asks for the code and says nothing else", async () => {
    render(await JoinPage());
    expect(screen.getByRole("heading", { level: 1, name: "Join a business" })).toBeInTheDocument();
    expect(screen.getByLabelText("Invitation code")).toBeInTheDocument();
    expect(requireUser).toHaveBeenCalled();
  });
  it("asks the browser to send no Referer from this page", () => {
    expect(metadata.referrer).toBe("no-referrer");
  });
});
