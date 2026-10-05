import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("./actions", () => ({ confirmLink: vi.fn(async () => undefined) }));

import ConfirmPage from "./page";

const TOKEN = "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6";
const props = (q: Record<string, string | undefined>) =>
  ({ searchParams: Promise.resolve(q) }) as unknown as Parameters<typeof ConfirmPage>[0];

describe("/auth/confirm", () => {
  it("shows a button and verifies nothing on load (a link scanner must not use the token up)", async () => {
    render(await ConfirmPage(props({ token_hash: TOKEN, type: "invite" })));
    expect(screen.getByRole("heading", { name: "You are invited" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continue" })).toBeInTheDocument();
    expect((document.querySelector('input[name="token_hash"]') as HTMLInputElement).value).toBe(TOKEN);
  });

  it("carries only a same-site next into the form", async () => {
    render(await ConfirmPage(props({ token_hash: TOKEN, type: "email", next: "//evil.example" })));
    expect((document.querySelector('input[name="next"]') as HTMLInputElement).value).toBe("/app");
  });

  it.each([{}, { type: "invite" }, { token_hash: TOKEN }, { token_hash: TOKEN, type: "signup" }, { token_hash: "x y", type: "invite" }])(
    "a link that is not one of ours (%j) says so and offers a way out",
    async (q) => {
      render(await ConfirmPage(props(q)));
      expect(screen.getByRole("alert")).toHaveTextContent(/expired or was already used/);
      expect(screen.queryByRole("button", { name: "Continue" })).toBeNull();
      expect(screen.getByRole("link", { name: "Reset your password" })).toHaveAttribute("href", "/auth/forgot");
    },
  );
});
