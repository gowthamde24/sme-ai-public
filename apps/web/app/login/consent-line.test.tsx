import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./actions", () => ({ signIn: vi.fn() }));
vi.mock("@/design/fonts", () => ({ v2FontClassName: () => "font-vars" }));

import LoginPage from "./page";

afterEach(cleanup);

describe("the consent line under the sign-in form (job DQ part 2)", () => {
  it("is the same sentence as the sign-up's, with both links in a new tab", async () => {
    render(await LoginPage({ searchParams: Promise.resolve({}) } as never));
    const line = document.querySelector('[data-part="terms-line"]') as HTMLElement;
    expect(line.textContent).toBe("By continuing, you agree to the Terms (opens in a new tab) and have read the Privacy notice (opens in a new tab).");
    expect(within(line).getByRole("link", { name: /^Terms/ })).toHaveAttribute("href", "/terms");
    expect(within(line).getByRole("link", { name: /^Privacy notice/ })).toHaveAttribute("href", "/privacy");
    for (const a of within(line).getAllByRole("link")) expect(a).toHaveAttribute("target", "_blank");
    expect(screen.queryByRole("checkbox")).toBeNull(); // signing in asks for no tick
  });
});
