import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }) }));
vi.mock("./LazyJobRow", async () => ({ JobRow: (await import("./JobRow")).JobRow }));

import { appDict } from "@/i18n/app";
import { parseNewJobSheet } from "@/lib/api/job-templates";
import { festivalHint } from "@/lib/jobs/festival";
import { MOCK_JOBS, MOCK_PAGE_JOBS } from "@/lib/jobs/mock";
import { filterJobs } from "@/lib/jobs/types";
import { mockPlan, mockStartPlan } from "@/lib/jobs/plan-mock";
import { wireNewJobSheet } from "@/lib/jobs/template-fixtures";
import type { SheetLoad } from "@/lib/jobs/templates";

import { JobsList } from "./JobsList";
import { JobsToday } from "./JobsToday";
import type { SheetActions } from "./sheet/types";

afterEach(cleanup);
const words = Object.fromEntries(Object.entries(appDict("en") as Record<string, string>).filter(([k]) => k.startsWith("jobs.")));
const BASE = "/app/tenants/t";
const LOAD: SheetLoad = { data: parseNewJobSheet(wireNewJobSheet()), lang: "en", business: "Neelambari Silks", assistant: "Asha" };
const sheetActions = (): SheetActions => ({
  plan: vi.fn(async (input) => ({ ok: true as const, data: mockPlan(input) })),
  start: vi.fn(async (id: string) => ({ ok: true as const, data: mockStartPlan(id) })),
  test: vi.fn(async (_id: string, channel) => ({ ok: true as const, data: { channel, mock: true, minutesUsed: 0 } })),
  load: vi.fn(async () => ({ ok: true as const, data: LOAD })),
});
const switches = { setEnabled: vi.fn(async (id: string, enabled: boolean) => ({ ok: true as const, data: { id, enabled, status: enabled ? ("running" as const) : ("paused" as const) } })) };

