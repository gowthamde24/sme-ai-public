import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { ClaimSuggestionOut } from "@/lib/api/agents";

vi.mock("./suggestion-actions", () => ({ reviewClaimAction: vi.fn(async () => undefined) }));

import { SuggestionsPanel } from "./suggestions-panel";

const TENANT = "22222222-2222-2222-2222-222222222222";
const TARGET = "33333333-3333-3333-3333-333333333333";
const UNREVIEWED = "44444444-4444-4444-4444-444444444441";
const ACCEPTED = "44444444-4444-4444-4444-444444444442";
const REJECTED = "44444444-4444-4444-4444-444444444443";
const MANUAL = "44444444-4444-4444-4444-444444444444";

function claim(id: string, over: Partial<ClaimSuggestionOut> = {}): ClaimSuggestionOut {
  return {
    id,
    company_id: TARGET,
    lead_id: null,
    predicate: "selftest.observation",
    value: `value of ${id.slice(-1)}`,
    confidence: "unverified",
    claim_confidence: "unverified",
    created_via: "agent",
    agent_run_id: "77777777-7777-4777-8777-777777777777",
    created_by: "u",
    created_at: "2026-10-04T12:00:00+00:00",
    review_state: "unreviewed",
    review_confidence: null,
    reviewed_by: null,
    reviewed_at: null,
    ...over,
  };
}
const claims = [
  claim(UNREVIEWED),
  claim(ACCEPTED, { review_state: "accepted", review_confidence: "medium", confidence: "medium" }),
  claim(REJECTED, { review_state: "rejected" }),
  claim(MANUAL, { created_via: "manual", review_state: "not_applicable", value: "a person's claim" }),
];
const reviewIds = Object.fromEntries(
  claims.map((c, i) => [c.id, { accept: `a-${i}`, reject: `r-${i}` }]),
);

function renderPanel(over: Partial<Parameters<typeof SuggestionsPanel>[0]> = {}) {
  return render(
    <SuggestionsPanel
      tenantId={TENANT}
      target="companies"
      targetId={TARGET}
      claims={claims}
      canReview={false}
      reviewIds={reviewIds}
      {...over}
    />,
  );
}

describe("SuggestionsPanel", () => {
  it("labels an unreviewed agent claim 'agent suggestion, unreviewed'", () => {
    renderPanel();
    expect(screen.getByText(/agent suggestion, unreviewed/)).toBeTruthy();
  });

  it("shows accepted (with the person's confidence) and rejected states, and only AGENT claims", () => {
    renderPanel();
    expect(screen.getByText(/Approved by a person · Medium confidence/)).toBeTruthy();
    expect(screen.getByText(/Rejected by a person/)).toBeTruthy();
    expect(screen.queryByText("a person's claim")).toBeNull();
  });

  it("gives Sales and Viewers NO review forms (canReview=false)", () => {
    renderPanel({ canReview: false });
    expect(screen.queryByRole("button", { name: "Accept" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Reject" })).toBeNull();
    expect(document.querySelector("form")).toBeNull();
  });

  it("gives an owner or admin an accept and a reject form per suggestion, each with its own ids", () => {
    renderPanel({ canReview: true });
    expect(screen.getAllByRole("button", { name: "Accept" })).toHaveLength(3);
    const ids = Array.from(document.querySelectorAll<HTMLInputElement>('input[name="review_id"]')).map((i) => i.value);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("renders a hostile value as PLAIN TEXT: no markup, no link, no image", () => {
    const hostile = claim(UNREVIEWED, {
      value: '<img src=x onerror=alert(1)><a href="https://evil.test">click</a> javascript:alert(1)',
    });
    const { container } = renderPanel({ claims: [hostile], reviewIds: {} });
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("a")).toBeNull();
    expect(container.textContent).toContain('<img src=x onerror=alert(1)><a href="https://evil.test">click</a>');
  });

  it("says so when the suggestions could not be loaded, and shows nothing invented", () => {
    renderPanel({ claims: null });
    expect(screen.getByRole("alert").textContent).toMatch(/Could not load the suggestions/);
    expect(screen.queryByText(/agent suggestion, unreviewed/)).toBeNull();
  });

  it("says there are none yet", () => {
    renderPanel({ claims: [] });
    expect(screen.getByText("No suggestions yet.")).toBeTruthy();
  });

  it("hides Accept and Reject behind 'Change decision' once a person has decided, and not before", () => {
    renderPanel({ canReview: true });
    const decided = screen.getAllByText("Change decision");
    expect(decided).toHaveLength(2); // the accepted and the rejected suggestion
    for (const summary of decided) {
      const details = summary.closest("details");
      expect(details).not.toBeNull();
      expect(details).not.toHaveAttribute("open");
      expect(details?.querySelectorAll("form")).toHaveLength(2);
    }
    // the unreviewed suggestion's forms are NOT inside a details element
    const unreviewed = screen.getByText(/agent suggestion, unreviewed/).closest("li");
    expect(unreviewed?.querySelector("details")).toBeNull();
    expect(unreviewed?.querySelectorAll("form")).toHaveLength(2);
  });

  it("nothing is preselected in any review form", () => {
    renderPanel({ canReview: true });
    for (const select of Array.from(document.querySelectorAll("select"))) expect(select.value).toBe("");
  });

  it("shows the date as a <time> element in the viewer's timezone", () => {
    renderPanel();
    const stamp = document.querySelector("time");
    expect(stamp?.getAttribute("datetime")).toBe("2026-10-04T12:00:00+00:00");
  });

  it("shows each suggestion's quote and source as plain text, with what was checked", () => {
    renderPanel({
      claims: [
        claim(UNREVIEWED, {
          evidence: [{ kind: "web_page", stance: "supports", provider: "agent.research", host: "h.test", path: "/p", quote: "<img src=x onerror=alert(1)>" }],
        }),
      ],
    });
    expect(screen.getByText("<img src=x onerror=alert(1)>")).toBeInTheDocument();
    expect(document.querySelector("img")).toBeNull();
    expect(screen.getByText(/source: h\.test\/p/)).toBeInTheDocument();
    expect(screen.getByText(/not by the database/)).toBeInTheDocument();
  });
});
