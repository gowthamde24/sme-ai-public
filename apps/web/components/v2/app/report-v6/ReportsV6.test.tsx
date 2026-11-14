import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// the chart chunk is drawn at once in a unit test
vi.mock("./Lazy", async () => ({ EnquiryChart: (await import("./charts")).EnquiryChart, SalesChart: (await import("./charts")).SalesChart, PrintButton: (await import("./charts")).PrintButton }));

import type { SeriesRead } from "@/app/app/tenants/[tenantId]/report/series-data";
import { appDict } from "@/i18n/app";
import { periodOf } from "@/lib/reports-v6/period";
import { enquiryFigures, heatmap, salesFigures, visitFigures, type CallLike } from "@/lib/reports-v6/series";

import { ReportsV6, type ReportsV6Props } from "./ReportsV6";

afterEach(cleanup);

const NOW = Date.parse("2026-11-13T06:30:00Z");
const PERIOD = periodOf({}, NOW); // 31 Oct to 13 Nov
const day = (n: number) => PERIOD.days[n];
const lead = (n: number, source: string | null) => ({ createdAt: `${day(n)}T05:00:00Z`, source });
const LEADS = [lead(0, "instagram"), lead(1, "instagram"), lead(1, "indiamart"), lead(13, "instagram"), lead(13, "website_form"), { createdAt: "2026-10-20T05:00:00Z", source: "instagram" }];
const VISITS = [
  { date: day(1), status: "booked", outcome: null, order_id: null },
  { date: day(13), status: "booked", outcome: "bought", order_id: "o1" },
  { date: day(13), status: "confirmed", outcome: null, order_id: null },
  { date: "2026-10-20", status: "booked", outcome: null, order_id: null },
];
// calls: 6 incoming on Saturday 7 Nov (17:30 India), one outgoing
const SAT = "2026-11-07T12:00:00Z";
const CALLS: CallLike[] = [...Array.from({ length: 6 }, () => ({ createdAt: SAT, direction: "inbound" as const, costPaise: 500 })), { createdAt: SAT, direction: "outbound", costPaise: 700 }];
const series = (over: Partial<SeriesRead> = {}): SeriesRead => ({
  enquiries: enquiryFigures(LEADS, PERIOD),
  visits: visitFigures(VISITS, PERIOD),
  sales: salesFigures(VISITS, new Map([["o1", 24_000_000]]), PERIOD),
  callCostPaise: 131_000,
  heat: heatmap(CALLS),
  callsRead: CALLS.length,
  capped: false,
  ...over,
});
const props = (over: Partial<ReportsV6Props> = {}): ReportsV6Props => ({
  words: appDict("en") as Record<string, string>,
  lang: "en",
  base: "/app/tenants/t1",
  help: <button type="button">?</button>,
  businessName: "Sri Lakshmi Silks",
  period: PERIOD,
  counts: { enquiries: 58, called: 56, visits: 18, quotes: 11, won: 7 },
  series: series(),
  sources: [
    { source: "instagram", enquiries: 31, visits: 6, costPerVisitPaise: 18_000 },
    { source: "indiamart", enquiries: 14, visits: 3, costPerVisitPaise: 9_500 },
  ],
  sourceNames: { instagram: "Instagram ads", indiamart: "IndiaMART", website_form: "Website" },
  startHref: "/app/tenants/t1/outreach",
  mock: false,
  ...over,
});

