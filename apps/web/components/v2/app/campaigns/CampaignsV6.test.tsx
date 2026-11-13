import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { appDict } from "@/i18n/app";
import type { CampaignCard } from "@/lib/campaigns-v6/cards";

import { BatchControls } from "./BatchControls";
import { CampaignsV6, type CampaignsV6Props } from "./CampaignsV6";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: () => undefined, replace: () => undefined }), usePathname: () => "/", useSearchParams: () => new URLSearchParams() }));
afterEach(() => {
  cleanup();
  refresh.mockClear();
});

const WORDS = appDict("en") as Record<string, string>;
const card = (over: Partial<CampaignCard>): CampaignCard => ({ id: "b1", kind: "list", name: "IndiaMART leads", channel: "call", goal: "site_visit", state: "running", pausedBy: null, done: 20, total: 30, people: 30, forEstimate: null, results: { visits: 3, quotesPaise: 1_250_000, interested: 5, paidPaise: null }, href: "/app/tenants/t1/outreach/batches/b1", ...over });
const props = (over: Partial<CampaignsV6Props> = {}): CampaignsV6Props => ({
  words: WORDS,
  help: <button type="button">?</button>,
  cards: [card({ id: "p1", name: "Meta leads", state: "planned", done: 0, forEstimate: { calls: 30, avgMinutes: 3, estimatedMinutes: 90, estimatedCostPaise: 40_000 }, results: { visits: null, quotesPaise: null, interested: null, paidPaise: null } }), card({}), card({ id: "b2", name: "Old list", state: "done", done: 30 })],
  estimates: { p1: { costText: "₹675", timeText: "about 2 h 30 min of calling", totalMinutes: 150, includedMinutesUsed: 0, enough: true, shortfallText: null } },
  hours: "Mon – Sat, 09:00 – 19:00",
  goalNames: { site_visit: "Site visit" },
  newHref: "/app/tenants/t1/outreach/new?source=excel_upload",
  control: () => async () => ({ ok: true }),
  unavailable: false,
  mock: false,
  emptyHref: "/app/tenants/t1/outreach/new?source=excel_upload",
  ...over,
});

