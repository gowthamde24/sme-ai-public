import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { TeamIllustration } from "@/components/v2/landing/TeamIllustration";

describe("TeamIllustration", () => {
  it("is one labelled image with seven assistants and no data", () => {
    const { container } = render(<TeamIllustration alt="Seven assistants around a table" />);
    expect(screen.getByRole("img", { name: "Seven assistants around a table" })).toBeTruthy();
    expect(container.querySelectorAll("circle[r='15']").length).toBe(7);
    expect(container.textContent).toBe("");
  });
});