describe("the Jobs page, the renamed Office", () => {
  it("each job is ONE boxed card in a grid (owner, 25 Nov: a THING you switch on is a card): one column on a phone, two on a wide screen, the text may shrink beside the switch (min-w-0), a job that needs you has the ink border", () => {
    const { container } = render(<JobsList jobs={MOCK_PAGE_JOBS} filter="all" words={words} base={BASE} actions={switches} sheet={{ actions: sheetActions(), load: null, open: false }} />);
    const list = container.querySelector("[data-group] > div") as HTMLElement;
    expect(list.className).toContain("grid-cols-1");
    expect(list.className).toContain("lg:grid-cols-2");
    const card = list.querySelector("[data-job]") as HTMLElement;
    expect(card.className).toMatch(/rounded-\[14px\]/);
    expect(card.className).toContain("border");
    expect(card.querySelector("a")?.className).toContain("min-w-0");
    expect(card.querySelector("svg[data-k]")).not.toBeNull();
    const needs = container.querySelector('[data-state="needs"]') as HTMLElement | null;
    if (needs) expect(needs.className).toContain("border-ink");
  });
  it("a job that cannot run (a phone number is missing) is under Needs you, says WHY in the one orange line and offers the fix; the chips count exactly the jobs of the sections", () => {
    const blocked = { ...MOCK_PAGE_JOBS[0], id: "blocked-1", enabled: false, status: "paused" as const, planGate: "no_number" as const, needsYou: 0 };
    const jobs = [...MOCK_PAGE_JOBS, blocked];
    const { container } = render(<JobsList jobs={jobs} filter="all" words={words} base={BASE} actions={switches} sheet={{ actions: sheetActions(), load: null, open: false }} />);
    const line = container.querySelector('[data-job="blocked-1"]') as HTMLElement;
    expect(line.closest("[data-group]")).toHaveAttribute("data-group", "needs");
    expect(line).toHaveTextContent("Needs a phone number first");
    expect(line).not.toHaveTextContent(/^Paused/);
    expect(within(line).getByRole("link", { name: "Add phone number" })).toHaveAttribute("href", `${BASE}/phone-number`);
    for (const [group, filter] of [["needs", "needs_you"], ["running", "running"], ["off", "paused"]] as const) {
      const n = container.querySelectorAll(`[data-group="${group}"] [data-job]`).length;
      expect(filterJobs(jobs, filter), group).toHaveLength(n);
    }
  });
  it("chips All / Running / Needs you / Paused with their counts; the open one is marked", () => {
    render(<JobsList jobs={MOCK_PAGE_JOBS} filter="all" words={words} base={BASE} actions={switches} sheet={{ actions: sheetActions(), load: null, open: false }} />);
    expect([...screen.getByRole("navigation", { name: "Filter your team" }).querySelectorAll("a")].map((a) => a.textContent)).toEqual(["All 8", "Running 5", "Needs you 2", "Paused 1"]);
    expect(screen.getByRole("link", { name: "All 8" })).toHaveAttribute("aria-current", "true");
    expect(screen.getByRole("link", { name: "Paused 1" })).toHaveAttribute("href", `${BASE}/jobs?filter=paused`);
  });
  it("more than the six of Today: unlimited jobs, grouped Needs you, Running, Paused", () => {
    const { container } = render(<JobsList jobs={MOCK_PAGE_JOBS} filter="all" words={words} base={BASE} actions={switches} sheet={{ actions: sheetActions(), load: null, open: false }} />);
    expect(MOCK_PAGE_JOBS.length).toBeGreaterThan(MOCK_JOBS.length);
    expect([...container.querySelectorAll("[data-group]")].map((g) => [g.getAttribute("data-group"), g.querySelectorAll("[data-job]").length])).toEqual([["needs", 2], ["running", 5], ["off", 1]]);
    // a filter shows plain rows with no group headings
    cleanup();
    const f = render(<JobsList jobs={MOCK_PAGE_JOBS} filter="needs_you" words={words} base={BASE} actions={switches} sheet={null} />);
    expect(f.container.querySelectorAll("[data-group]")).toHaveLength(0); // a filter is plain rows
    expect(f.container.querySelectorAll("[data-job]")).toHaveLength(2);
  });
  it("a named custom job shows its own language, voice and number as chips; a job with none shows no chip row", () => {
    const { container } = render(<JobsList jobs={MOCK_PAGE_JOBS} filter="all" words={words} base={BASE} actions={switches} sheet={null} />);
    const ravi = container.querySelector('[data-job-kind="custom"]') as HTMLElement;
    expect(within(ravi).getByText("Ravi")).toBeInTheDocument();
    expect([...ravi.querySelectorAll("[data-chip]")].map((c) => c.textContent)).toEqual(["English", "Dev voice", "Shop number"]);
    const diwali = [...container.querySelectorAll('[data-job-kind="custom"]')][1] as HTMLElement;
    expect([...diwali.querySelectorAll("[data-chip]")].map((c) => c.textContent)).toEqual(["Telugu", "Ramya voice", "Shop number"]);
    expect(container.querySelector('[data-job-kind="speed_to_lead"] [data-part="job-speaks"]')).toBeNull();
  });
  it("Today: an own message WhatsApp sent back (Needs-you `message_needs_change`) is ONE row that opens Chats > Templates, in plain words; none = no row", () => {
    const { container } = render(<JobsToday jobs={MOCK_PAGE_JOBS} words={words} base={BASE} actions={switches} messagesToChange={1} />);
    const row = container.querySelector('[data-part="need-message"]') as HTMLElement;
    expect(row).toHaveAttribute("href", `${BASE}/chats/templates`);
    expect(row).toHaveTextContent("A message of yours needs a change");
    expect(row).toHaveTextContent("WhatsApp sent it back. Open it to see why and change it.");
    cleanup();
    const two = render(<JobsToday jobs={MOCK_PAGE_JOBS} words={words} base={BASE} actions={switches} messagesToChange={2} />);
    expect(two.container.querySelector('[data-part="need-message"]')).toHaveTextContent("2 of your messages need a change");
    cleanup();
    const none = render(<JobsToday jobs={MOCK_PAGE_JOBS} words={words} base={BASE} actions={switches} />);
    expect(none.container.querySelector('[data-part="need-message"]')).toBeNull();
  });
  it("Today draws no chips (the row stays as it was)", () => {
    const { container } = render(<JobsToday jobs={MOCK_PAGE_JOBS} words={words} base={BASE} actions={switches} />);
    expect(container.querySelector('[data-part="job-speaks"]')).toBeNull();
  });
  it("the Do-Not-Call list is one visible link", () => {
    render(<JobsList jobs={MOCK_PAGE_JOBS} filter="all" words={words} base={BASE} actions={switches} sheet={null} />);
    expect(screen.getByRole("link", { name: /Do-Not-Call list/ })).toHaveAttribute("href", `${BASE}/do-not-call`);
  });
  it("New job opens the sheet; Sales and Viewer (no actions) have no New job button", async () => {
    render(<JobsList jobs={MOCK_PAGE_JOBS} filter="all" words={words} base={BASE} actions={switches} sheet={{ actions: sheetActions(), load: null, open: false }} />);
    fireEvent.click(screen.getByRole("button", { name: "New team member" }));
    expect(await screen.findByRole("dialog", { name: "New team member" })).toBeInTheDocument();
    cleanup();
    render(<JobsList jobs={MOCK_PAGE_JOBS} filter="all" words={words} base={BASE} actions={null} sheet={{ actions: null, load: null, open: false }} />);
    expect(screen.queryByRole("button", { name: "New team member" })).toBeNull();
  });
  it("New job with no ideas read by the page (load null: a shop with jobs, or the read failed) asks for them when the sheet opens", async () => {
    const a = sheetActions();
    render(<JobsList jobs={MOCK_PAGE_JOBS} filter="all" words={words} base={BASE} actions={switches} sheet={{ actions: a, load: null, open: false }} />);
    fireEvent.click(screen.getByRole("button", { name: "New team member" }));
    await waitFor(() => expect(a.load).toHaveBeenCalledTimes(1));
    expect(await screen.findByRole("heading", { name: "Popular for saree shops" })).toBeInTheDocument();
  });
  it("empty: three live cards of the business type, one tap each; nothing else is drawn as a job", async () => {
    const a = sheetActions();
    const { container } = render(<JobsList jobs={[]} filter="all" words={words} base={BASE} actions={switches} sheet={{ actions: a, load: LOAD, open: false }} />);
    await waitFor(() => expect(container.querySelectorAll('[data-part="template-card"]')).toHaveLength(3));
    expect(container.querySelector('[data-empty="jobs"]')).not.toBeNull();
    expect(container.querySelectorAll("[data-job]")).toHaveLength(0);
  });
  it("empty for a role that cannot start jobs, or with no ideas yet: the old plain empty state still works", () => {
    const { container } = render(<JobsList jobs={[]} filter="all" words={words} base={BASE} actions={null} sheet={{ actions: null, load: null, open: false }} />);
    expect(container.querySelector('[data-empty="jobs"]')).toHaveTextContent("No team members here.");
  });
  it("Needs you with nothing in it says so in plain words", () => {
    const calm = MOCK_PAGE_JOBS.filter((j) => j.status === "running");
    const { container } = render(<JobsList jobs={calm} filter="needs_you" words={words} base={BASE} actions={switches} sheet={null} />);
    expect(container.querySelector('[data-empty="jobs"]')).toHaveTextContent("Nothing needs you right now.");
  });
  it("without a sheet (the old flow) New job is still the link to Start a job", () => {
    render(<JobsList jobs={MOCK_PAGE_JOBS} filter="all" words={words} base={BASE} actions={switches} />);
    expect(screen.getByRole("link", { name: "New team member" })).toHaveAttribute("href", `${BASE}/jobs/new`);
  });
  it("the words of the page: heading sub line and Paused", () => {
    expect(words["jobs.page.title"]).toBe("Your AI team");
    expect(words["jobs.page.sub"]).toBe("What your assistant is doing for you");
    expect(words["jobs.filter.paused"]).toBe("Paused {n}");
  });
});

