import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { appDict } from "@/i18n/app";
import { chipCounts } from "@/lib/leads-v6/chips";
import type { LeadRow } from "@/lib/leads-v6/rows";

import { LeadsV6, type LeadsV6Props } from "./LeadsV6";

afterEach(cleanup);

const row = (over: Partial<LeadRow>): LeadRow => ({ key: "l-1", kind: "lead", id: "1", name: "Ravi K.", chip: "new", source: "indiamart", nearby: false, line: "Paver blocks · Gandhi Nagar", at: "2026-11-12T05:00:00Z", hot: false, isNew: true, phone: null, ownerUserId: null, ...over });
const ROWS: LeadRow[] = [
  row({}),
  row({ key: "p-2", kind: "found", id: "2", name: "Sri Sai Constructions", chip: "contacted", source: null, nearby: true, line: "contractor · Jayanagar", isNew: false }),
  row({ key: "l-3", id: "3", name: "Anitha R.", chip: "won", isNew: false, hot: true }),
];
const props = (over: Partial<LeadsV6Props> = {}): LeadsV6Props => ({
  words: appDict("en") as Record<string, string>,
  lang: "en",
  base: "/app/tenants/t1",
  help: <button type="button">?</button>,
  rows: ROWS,
  counts: chipCounts(ROWS),
  chip: "all",
  q: "",
  sourceNames: { indiamart: "IndiaMART" },
  selected: null,
  touches: null,
  chipHref: (c) => `/x?chip=${c}`,
  rowHref: (r) => `/x?open=${r.key}`,
  moreHref: null,
  canAdd: true,
  unavailable: false,
  mock: false,
  ...over,
});

describe("the Leads page (design system v6)", () => {
  it("shows the six chips and All with their counts, the active one marked", () => {
    render(<LeadsV6 {...props({ chip: "won" })} />);
    const nav = screen.getByRole("navigation", { name: "Filter by status" });
    const chips = within(nav).getAllByRole("link");
    expect(chips.map((c) => c.textContent)).toEqual(["All3", "New1", "Contacted1", "Visit booked0", "Quote0", "Won1", "Lost0"]);
    expect(within(nav).getByRole("link", { name: /Won/ })).toHaveAttribute("aria-current", "page");
    expect(within(nav).getByRole("link", { name: /^New/ })).toHaveAttribute("href", "/x?chip=new");
  });
  it("draws the table: a status pill per row, the source, and 'Found nearby' for a business the Lead Finder found", () => {
    render(<LeadsV6 {...props()} />);
    const table = screen.getByRole("table");
    expect(within(table).getAllByRole("row")).toHaveLength(4);
    const found = table.querySelector('[data-lead="p-2"]') as HTMLElement;
    expect(found).toHaveTextContent("Found nearby");
    expect(found).toHaveTextContent("Lead Finder");
    expect(found.querySelector('[data-status="no_answer"]')).toHaveTextContent("Contacted");
    const lead = table.querySelector('[data-lead="l-1"]') as HTMLElement;
    expect(lead).toHaveTextContent("IndiaMART");
    expect(lead.querySelector('[data-status="live"]')).toHaveTextContent("New");
    expect(within(lead).getByRole("link", { name: "Ravi K." })).toHaveAttribute("href", "/x?open=l-1");
    expect(table.querySelector('[data-lead="l-3"]')).toHaveTextContent("Waiting for a call");
    expect(table.querySelector('[data-lead="l-3"] [data-status="completed"]')).toHaveTextContent("Won");
  });
  it("opens the customer's panel on the right: where from, when, what, a way to open the lead and its history", () => {
    render(<LeadsV6 {...props({ selected: ROWS[0], touches: [{ at: "2026-11-12T05:00:00Z", kind: "first", source: "indiamart" }, { at: "2026-11-13T05:00:00Z", kind: "repeat", source: "justdial" }] })} />);
    const panel = screen.getByRole("complementary", { name: "The customer" });
    expect(within(panel).getByRole("heading", { name: "Ravi K." })).toBeInTheDocument();
    expect(panel).toHaveTextContent("IndiaMART");
    expect(panel).toHaveTextContent("Paver blocks");
    expect(within(panel).getByRole("link", { name: "Open lead" })).toHaveAttribute("href", "/app/tenants/t1/leads/1");
    expect(within(panel).getAllByRole("listitem")).toHaveLength(2);
    expect(panel).toHaveTextContent("Asked again");
  });
  it("a found business opens in the Lead Finder and has no history", () => {
    render(<LeadsV6 {...props({ selected: ROWS[1] })} />);
    const panel = screen.getByRole("complementary");
    expect(within(panel).getByRole("link", { name: "Open in Lead Finder" })).toHaveAttribute("href", "/app/tenants/t1/retailers?id=2");
    expect(panel.querySelector('[data-part="lead-history"]')).toBeNull();
    expect(panel).toHaveTextContent("Found nearby");
  });
  it("says what to do when nothing is picked", () => {
    render(<LeadsV6 {...props()} />);
    expect(screen.getByRole("complementary")).toHaveTextContent("Pick a lead");
  });
  it("an empty page shows its next step (Add leads), a viewer is sent back to Today", () => {
    const { rerender } = render(<LeadsV6 {...props({ rows: [], counts: chipCounts([]) })} />);
    expect(document.querySelector('[data-part="empty-next"]')).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "Add leads" }).length).toBeGreaterThan(0);
    rerender(<LeadsV6 {...props({ rows: [], counts: chipCounts([]), canAdd: false })} />);
    expect(screen.getByRole("link", { name: "Back to Today" })).toHaveAttribute("href", "/app/tenants/t1");
    expect(screen.queryByRole("link", { name: "Add leads" })).toBeNull();
  });
  it("a filter with no match says so (not the empty page), the search keeps its words", () => {
    render(<LeadsV6 {...props({ rows: [], q: "zzz" })} />);
    expect(screen.getByText(/No leads match/)).toBeInTheDocument();
    expect(screen.getByRole("searchbox")).toHaveValue("zzz");
  });
  it("says when the leads cannot be read, and marks test data", () => {
    const { rerender } = render(<LeadsV6 {...props({ unavailable: true, rows: [], counts: chipCounts([]) })} />);
    expect(screen.getByText(/not available right now/)).toBeInTheDocument();
    rerender(<LeadsV6 {...props({ mock: true })} />);
    expect(screen.getByRole("note")).toHaveTextContent("made up");
  });
  it("has the page header with the '?' and one more-link when there are more", () => {
    render(<LeadsV6 {...props({ moreHref: "/x?after=c" })} />);
    expect(screen.getByRole("heading", { level: 1, name: "Leads" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "?" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Show more" })).toHaveAttribute("href", "/x?after=c");
  });
});
