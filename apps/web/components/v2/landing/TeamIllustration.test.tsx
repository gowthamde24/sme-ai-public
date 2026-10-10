import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { OWL_PALETTE } from "@/components/v2/app/owl/owl-colors";
import { TeamIllustration } from "@/components/v2/landing/TeamIllustration";

describe("TeamIllustration", () => {
  it("is one labelled image with seven owls, each in its own agent's colour, and no data", () => {
    const { container } = render(<TeamIllustration alt="Seven owls around a table" />);
    expect(screen.getByRole("img", { name: "Seven owls around a table" })).toBeTruthy();
    const owls = [...container.querySelectorAll("svg.owl")];
    expect(owls).toHaveLength(7);
    expect(owls.map((o) => o.getAttribute("data-owl"))).toEqual(Object.keys(OWL_PALETTE));
    expect(owls.every((o) => o.getAttribute("data-still") === "true")).toBe(true);
    expect(owls.map((o) => (o.querySelector(":scope > g") as SVGElement).style.getPropertyValue("--owl-cap"))).toEqual(Object.values(OWL_PALETTE).map((p) => p.cap));
    expect(container.textContent).toBe("");
  });
  it("draws no person: no skin tone, no hair", () => {
    const { container } = render(<TeamIllustration alt="x" />);
    expect(container.innerHTML).not.toMatch(/#(b07a58|c98e66|f0c8a6|6a4330|e2b08a|8a5a3e|d6a07a)/i);
  });
});