describe("Today: JOBS off or no sheet changes nothing", () => {
  it("without a sheet there is no New job button and no suggestion", () => {
    const { container } = render(<JobsToday jobs={MOCK_JOBS} words={words} base={BASE} actions={switches} />);
    expect(screen.queryByRole("button", { name: "New team member" })).toBeNull();
    expect(container.querySelector('[data-part="festival-suggestion"]')).toBeNull();
    expect(screen.getByRole("link", { name: "See your whole team" })).toHaveAttribute("href", `${BASE}/jobs`);
  });
  it("with a sheet: New job next to Running now, and the festival suggestion only when the calendar has one", async () => {
    const hint = festivalHint([{ season: "diwali", name: { en: "Diwali" }, date: "2026-12-03" }], "en", new Date("2026-11-19T10:00:00"));
    const { container, rerender } = render(<JobsToday jobs={MOCK_JOBS} words={words} base={BASE} actions={switches} sheet={{ actions: sheetActions(), festival: hint }} />);
    expect(screen.getByRole("button", { name: "New team member" })).toBeInTheDocument();
    await waitFor(() => expect(container.querySelector('[data-part="festival-suggestion"]')).not.toBeNull());
    rerender(<JobsToday jobs={MOCK_JOBS} words={words} base={BASE} actions={switches} sheet={{ actions: sheetActions(), festival: null }} />);
    expect(container.querySelector('[data-part="festival-suggestion"]')).toBeNull();
    rerender(<JobsToday jobs={MOCK_JOBS} words={words} base={BASE} actions={null} sheet={{ actions: null, festival: hint }} />);
    expect(screen.queryByRole("button", { name: "New team member" })).toBeNull();
    expect(container.querySelector('[data-part="festival-suggestion"]')).toBeNull();
  });
});
