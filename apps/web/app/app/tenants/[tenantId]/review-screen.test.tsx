import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { ClaimSuggestionOut } from "@/lib/api/agents";

vi.mock("./suggestion-actions", () => ({
  reviewClaimAction: vi.fn(async () => undefined),
  reviewQueueClaimAction: vi.fn(async () => undefined),
}));

import { ReviewScreen } from "./review-screen";
import { cardBox, cardGrid } from "@/components/v2/app/ui";

const TENANT = "22222222-2222-2222-2222-222222222222";
const COMPANY = "33333333-3333-3333-3333-333333333333";
const HOSTILE = '<img src=x onerror=alert(1)> <script>alert(2)</script> javascript:alert(3)';

let n = 0;
function claim(over: Partial<ClaimSuggestionOut> = {}): ClaimSuggestionOut {
  n += 1;
  return {
    id: `44444444-4444-4444-4444-${String(n).padStart(12, "0")}`,
    company_id: COMPANY,
    lead_id: null,
    predicate: "buyer_type",
    value: "wholesaler",
    confidence: "unverified",
    claim_confidence: "unverified",
    created_via: "agent",
    agent_run_id: "r",
    created_by: "u",
    created_at: "2026-10-04T12:00:00+00:00",
    review_state: "unreviewed",
    review_confidence: null,
    reviewed_by: null,
    reviewed_at: null,
    counts_toward_score: true,
    company_name: "Saree House",
    evidence: [
      { kind: "web_page", stance: "supports", provider: "agent.research", host: "saree-house.test", path: "/about", quote: "We sell silk sarees in bulk." },
    ],
    ...over,
  };
}
const ids = (claims: ClaimSuggestionOut[]) =>
  Object.fromEntries(claims.map((c, i) => [c.id, { accept: `a-${i}`, reject: `r-${i}` }]));
const show = (claims: ClaimSuggestionOut[] | null, canReview = true) =>
  render(<ReviewScreen tenantId={TENANT} claims={claims} canReview={canReview} reviewIds={ids(claims ?? [])} />);

describe("ReviewScreen", () => {
  it("shows the predicate, the value, the quote, the source host and path, and what the quote was checked by", () => {
    show([claim()]);
    const region = screen.getByRole("region", { name: "Saree House: buyer_type" });
    expect(within(region).getByText("wholesaler")).toBeInTheDocument();
    expect(within(region).getByText("We sell silk sarees in bulk.")).toBeInTheDocument();
    expect(within(region).getByText(/source: saree-house\.test\/about/)).toBeInTheDocument();
    expect(within(region).getByText("Quote checked by the agent runtime, not by the database.")).toBeInTheDocument();
    expect(within(region).getByText(/agent suggestion, unreviewed/)).toBeInTheDocument();
  });

  it("renders hostile quote, value and company text as plain text only", () => {
    const { container } = show([claim({ value: HOSTILE.slice(0, 40), company_name: "<b>Evil</b> Co", evidence: [{ kind: "web_page", stance: "supports", provider: "agent.research", host: "h.test", path: "/p", quote: HOSTILE }] })]);
    expect(container.querySelector("script, img, iframe, b, svg, object")).toBeNull();
    expect(container.querySelector("[onerror], [src]")).toBeNull();
    expect(container.textContent).toContain(HOSTILE);
    expect(container.textContent).toContain("<b>Evil</b> Co");
  });

  it("a reviewer gets accept (a confidence is required) and a one-tap reject; nobody else gets controls", () => {
    const { unmount } = show([claim()], true);
    expect(screen.getByRole("button", { name: "Accept" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reject" })).toBeInTheDocument();
    expect((screen.getByLabelText(/accept as/i) as HTMLSelectElement).required).toBe(true);
    expect((screen.getByLabelText(/reject \(a reason is optional\)/i) as HTMLSelectElement).required).toBe(false);
    unmount();
    show([claim()], false);
    expect(screen.queryByRole("button", { name: "Accept" })).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("puts suggestions that disagree about one thing side by side, with a warning", () => {
    show([claim({ value: "wholesaler" }), claim({ value: "consumer" })]);
    const region = screen.getByRole("region", { name: "Saree House: buyer_type" });
    expect(within(region).getByRole("note")).toHaveTextContent(/These suggestions disagree/);
    const cards = within(region).getAllByRole("article");
    expect(cards.map((c) => c.getAttribute("aria-label")).sort()).toEqual(["suggestion consumer", "suggestion wholesaler"]);
    expect(cards[0].parentElement).toBe(cards[1].parentElement); // one grid
  });

  it("agreeing suggestions carry no warning", () => {
    show([claim(), claim()]);
    expect(screen.queryByRole("note")).toBeNull();
  });

  it("an accepted claim stays in view for comparison, without review controls", () => {
    show([claim({ value: "wholesaler", review_state: "accepted", review_confidence: "high" }), claim({ value: "consumer" })]);
    const accepted = screen.getByRole("article", { name: "suggestion wholesaler" });
    expect(within(accepted).getByText(/Approved by a person · High confidence/)).toBeInTheDocument();
    expect(within(accepted).queryByRole("button")).toBeNull();
    expect(within(screen.getByRole("article", { name: "suggestion consumer" })).getByRole("button", { name: "Accept" })).toBeInTheDocument();
  });

  it("is built for a phone: a grid that wraps to one column, wrapping text, no fixed widths, no links", () => {
    const { container } = show([claim({ value: "wholesaler" }), claim({ value: "consumer" })]);
    const grid = screen.getAllByRole("article")[0].parentElement as HTMLElement;
    expect(grid.className).toBe(cardGrid);
    expect(cardGrid).toMatch(/grid-template-columns:repeat\(auto-fit,minmax\(min\(100%,18rem\),1fr\)\)/);
    for (const card of screen.getAllByRole("article")) {
      expect(card.className).toBe(cardBox);
      expect(cardBox).toMatch(/overflow-wrap:anywhere/);
    }
    expect(container.querySelectorAll("[style]")).toHaveLength(0); // no inline width anywhere: the sizes come from the classes
    expect(container.querySelectorAll("a")).toHaveLength(0);
  });

  it("says when the API could not be reached, and when there is nothing to review", () => {
    const { unmount } = show(null);
    expect(screen.getByRole("alert")).toHaveTextContent(/Could not load/);
    unmount();
    show([claim({ review_state: "accepted" })]);
    expect(screen.getByText(/Nothing to review/)).toBeInTheDocument();
  });

  it("says when a kind of note is not part of any score", () => {
    show([claim({ counts_toward_score: false })]);
    expect(screen.getByText(/not part of any score yet/)).toBeInTheDocument();
  });
});