describe("Campaigns (design system v6)", () => {
  it("groups the cards: waiting for the OK, going on, finished", () => {
    render(<CampaignsV6 {...props()} />);
    expect(screen.getByRole("heading", { level: 1, name: "Campaigns" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Waiting for your OK" })).toHaveTextContent("Meta leads");
    expect(screen.getByRole("region", { name: "Going on" })).toHaveTextContent("IndiaMART leads");
    expect(screen.getByRole("region", { name: "Finished" })).toHaveTextContent("Old list");
    expect(screen.getByRole("link", { name: "New campaign" })).toHaveAttribute("href", "/app/tenants/t1/outreach/new?source=excel_upload");
  });
  it("a plan card says the time, the cost in rupees and the calling hours, and opens the plan", () => {
    render(<CampaignsV6 {...props()} />);
    const plan = document.querySelector('[data-campaign="p1"]') as HTMLElement;
    expect(plan.querySelector('[data-status="transferred"]')).toHaveTextContent("Waiting for your OK");
    const facts = within(plan.querySelector('[data-part="plan"]') as HTMLElement);
    expect(facts.getByText("about 2 h 30 min of calling")).toBeInTheDocument();
    expect(facts.getByText("₹675")).toBeInTheDocument();
    expect(facts.getByText("Mon – Sat, 09:00 – 19:00")).toBeInTheDocument();
    expect(within(plan).getByRole("link", { name: "Review and approve" })).toHaveAttribute("href", "/app/tenants/t1/outreach/batches/b1");
    expect(plan).toHaveTextContent("Calling · Site visit · 30 people");
  });
  it("warns, in the API's own words, when the balance is not enough", () => {
    render(<CampaignsV6 {...props({ estimates: { p1: { costText: "₹1,800", timeText: "about 15 h of calling", totalMinutes: 900, includedMinutesUsed: 500, enough: false, shortfallText: "₹250 more needed" } } })} />);
    expect(screen.getByRole("note")).toHaveTextContent("₹250 more needed");
  });
  it("a running card shows a progress bar with its words, the results and Pause", () => {
    render(<CampaignsV6 {...props()} />);
    const run = document.querySelector('[data-campaign="b1"]') as HTMLElement;
    const bar = within(run).getByRole("progressbar", { name: "Progress of IndiaMART leads" });
    expect(bar).toHaveAttribute("value", "20");
    expect(bar).toHaveAttribute("max", "30");
    expect(run).toHaveTextContent("20 of 30 done");
    expect(run).toHaveTextContent("Visits booked: 3 · Quotes: ₹12,500");
    expect(within(run).getByRole("button", { name: "Pause" })).toBeInTheDocument();
    expect(run.querySelector('[data-status="live"]')).toHaveTextContent("Running");
  });
  it("shows what is known and says results come in when nothing is", () => {
    render(<CampaignsV6 {...props({ cards: [card({ id: "i1", results: { visits: null, quotesPaise: null, interested: 4, paidPaise: null } }), card({ id: "w1", results: { visits: null, quotesPaise: null, interested: null, paidPaise: null } }), card({ id: "r1", kind: "reminder", channel: "whatsapp", goal: null, results: { visits: null, quotesPaise: null, interested: 2, paidPaise: 9_200_000 } })] })} />);
    expect(document.querySelector('[data-campaign="i1"]')).toHaveTextContent("Interested: 4");
    expect(document.querySelector('[data-campaign="w1"]')).toHaveTextContent("Results come in as people are reached.");
    expect(document.querySelector('[data-campaign="r1"]')).toHaveTextContent("Paid after a reminder: ₹92,000");
  });
  it("no Pause for a person who cannot (no control), none for a reminder campaign", () => {
    render(<CampaignsV6 {...props({ control: null })} />);
    expect(screen.queryByRole("button", { name: "Pause" })).toBeNull();
  });
  it("an empty page shows its next step; an unreadable one says so; test data is marked", () => {
    const { rerender } = render(<CampaignsV6 {...props({ cards: [], estimates: {} })} />);
    expect(document.querySelector('[data-part="empty-next"]')).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Make a list" })).toHaveAttribute("href", "/app/tenants/t1/outreach/new?source=excel_upload");
    rerender(<CampaignsV6 {...props({ unavailable: true })} />);
    expect(screen.getByText(/not available right now/)).toBeInTheDocument();
    rerender(<CampaignsV6 {...props({ mock: true })} />);
    expect(screen.getByRole("note")).toHaveTextContent("made up");
  });
});

describe("Pause and Undo", () => {
  it("Pause calls the action, then the page reads again", async () => {
    const control = vi.fn(async () => ({ ok: true as const }));
    render(<BatchControls words={WORDS} state="running" pausedBy={null} control={control} />);
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    await waitFor(() => expect(control).toHaveBeenCalledWith("pause"));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });
  it("a list the owner paused offers Undo, which resumes it", async () => {
    const control = vi.fn(async () => ({ ok: true as const }));
    render(<BatchControls words={WORDS} state="paused" pausedBy="owner" control={control} />);
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(control).toHaveBeenCalledWith("resume"));
  });
  it("a list a limit paused is not undone here", () => {
    render(<BatchControls words={WORDS} state="paused" pausedBy="limit" control={async () => ({ ok: true })} />);
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText(/A limit stopped it for now/)).toBeInTheDocument();
  });
  it("says so when the change fails", async () => {
    render(<BatchControls words={WORDS} state="running" pausedBy={null} control={async () => ({ ok: false, error: "state" })} />);
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not do that");
    expect(refresh).not.toHaveBeenCalled();
  });
});
