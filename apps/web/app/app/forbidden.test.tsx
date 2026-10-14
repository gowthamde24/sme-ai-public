import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const headerValue = vi.fn();
vi.mock("next/headers", () => ({ headers: async () => ({ get: () => headerValue() }), cookies: async () => ({ get: () => undefined }) }));

import Forbidden from "./forbidden";

const T = "22222222-2222-2222-2222-222222222222";

describe("the 403 page of a part the business type does not have", () => {
  it("says the part is not switched on, in one closed sentence, and goes back to Today of THIS workspace", async () => {
    headerValue.mockReturnValue(`/app/tenants/${T}/orders/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa`);
    const { container } = render(await Forbidden());
    expect(container.querySelector("[data-problem='403']")).not.toBeNull();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("This part is not switched on");
    expect(screen.getByText(/does not use this part of the app/)).toBeInTheDocument();
    expect(screen.getByRole("link")).toHaveAttribute("href", `/app/tenants/${T}`);
    // it says nothing about which module, which business type, or what is behind the address
    expect(container.textContent).not.toMatch(/orders|construction|education|textiles/i);
  });
  it("falls back to the list of workspaces when the path is unknown", async () => {
    headerValue.mockReturnValue(null);
    render(await Forbidden());
    expect(screen.getByRole("link")).toHaveAttribute("href", "/app");
  });
});
