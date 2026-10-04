import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import Home from "./page";

describe("Home", () => {
  it("renders the product heading", () => {
    render(<Home />);
    expect(
      screen.getByRole("heading", { name: "SME AI Revenue Engine" }),
    ).toBeInTheDocument();
  });

  it("makes no business-feature claims yet", () => {
    render(<Home />);
    expect(screen.getByText(/No business features yet/)).toBeInTheDocument();
  });
});
