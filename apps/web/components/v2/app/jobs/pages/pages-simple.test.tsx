import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const nav = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: nav.push, refresh: nav.refresh }) }));
// the lazy chunks are drawn at once in a unit test
vi.mock("./LazyLinkSentence", async () => ({ LinkSentence: (await import("./LinkSentence")).LinkSentence }));
vi.mock("../../report-v6/Lazy", async () => ({ EnquiryChart: () => null, SalesChart: () => null, PrintButton: ({ label }: { label: string }) => <button type="button">{label}</button> }));
vi.mock("@/components/v2/LazyAssistantOrb", () => ({ AssistantOrb: () => <span data-orb /> }));

import { appDict } from "@/i18n/app";
import { callsHref, parseCallsQuery } from "@/lib/calls/filter";
import { statusCounts } from "@/lib/calls/status";
import { chipCounts } from "@/lib/leads-v6/chips";
import { fromSource, sourceKey, sourcesOf, type LeadRow } from "@/lib/leads-v6/rows";
import { periodHref, periodOf } from "@/lib/reports-v6/period";

import { CallsFilters } from "../../calls/v6/CallsFilters";
import { CallsFiltersSimple } from "../../calls/v6/CallsFiltersSimple";
import { LeadsV6Body, type LeadsV6Props } from "../../leads/LeadsV6";
import { PeriodSimple } from "../../report-v6/PeriodSimple";

const dict = appDict("en") as Record<string, string>;
const W = Object.fromEntries(Object.entries(dict).filter(([k]) => /^(calls6|lv6|rv6|jobs\.pg|ph|ld\.source)\./.test(k)));
const BASE = "/app/tenants/t1";
afterEach(cleanup);
beforeEach(() => nav.push.mockReset());

/** A sentence as the person reads it: each choice shows the option it has chosen (a select's own text is all of its options). */
const said = (el: Element | null): string => {
  const clone = el!.cloneNode(true) as HTMLElement;
  const live = Array.from(el!.querySelectorAll("select"));
  clone.querySelectorAll("select").forEach((sel, i) => sel.replaceWith(document.createTextNode(live[i].selectedOptions[0]?.textContent ?? "")));
  clone.querySelectorAll("svg").forEach((n) => n.remove());
  return (clone.textContent ?? "").replace(/\s+/g, " ").trim();
};
const line = (name: string) => document.querySelector(`[data-setting-line="${name}"]`);
const pick = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

describe("Calls filters as a sentence (JOBS)", () => {
  const counts = { all: 4, completed: 1, transferred: 0, no_answer: 1, rejected: 1, spam: 0, live: 1 };
  const draw = (query = parseCallsQuery({}), lines: { id: string; label: string }[] = [{ id: "l1", label: "Main line" }]) => render(<CallsFiltersSimple words={W} base={BASE} query={query} counts={counts} lines={lines} shown={4} total={4} />);

  it("says 'Show all (4) calls from any time.' with the choice inside, a search box and one live line", () => {
    draw();
    expect(said(line("calls"))).toBe("Show all (4) calls from any time.");
    expect(screen.getByRole("searchbox")).toBeInTheDocument();
    // the status choice holds every status of the old chips, each with its count
    const options = Array.from((screen.getByLabelText("Which calls") as HTMLSelectElement).options).map((o) => o.textContent);
    expect(options).toEqual(["all (4)", "completed (1)", "transferred (0)", "unanswered (1)", "refused (1)", "spam (0)", "live (1)"]);
  });

  it("a choice goes to the SAME address the old chip or dropdown led to", () => {
    const q = parseCallsQuery({ when: "7d", q: "sita" });
    draw(q);
    pick("Which calls", "no_answer");
    expect(nav.push).toHaveBeenLastCalledWith(callsHref(BASE, { ...q, status: "no_answer" }));
    pick("Date", "30d");
    expect(nav.push).toHaveBeenLastCalledWith(callsHref(BASE, { ...q, when: "30d" }));
    // the old chips led to the same places
    cleanup();
    render(<CallsFilters words={W} base={BASE} query={q} counts={counts} lines={[]} />);
    expect(document.querySelector('[data-chip="no_answer"]')).toHaveAttribute("href", callsHref(BASE, { ...q, status: "no_answer" }));
  });

  it("the number a call came in on is under More choices (closed), and its choice goes to the old address; no numbers = no More choices", () => {
    const q = parseCallsQuery({});
    draw(q);
    const more = document.querySelector('[data-part="more-choices"]') as HTMLDetailsElement;
    expect(more.open).toBe(false);
    expect(more).toHaveTextContent("More choices");
    pick("Number", "l1");
    expect(nav.push).toHaveBeenLastCalledWith(callsHref(BASE, { ...q, line: "l1" }));
    cleanup();
    draw(q, []);
    expect(document.querySelector('[data-part="more-choices"]')).toBeNull();
  });

  it("the search keeps the status, the date and the number in hidden fields; a filtered list says how many of how many", () => {
    const q = parseCallsQuery({ status: "no_answer", when: "today", line: "l1", q: "sita" });
    render(<CallsFiltersSimple words={W} base={BASE} query={q} counts={counts} lines={[{ id: "l1", label: "Main line" }]} shown={1} total={4} />);
    const form = screen.getByRole("search");
    expect(Array.from(form.querySelectorAll("input[type=hidden]")).map((i) => `${(i as HTMLInputElement).name}=${(i as HTMLInputElement).value}`)).toEqual(["status=no_answer", "when=today", "line=l1"]);
    expect(within(form).getByRole("searchbox")).toHaveValue("sita");
    expect((document.querySelector('[data-part="more-choices"]') as HTMLDetailsElement).open).toBe(true);
  });

  it("counts follow the rows given (the same statusCounts as the chips)", () => {
    expect(statusCounts([]).all).toBe(0);
  });
});

