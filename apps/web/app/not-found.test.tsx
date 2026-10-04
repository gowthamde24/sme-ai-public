import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import NotFound from "./not-found";

describe("not-found page", () => {
  it("is generic: says nothing about workspaces, ids or permissions", () => {
    const { container } = render(<NotFound />);
    expect(
      screen.getByRole("heading", { name: "Not found" }),
    ).toBeInTheDocument();
    expect(container.textContent).not.toMatch(
      /permission|member|forbidden|exist|tenant|workspace id/i,
    );
    expect(
      screen.getByRole("link", { name: /back to your workspaces/i }),
    ).toHaveAttribute("href", "/app");
  });
});
