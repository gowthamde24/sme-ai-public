import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { signupCards } from "@/lib/packs/signup";

import { PackCard } from "./PackCard";

describe("a kind of business on the first sign-up step", () => {
  it("is a link to step 2 with the name, the line, the plush owl and the trade's prop in the pack's colour; the hint is only for a screen reader", () => {
    const card = signupCards("en")[1];
    const { container } = render(<PackCard card={card} href={`/signup?type=${card.id}`} hint="Choose Construction materials" />);
    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", `/signup?type=${card.id}`);
    expect(link).toHaveAttribute("data-pack-card", card.id);
    expect(link).toHaveTextContent("Construction materials");
    expect(link).toHaveTextContent("Paver blocks, bricks, tiles, cement, sand and aggregate sellers");
    expect(container.querySelector("img[data-plush-avatar]")).not.toBeNull();
    expect(container.querySelector("[data-accent='terracotta'] svg")).not.toBeNull();
    expect(container.querySelector(".sr-only")).toHaveTextContent("Choose Construction materials");
    expect(link.className).toContain("min-h-24"); // a big target: 96 px
  });
  it("draws each trade's own prop", () => {
    const icons = signupCards("en").map((c) => {
      const { container, unmount } = render(<PackCard card={c} href="/x" hint="h" />);
      const svg = container.querySelector("[data-accent] svg")!.getAttribute("class");
      unmount();
      return svg;
    });
    expect(icons.every((c) => c?.includes("lucide"))).toBe(true);
    expect(new Set(icons).size).toBe(3);
  });
});