describe("Leads filters as a sentence (JOBS)", () => {
  const row = (over: Partial<LeadRow>): LeadRow => ({ key: "l-1", kind: "lead", id: "1", name: "Ravi K.", chip: "new", source: "indiamart", nearby: false, line: "Paver blocks", at: "2026-10-05T04:00:00Z", hot: false, isNew: true, phone: null, ownerUserId: null, ...over });
  const ROWS = [row({}), row({ key: "p-2", kind: "found", id: "2", name: "Sri Sai", chip: "contacted", source: null, nearby: true }), row({ key: "l-3", id: "3", name: "Anitha R.", chip: "won", source: "meta_lead_ads" }), row({ key: "l-4", id: "4", name: "No source", chip: "new", source: null })];
  const props = (over: Partial<LeadsV6Props> = {}): LeadsV6Props => ({ words: W, lang: "en", base: BASE, help: null, rows: ROWS, counts: chipCounts(ROWS), chip: "all", q: "", sourceNames: { indiamart: "IndiaMART", meta_lead_ads: "Meta lead ads" }, selected: null, touches: null, chipHref: (c) => `/x?chip=${c}`, rowHref: (r) => `/x?open=${r.key}`, moreHref: null, canAdd: true, unavailable: false, mock: false, ...over });
  const simple = (over: Partial<NonNullable<LeadsV6Props["simple"]>> = {}) => ({ source: null, sources: [{ key: "indiamart", label: "IndiaMART" }, { key: "finder", label: "Lead Finder" }], sourceHref: (s: string | null) => `/x?source=${s ?? ""}`, ...over });

  it("says 'Show all (4) leads from everywhere.' and keeps the search and the six statuses", () => {
    render(<LeadsV6Body {...props({ simple: simple() })} />);
    expect(said(line("leads"))).toBe("Show all (4) leads from everywhere.");
    expect(screen.getByRole("status")).toHaveTextContent("Leads on the screen: 4.");
    expect(screen.queryByRole("navigation", { name: "Filter by status" })).toBeNull(); // the chip bar of before is replaced
    expect(Array.from((screen.getByLabelText("Filter by status") as HTMLSelectElement).options).map((o) => o.value)).toEqual(["all", "new", "contacted", "visit_booked", "quote", "won", "lost"]);
    expect(screen.getByRole("searchbox")).toBeInTheDocument();
  });

  it("a status goes to the chip's address; a place goes to the source address", () => {
    render(<LeadsV6Body {...props({ simple: simple() })} />);
    pick("Filter by status", "won");
    expect(nav.push).toHaveBeenLastCalledWith("/x?chip=won");
    pick("Where the leads came from", "indiamart");
    expect(nav.push).toHaveBeenLastCalledWith("/x?source=indiamart");
  });

  it("a place with no leads still shows the sentence (a way back), never the 'no leads yet' page", () => {
    render(<LeadsV6Body {...props({ rows: [], counts: chipCounts([]), simple: simple({ source: "indiamart" }) })} />);
    expect(line("leads")).not.toBeNull();
    expect(screen.queryByText(/Add your first/i)).toBeNull();
  });

  it("JOBS off: the chips and the search are drawn as before", () => {
    render(<LeadsV6Body {...props()} />);
    expect(screen.getByRole("navigation", { name: "Filter by status" })).toBeInTheDocument();
    expect(document.querySelector("[data-simple]")).toBeNull();
  });

  it("the place of a row: the lead source, Lead Finder for a found business, none for a lead without one", () => {
    expect(ROWS.map(sourceKey)).toEqual(["indiamart", "finder", "meta_lead_ads", "none"]);
    expect(sourcesOf(ROWS)).toEqual(["indiamart", "finder", "meta_lead_ads", "none"]);
    expect(fromSource(ROWS, null)).toHaveLength(4);
    expect(fromSource(ROWS, "none").map((r) => r.name)).toEqual(["No source"]);
    expect(fromSource(ROWS, "finder").map((r) => r.name)).toEqual(["Sri Sai"]);
  });
});

