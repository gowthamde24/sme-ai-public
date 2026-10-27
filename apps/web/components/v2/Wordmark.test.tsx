import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/design/brand", () => ({ BRAND_NAME: "Rename Test", BRAND_TEXT: "Rename Test" }));

import { Wordmark } from "@/components/v2/Wordmark";

describe("Wordmark", () => {
  it("renders the name from the one constant, beside the three-bar logo (decorative)", () => {
    const { container } = render(<Wordmark />);
    expect(screen.getByText("Rename Test").textContent).toBe("Rename Test");
    const mark = container.querySelector("[data-mark]");
    expect(mark?.getAttribute("aria-hidden")).toBe("true");
    expect(mark?.querySelectorAll("rect")).toHaveLength(3);
    expect(container.querySelector("[data-orb]")).toBeNull(); // the circle is Vijaya's, not the logo
    expect(document.body.textContent).not.toMatch(/sme-?ai|working name/i);
  });
});