describe("Reports (the approved mock)", () => {
  it("the heading says what the assistant brought in for the business; one period row: Today, Last 14 days, This month, Custom; Download PDF", () => {
    render(<ReportsV6 {...props()} />);
    expect(screen.getByRole("heading", { level: 1, name: "Reports" })).toBeInTheDocument();
    expect(screen.getByText("What your assistant brought in for Sri Lakshmi Silks")).toBeInTheDocument();
    const nav = screen.getByRole("navigation", { name: "Time" });
    expect([...nav.querySelectorAll("a")].map((a) => a.textContent)).toEqual(["Today", "Last 14 days", "This month"]);
    expect(nav.querySelector('[data-period="14"]')).toHaveAttribute("aria-current", "page");
    expect(nav.querySelector('[data-period="today"]')).toHaveAttribute("href", "/app/tenants/t1/report?range=today");
    expect(nav.querySelector('[data-period="14"]')).toHaveAttribute("href", "/app/tenants/t1/report");
    expect(within(nav).getByText("Custom")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Download PDF" })).toBeInTheDocument();
  });
  it("a custom period has a small form of two dates that comes back to the same page", () => {
    const custom = periodOf({ range: "custom", from: "2026-11-01", to: "2026-11-05" }, NOW);
    render(<ReportsV6 {...props({ period: custom, series: series({ enquiries: enquiryFigures(LEADS, custom), visits: visitFigures(VISITS, custom), sales: salesFigures(VISITS, new Map(), custom) }) })} />);
    const form = document.querySelector('[data-period="custom"] form') as HTMLFormElement;
    expect(form).toHaveAttribute("action", "/app/tenants/t1/report");
    expect([...form.querySelectorAll("input")].map((i) => `${i.name}=${i.value}`)).toEqual(["range=custom", "from=2026-11-01", "to=2026-11-05"]);
    expect(document.querySelector('[data-period="custom"] summary')).toHaveClass("bg-ink");
  });
  it("four figures: enquiries, visits booked, sales from visits in rupees, and the cost of your assistant with the rupees per visit", () => {
    render(<ReportsV6 {...props()} />);
    const k = (id: string) => document.querySelector(`[data-kpi="${id}"]`) as HTMLElement;
    expect(k("enquiries")).toHaveTextContent("Enquiries5");
    expect(k("visits")).toHaveTextContent("Visits booked3");
    expect(k("sales")).toHaveTextContent("Sales from visits₹2,40,000");
    expect(k("cost")).toHaveTextContent("Cost of your assistant₹1,310");
    expect(k("cost")).toHaveTextContent("₹437 per visit booked");
  });
  it("today is not over: its step is dashed and lighter with 'today so far' under it, never drawn as a solid fall to 0; a past period has no such step", () => {
    const { rerender } = render(<ReportsV6 {...props({ today: day(13) })} />);
    const enq = document.querySelector('[data-chart="enquiries"]') as HTMLElement;
    expect(enq.querySelector('[data-part="partial-day"]')).not.toBeNull();
    expect(enq.querySelector('[data-part="today-so-far"]')).toHaveTextContent("today so far");
    const sales = document.querySelector('[data-chart="sales"]') as HTMLElement;
    expect(sales.querySelector('[data-part="partial-day"]')).not.toBeNull();
    expect(sales).toHaveTextContent("today so far");
    rerender(<ReportsV6 {...props({ today: "2026-12-01" })} />);
    expect(document.querySelector('[data-part="partial-day"]')).toBeNull();
    expect(document.querySelector('[data-part="today-so-far"]')).toBeNull();
  });
  it("each figure says up or down against the period before: percent for enquiries, the difference for visits and rupees for sales", () => {
    render(<ReportsV6 {...props()} />);
    expect(document.querySelector('[data-kpi="enquiries"] em')).toHaveTextContent("▲ 400% vs previous 14 days");
    expect(document.querySelector('[data-kpi="visits"] em')).toHaveTextContent("▲ 2");
    expect(document.querySelector('[data-kpi="sales"] em')).toHaveTextContent("▲ ₹2,40,000");
    cleanup();
    render(<ReportsV6 {...props({ series: series({ enquiries: { perDay: PERIOD.days.map(() => 0), total: 2, previous: 8, sources: [] } }) })} />);
    expect(document.querySelector('[data-kpi="enquiries"] em')).toHaveTextContent("▼ 75% vs previous 14 days");
    expect(document.querySelector('[data-kpi="enquiries"] em')).toHaveClass("text-red-text");
  });
  it("a figure the API could not give says so, never a made-up number", () => {
    render(<ReportsV6 {...props({ series: series({ enquiries: null, sales: null, callCostPaise: null }) })} />);
    for (const id of ["enquiries", "sales", "cost"]) {
      expect(document.querySelector(`[data-kpi="${id}"]`)).toHaveTextContent("–");
      expect(document.querySelector(`[data-kpi="${id}"]`)).toHaveTextContent("Not available yet");
    }
  });
  it("the main chart has both lines, a legend, and a table of the numbers for screen readers", () => {
    render(<ReportsV6 {...props()} />);
    const sec = document.querySelector('[data-part="chart"]') as HTMLElement;
    expect(within(sec).getByRole("heading", { name: "Enquiries and visits per day" })).toBeInTheDocument();
    expect(within(sec).getByRole("img", { name: "Enquiries 5 and visits 3 over 14 days." })).toBeInTheDocument();
    const rows = within(sec).getAllByRole("row");
    expect(rows).toHaveLength(15); // the head and 14 days
    expect(rows[1]).toHaveTextContent(/Sat, 31 Oct\s*1\s*0/);
    expect(rows[14]).toHaveTextContent(/Fri, 13 Nov\s*2\s*2/);
    expect(sec.querySelectorAll("path.ds-draw")).toHaveLength(2); // two glossy lines
  });
  it("sources: a donut with the number of enquiries in the middle and each source in words, and what each visit cost in rupees", () => {
    render(<ReportsV6 {...props()} />);
    const sec = document.querySelector('[data-part="sources"]') as HTMLElement;
    expect(sec).toHaveTextContent("Where enquiries came from");
    expect(sec.querySelector("svg text")).toHaveTextContent("5");
    expect([...sec.querySelectorAll("[data-source]")].map((l) => l.textContent)).toEqual(["Instagram ads3", "IndiaMART1", "Website1"]);
    const cost = sec.querySelector('[data-part="cost-per-visit"]') as HTMLElement;
    expect(cost).toHaveTextContent("Instagram ads₹180 per visit");
    expect(cost).toHaveTextContent("IndiaMART₹95 per visit");
    expect(sec.querySelectorAll("circle[stroke-dasharray]").length).toBeGreaterThanOrEqual(3);
  });
  it("the funnel runs enquiries, called, visits, quotes, won, each with its step percentage of the step before", () => {
    render(<ReportsV6 {...props()} />);
    const f = document.querySelector('[data-part="funnel"]') as HTMLElement;
    const rows = [...f.querySelectorAll("li")];
    expect(rows.map((r) => r.getAttribute("data-stage"))).toEqual(["enquiries", "called", "visits", "quotes", "won"]);
    expect(rows[0]).toHaveTextContent("Enquiries58");
    expect(rows[1]).toHaveTextContent("Called5697%");
    expect(rows[2]).toHaveTextContent("Visits1832%");
    expect(rows[3]).toHaveTextContent("Quotes1161%");
    expect(rows[4]).toHaveTextContent("Won764%");
  });
  it("a step that could not be read says so in its row", () => {
    render(<ReportsV6 {...props({ counts: { enquiries: 58, called: null, visits: 18, quotes: 11, won: 7 } })} />);
    expect(document.querySelector('[data-stage="called"]')).toHaveTextContent("Not available yet");
  });
  it("busiest times: seven weekdays by twelve hours, darker for more calls, and a plain tip that names the busiest time", () => {
    render(<ReportsV6 {...props()} />);
    const sec = document.querySelector('[data-part="heatmap"]') as HTMLElement;
    expect(sec.querySelectorAll(".ds-heat")).toHaveLength(84);
    expect(sec.querySelectorAll('.ds-heat[data-l="5"]')).toHaveLength(1);
    expect(sec.querySelector('.ds-heat[title="Saturday 5 pm: 6"]')).not.toBeNull();
    expect(sec.querySelector('[data-part="heat-tip"]')).toHaveTextContent("Saturday, 5 pm to 7 pm, is your busiest time. Keep a salesperson free for visits then.");
    expect(sec).toHaveTextContent("From your latest 6 incoming calls");
  });
  it("too few calls: it says so instead of drawing a picture of nothing", () => {
    render(<ReportsV6 {...props({ series: series({ heat: heatmap(CALLS.slice(0, 2)) }) })} />);
    expect(document.querySelector('[data-part="heat-none"]')).toHaveTextContent("Not enough calls yet to show busy times.");
    expect(document.querySelectorAll(".ds-heat")).toHaveLength(0);
    cleanup();
    render(<ReportsV6 {...props({ series: series({ heat: null }) })} />);
    expect(document.querySelector('[data-part="heat-none"]')).toHaveTextContent("Not available yet");
  });
  it("sales from visits: the total in rupees, the running-total line, and how many sales could not be counted", () => {
    render(<ReportsV6 {...props()} />);
    const sec = document.querySelector('[data-part="sales"]') as HTMLElement;
    expect(sec).toHaveTextContent("₹2,40,000");
    expect(within(sec).getByRole("img", { name: "Sales from visits add up to ₹2,40,000." })).toBeInTheDocument();
    cleanup();
    render(<ReportsV6 {...props({ series: series({ sales: { perDay: PERIOD.days.map(() => 0), total: 0, previous: 0, missing: 2 } }) })} />);
    expect(document.querySelector('[data-part="sales"]')).toHaveTextContent("2 sales could not be counted yet.");
    cleanup();
    render(<ReportsV6 {...props({ series: series({ sales: { perDay: PERIOD.days.map(() => 0), total: 0, previous: 0, missing: 0 } }) })} />);
    expect(document.querySelector('[data-part="sales"]')).toHaveTextContent("No visit has ended in a sale in this time.");
  });
  it("shows no supplier name, no cost of ours, no credits and no 'AI team' anywhere on the page", () => {
    render(<ReportsV6 {...props()} />);
    expect(document.body.textContent).not.toMatch(/cartesia|sarvam|plivo|anthropic|exotel|openai|credit|overage|AI team/i);
  });
  it("nothing at all yet: the empty page shows its next step", () => {
    render(<ReportsV6 {...props({ counts: { enquiries: 0, called: 0, visits: 0, quotes: 0, won: 0 }, sources: [], series: series({ enquiries: enquiryFigures([], PERIOD), visits: visitFigures([], PERIOD) }) })} />);
    expect(document.querySelector('[data-part="empty-next"]')).toHaveTextContent("Results will show here");
    expect(screen.getByRole("link", { name: "Plan a campaign" })).toHaveAttribute("href", "/app/tenants/t1/outreach");
  });
  it("says when it is test data, and when only the newest enquiries are counted", () => {
    render(<ReportsV6 {...props({ mock: true, series: series({ capped: true }) })} />);
    expect(screen.getByText(/Test data: these numbers are made up/)).toBeInTheDocument();
    expect(screen.getByText(/Showing the newest enquiries/)).toBeInTheDocument();
  });
  it("draws the business type's own reports under the page", () => {
    render(<ReportsV6 {...props({ more: <p data-more="">more reports</p> })} />);
    expect(document.querySelector("[data-more]")).toBeInTheDocument();
  });
});