describe("Reports period as a sentence (JOBS)", () => {
  const NOW = Date.parse("2026-11-13T06:30:00Z");
  it("says 'Show the last 14 days.', what is compared and keeps the PDF button", () => {
    render(<PeriodSimple words={W} lang="en" base={BASE} period={periodOf({}, NOW)} />);
    expect(said(line("period"))).toBe("Show the last 14 days.");
    expect(screen.getByRole("status")).toHaveTextContent(/Showing .* to .*, compared with .* to /);
    expect(screen.getByRole("button", { name: "Download PDF" })).toBeInTheDocument();
    expect(Array.from((screen.getByLabelText("Time") as HTMLSelectElement).options).map((o) => o.value)).toEqual(["today", "14", "month"]);
  });

  it("a choice goes to the address of the old period buttons", () => {
    render(<PeriodSimple words={W} lang="en" base={BASE} period={periodOf({}, NOW)} />);
    pick("Time", "today");
    expect(nav.push).toHaveBeenLastCalledWith(periodHref(BASE, "today"));
    pick("Time", "month");
    expect(nav.push).toHaveBeenLastCalledWith(periodHref(BASE, "month"));
    pick("Time", "14");
    expect(nav.push).toHaveBeenLastCalledWith(`${BASE}/report`);
  });

  it("own days are under More choices (the same GET form), open and chosen when the period is custom", () => {
    const { unmount } = render(<PeriodSimple words={W} lang="en" base={BASE} period={periodOf({}, NOW)} />);
    expect((document.querySelector('[data-part="more-choices"]') as HTMLDetailsElement).open).toBe(false);
    const form = document.querySelector('[data-part="more-choices"] form') as HTMLFormElement;
    expect(form).toHaveAttribute("action", `${BASE}/report`);
    expect(form.querySelector<HTMLInputElement>("input[name=range]")).toHaveValue("custom");
    unmount();
    const custom = periodOf({ range: "custom", from: "2026-11-02", to: "2026-11-08" }, NOW);
    render(<PeriodSimple words={W} lang="en" base={BASE} period={custom} />);
    expect((document.querySelector('[data-part="more-choices"]') as HTMLDetailsElement).open).toBe(true);
    expect((screen.getByLabelText("Time") as HTMLSelectElement).value).toBe("custom");
    pick("Time", "month");
    expect(nav.push).toHaveBeenLastCalledWith(periodHref(BASE, "month"));
  });

  it("one day: 'Showing ..., compared with ...' names the day before", () => {
    render(<PeriodSimple words={W} lang="en" base={BASE} period={periodOf({ range: "today" }, NOW)} />);
    expect(screen.getByRole("status")).toHaveTextContent(/^Showing .*, compared with /);
    expect(screen.getByRole("status")).not.toHaveTextContent(" to ");
  });
});
