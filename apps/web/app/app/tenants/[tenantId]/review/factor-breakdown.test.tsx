import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { FactorBreakdown, parseFactors } from "./factor-breakdown";

// the shape the API really sends (taken from a live /leads/review-queue response)
const LIST = [
  { id: "silk_saree_fit", points: 20, unknown: false, max_points: 25 },
  { id: "buyer_type_fit", points: 0, unknown: true, max_points: 20 },
  { id: "geography_fit", points: 12, unknown: false, max_points: 20 },
];

describe("FactorBreakdown", () => {
  it("draws the list the API sends, one plain-language line per factor", () => {
    render(<FactorBreakdown factors={LIST} flags={["no_evidence"]} maxReachable={65} />);
    expect(screen.getByText(/How this score was worked out/)).toBeInTheDocument();
    expect(screen.getByText(/highest possible with what we know: 65 of 100/)).toBeInTheDocument();
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(3);
    expect(items[0]).toHaveTextContent("Sells silk sarees: 20 of 25 points");
    expect(items[2]).toHaveTextContent("Location: 12 of 20 points");
  });

  it("says 'not known yet' for an unknown factor, and explains that it is not a bad mark", () => {
    render(<FactorBreakdown factors={LIST} maxReachable={65} />);
    const unknown = document.querySelector('[data-unknown="true"]');
    expect(unknown).toHaveTextContent("Type of buyer: not known yet");
    expect(unknown).toHaveTextContent("0 of 20 for now");
    expect(screen.getByText(/is not a bad mark/)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/unknown/i);
  });

  it("turns flags into words and keeps unknown flags readable", () => {
    render(<FactorBreakdown factors={LIST} flags={["no_evidence", "some_new_flag"]} maxReachable={null} />);
    expect(screen.getByText(/No evidence attached yet; some new flag/)).toBeInTheDocument();
    expect(screen.queryByText(/highest possible/)).toBeNull();
  });

  it("still draws the older map shape", () => {
    expect(parseFactors({ silk_saree_fit: { points: 5, max_points: 25, unknown: false } })).toEqual([
      { id: "silk_saree_fit", points: 5, maxPoints: 25, unknown: false },
    ]);
  });

  it("draws nothing for anything else", () => {
    for (const bad of [null, undefined, "text", 5, [], {}, [null, 3, "x"]]) {
      const { container, unmount } = render(<FactorBreakdown factors={bad} maxReachable={1} />);
      expect(container).toBeEmptyDOMElement();
      unmount();
    }
  });

  it("renders factor text as plain text", () => {
    const { container } = render(
      <FactorBreakdown factors={[{ id: "<img src=x onerror=1>", points: 1, max_points: 2, unknown: false }]} maxReachable={2} />,
    );
    expect(container.querySelector("img")).toBeNull();
  });
});
