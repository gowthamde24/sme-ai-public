import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ConsentChip } from "./ConsentChip";

const props = { state: "granted" as const, label: "Said yes to offers", how: "How: 12 Nov · Ravi · told us in the shop", hint: "Offers: tap to see how it was given" };

describe("the consent chip", () => {
  it("shows the state, how it was given on hover (title), and the same line after a tap", () => {
    render(<ConsentChip {...props} />);
    const chip = screen.getByRole("button", { name: /Said yes to offers/ });
    expect(chip).toHaveAttribute("title", props.how);
    expect(screen.queryByRole("status")).toBeNull();
    fireEvent.click(chip);
    expect(screen.getByRole("status")).toHaveTextContent("told us in the shop");
    expect(chip).toHaveAttribute("aria-expanded", "true");
  });
  it("marks the state for the three kinds", () => {
    const { container } = render(<ConsentChip {...props} state="withdrawn" label="Said no to offers" />);
    expect(container.querySelector('[data-state="withdrawn"]')).not.toBeNull();
  });
});
