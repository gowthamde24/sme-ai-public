import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { parsePackSummary } from "@/lib/api/pack";
import { packsWire } from "@/lib/packs/pack-test-kit";
import { signupCards } from "@/lib/packs/signup";

import { PackCard } from "./PackCard";

const cards = signupCards(packsWire().packs.map(parsePackSummary), "en");

describe("a kind of business on the first sign-up step", () => {
  it("is a link to step 2 with the name, the line, the plush owl and the trade's prop in the pack's colour; the hint is only for a screen reader", () => {
    const card = cards.find((c) => !c.validated)!;
    const { container } = render(<PackCard card={card} href={`/signup?type=${card.id}`} hint={`Choose ${card.name}`} notValidated="Not validated by a real owner yet" />);
    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", `/signup?type=${card.id}`);
    expect(link).toHaveAttribute("data-pack-card", card.id);
    expect(link).toHaveTextContent(card.name);
    expect(link).toHaveTextContent(card.tagline);
    expect(container.querySelector("img[data-plush-avatar]")).not.toBeNull();
    expect(container.querySelector(`[data-accent='${card.accent}'] svg`)).not.toBeNull();
    expect(container.querySelector(".sr-only")).toHaveTextContent(`Choose ${card.name}`);
    expect(link.className).toContain("min-h-24"); // a big target: 96 px
  });
  it("says so when no real owner of that trade has reviewed the type yet, and says nothing for a reviewed one", () => {
    const unreviewed = cards.find((c) => !c.validated)!;
    const reviewed = cards.find((c) => c.validated)!;
    const { unmount } = render(<PackCard card={unreviewed} href="/x" hint="h" notValidated="Not validated by a real owner yet" />);
    expect(screen.getByText("Not validated by a real owner yet")).toBeInTheDocument();
    unmount();
    render(<PackCard card={reviewed} href="/x" hint="h" notValidated="Not validated by a real owner yet" />);
    expect(screen.queryByText("Not validated by a real owner yet")).toBeNull();
  });
  it("draws each trade's own prop, and a neutral one for a prop it has no art for", () => {
    const icons = cards.map((c) => {
      const { container, unmount } = render(<PackCard card={c} href="/x" hint="h" />);
      const svg = container.querySelector("[data-accent] svg")!.getAttribute("class");
      unmount();
      return svg;
    });
    expect(icons.every((c) => c?.includes("lucide"))).toBe(true);
    expect(new Set(icons).size).toBe(cards.length);
    const { container } = render(<PackCard card={{ ...cards[0], owlProp: "a_prop_nobody_drew" }} href="/x" hint="h" />);
    expect(container.querySelector("[data-accent] svg")!.getAttribute("class")).toContain("lucide-store");
  });
});
