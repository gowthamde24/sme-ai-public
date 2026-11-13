import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { appDict } from "@/i18n/app";

import { HBar } from "../v6/HBar";
import { ReportsV6, type ReportsV6Props } from "./ReportsV6";

afterEach(cleanup);

const props = (over: Partial<ReportsV6Props> = {}): ReportsV6Props => ({
  words: appDict("en") as Record<string, string>,
  lang: "en",
  base: "/app/tenants/t1",
  help: <button type="button">?</button>,
  range: "week",
  rangeHref: (k) => `/r?range=${k}`,
  counts: { enquiries: 40, called: 31, visits: 9, quotes: 5, won: 2 },
  quotesPaise: 1_250_000,
  sources: [
    { source: "meta_lead_ads", enquiries: 30, visits: 6, costPerVisitPaise: 180_000 },
    { source: "indiamart", enquiries: 10, visits: 3, costPerVisitPaise: 300_000 },
    { source: "justdial", enquiries: 4, visits: 0, costPerVisitPaise: null },
  ],
  costPerVisitPaise: 220_000,
  sourceNames: { meta_lead_ads: "Meta lead ads", indiamart: "IndiaMART", justdial: "JustDial" },
  startHref: "/app/tenants/t1/outreach",
  mock: false,
  ...over,
});

describe("Reports (design system v6)", () => {
  it("puts results first: visits, quotes in rupees and sales won, before any chart", () => {
    render(<ReportsV6 {...props()} />);
    const tiles = document.querySelector('[data-part="tiles"]') as HTMLElement;
    expect(tiles).toHaveTextContent("Visits booked9");
    expect(tiles).toHaveTextContent("₹12,500");
    expect(tiles).toHaveTextContent("Quotes: 5");
    expect(tiles).toHaveTextContent("Sales won2");
    expect(tiles.compareDocumentPosition(document.querySelector('[data-part="funnel"]') as HTMLElement) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
  it("draws the funnel from enquiries to won as rows of words and numbers, each saying how many of the step before", () => {
    render(<ReportsV6 {...props()} />);
    const funnel = screen.getByRole("region", { name: "From enquiry to sale" });
    const rows = within(funnel).getAllByRole("listitem");
    expect(rows.map((r) => r.getAttribute("data-bar"))).toEqual(["100", "78", "23", "13", "5"]);
    expect(rows[0]).toHaveTextContent("Enquiries");
    expect(rows[1]).toHaveTextContent("31");
    expect(rows[1]).toHaveTextContent("31 of 40");
    expect(rows[4]).toHaveTextContent("Won");
    expect(rows[4]).toHaveTextContent("2 of 5");
    expect(funnel.querySelectorAll("svg[aria-hidden='true']")).toHaveLength(5);
  });
  it("lists the sources with their visits, and the cost of a visit in rupees with the cheapest source first", () => {
    render(<ReportsV6 {...props()} />);
    const sources = screen.getByRole("region", { name: "Where visits came from" });
    expect(within(sources).getAllByRole("listitem").map((r) => r.textContent)).toEqual(["Meta lead adsVisits 6from 30 enquiries", "IndiaMARTVisits 3from 10 enquiries", "JustDialVisits 0from 4 enquiries"]);
    const cost = screen.getByRole("region", { name: "What a visit cost" });
    expect(cost).toHaveTextContent("₹2,200");
    expect(within(cost).getAllByRole("listitem").map((r) => r.textContent)).toEqual(["Meta lead ads₹1,800", "IndiaMART₹3,000"]);
  });
  it("shows no count of activity on its own", () => {
    render(<ReportsV6 {...props()} />);
    expect(document.body.textContent).not.toMatch(/calls made|messages sent|minutes used|first touch/i);
  });
  it("says a step is not available yet where it could not be read, and has no bar for it", () => {
    render(<ReportsV6 {...props({ counts: { enquiries: null, called: null, visits: 9, quotes: null, won: 2 }, quotesPaise: null })} />);
    const funnel = screen.getByRole("region", { name: "From enquiry to sale" });
    expect(within(funnel).getAllByText("Not available yet")).toHaveLength(3);
    expect(funnel.querySelectorAll("svg")).toHaveLength(2);
    expect(document.querySelector('[data-tile="quotes"]')).toHaveTextContent("-");
  });
  it("marks the time range in use and links the others", () => {
    render(<ReportsV6 {...props({ range: "30" })} />);
    const nav = screen.getByRole("navigation", { name: "Time" });
    expect(within(nav).getByRole("link", { name: "Last 30 days" })).toHaveAttribute("aria-current", "page");
    expect(within(nav).getByRole("link", { name: "This week" })).toHaveAttribute("href", "/r?range=week");
  });
  it("says so when no source brought a visit or no visit was booked (no cost)", () => {
    render(<ReportsV6 {...props({ sources: [], costPerVisitPaise: null })} />);
    expect(screen.getByText("No source has brought a visit yet.")).toBeInTheDocument();
    expect(screen.getByText(/no cost to show/)).toBeInTheDocument();
  });
  it("an empty page shows its next step", () => {
    render(<ReportsV6 {...props({ counts: { enquiries: 0, called: 0, visits: 0, quotes: 0, won: 0 }, sources: [], costPerVisitPaise: null })} />);
    expect(document.querySelector('[data-part="empty-next"]')).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Plan a campaign" })).toHaveAttribute("href", "/app/tenants/t1/outreach");
  });
  it("marks test data", () => {
    render(<ReportsV6 {...props({ mock: true })} />);
    expect(screen.getByRole("note")).toHaveTextContent("made up");
  });
});

describe("a bar of the charts", () => {
  it("is a picture only: hidden from a screen reader, clamped to 0 to 100, with the number in words beside it", () => {
    const { container } = render(
      <ul>
        <HBar label="A" width={250} value="7" />
        <HBar label="B" width={-3} value="0" sub="none" />
      </ul>,
    );
    const rects = container.querySelectorAll("li");
    expect(rects[0].getAttribute("data-bar")).toBe("100");
    expect(rects[1].getAttribute("data-bar")).toBe("0");
    expect(rects[1].querySelectorAll("rect")).toHaveLength(1);
    expect(container.querySelectorAll("svg[aria-hidden='true']")).toHaveLength(2);
    expect(rects[1]).toHaveTextContent("none");
  });
});
