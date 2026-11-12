import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { wordsFor } from "@/i18n/app-words";
import { parseSweepList, parseRuns, type SweepRun } from "@/lib/lead-finder/sweeps";

const nav = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: nav.refresh, push: vi.fn() }) }));
vi.mock("./LazySweep", async () => {
  const m = await import("./SweepControls");
  return { SweepAdd: m.SweepAdd, SweepControls: m.SweepControls };
});

import { SweepControls, SweepAdd } from "./SweepControls";
import { SweepPanel } from "./SweepPanel";

const W = wordsFor("en", ["sw.", "lf.find."]);
const ID = "5e1e0000-0000-4000-8000-000000000001";
const RUN = (over: Record<string, unknown> = {}) => ({ id: "5e1e0000-0000-4000-8000-0000000000a1", sweep_id: ID, state: "done", skip_reason: null, search_id: null, started_at: "2026-11-09T01:30:00Z", finished_at: "2026-11-09T01:30:40Z", cost_paise: 0, counts: { found: 20, new: 6, duplicates: 14, needs_owner: 4 }, new_since_last_run: 6, trigger: "schedule", ...over });
const SWEEP = (over: Record<string, unknown> = {}) => ({ id: ID, query: "saree shops", area: "Jayanagar Bengaluru", max_results: 20, weekday: 1, hour: 7, enabled: true, provider: "fixture", est_cost_paise: 0, cost_is_estimate: false, attribution: null, next_run_at: "2026-11-16T01:30:00Z", last_run: RUN(), created_at: "2026-11-01T00:00:00Z", ...over });
const read = (items: unknown[], runs: Record<string, SweepRun[]> = {}, budget = 0) => ({ ...(parseSweepList({ items, max_sweeps: 5, weekly_budget_paise: budget }) as NonNullable<ReturnType<typeof parseSweepList>>), runs });
const ok = { ok: true as const, data: {} };
const CARD = (over: Record<string, unknown> = {}) => ({ ok: true as const, data: { query: "retailers", area: "Jayanagar", maxResults: 10, weekday: 3, hour: 18, provider: "fixture" as const, estCostPaise: 0, costIsEstimate: false, attribution: null, nextRunAt: "2026-11-12T12:30:00Z", weeklyBudgetPaise: 0, budgetLeftPaise: 0, fitsBudget: true, sweepsUsed: 2, maxSweeps: 5, ...over } });
const actions = () => ({ preview: vi.fn<(input: unknown) => Promise<never>>(async () => CARD() as never), add: vi.fn(async () => ok), change: vi.fn(async () => ok), run: vi.fn(async () => ok), remove: vi.fn(async () => ok) });
afterEach(() => {
  cleanup();
  nav.refresh.mockClear();
});

describe("Weekly search on the Prospects page", () => {
  it("each search says when it runs, what the last run found, and that nobody is called; the test mode says it is made up", () => {
    render(<SweepPanel read={read([SWEEP()])} w={W} lang="en" canChange demo actions={actions()} settingsHref="/s" />);
    const sec = screen.getByRole("region", { name: "Weekly search" });
    expect(sec).toHaveTextContent("Nobody is called by a weekly search.");
    expect(sec).toHaveTextContent("Test mode: these weekly searches are made up.");
    const card = sec.querySelector(`[data-sweep="${ID}"]`) as HTMLElement;
    expect(card).toHaveTextContent("saree shops · Jayanagar Bengaluru");
    expect(card).toHaveTextContent("Runs every Monday at 07:00");
    expect(card).toHaveTextContent("up to 20 businesses");
    expect(card).toHaveTextContent("6 new businesses this week · 20 found · 14 already known · 4 need you");
    expect(card).toHaveTextContent("Made-up businesses: no cost.");
    expect(within(card).getByText("Running")).toBeInTheDocument();
    expect(card).toHaveTextContent("Next run:");
    expect(sec).toHaveTextContent("Weekly budget for Google Maps searches: ₹0");
  });
  it("a paused search says so and has no next run; a search that has not run says so; a skipped run says why in words", () => {
    render(<SweepPanel read={read([SWEEP({ enabled: false, last_run: null, next_run_at: null }), SWEEP({ id: "5e1e0000-0000-4000-8000-000000000002", last_run: RUN({ id: "5e1e0000-0000-4000-8000-0000000000a2", sweep_id: "5e1e0000-0000-4000-8000-000000000002", state: "skipped", skip_reason: "provider_down", counts: null, new_since_last_run: 0 }) })])} w={W} lang="en" canChange demo={false} actions={actions()} settingsHref="/s" />);
    const cards = document.querySelectorAll("[data-sweep]");
    expect(cards[0]).toHaveTextContent("Paused. It does not run until you resume it.");
    expect(cards[0]).toHaveTextContent("It has not run yet.");
    expect(cards[0]).not.toHaveTextContent("Next run:");
    expect(cards[1]).toHaveTextContent("It did not run: Google Maps did not answer.");
    expect(document.querySelector("[data-demo]")).toBeNull();
  });
  it("a Google Maps search shows its estimate and, with no budget, that it runs only after one is set", () => {
    render(<SweepPanel read={read([SWEEP({ provider: "places", est_cost_paise: 45000, cost_is_estimate: true, attribution: "Google Maps" })])} w={W} lang="en" canChange demo={false} actions={actions()} settingsHref="/s" />);
    const card = document.querySelector("[data-sweep]") as HTMLElement;
    expect(card).toHaveTextContent("About ₹450 a week (an estimate). It runs only after you set a weekly budget. · Google Maps");
  });
  it("earlier weeks are listed, newest first, with the ones the owner ran said so", () => {
    const runs = parseRuns({ items: [RUN(), RUN({ id: "5e1e0000-0000-4000-8000-0000000000a3", started_at: "2026-11-02T01:30:00Z", new_since_last_run: 1, trigger: "owner" })] }) as SweepRun[];
    render(<SweepPanel read={read([SWEEP()], { [ID]: runs })} w={W} lang="en" canChange demo actions={actions()} settingsHref="/s" />);
    const d = document.querySelector("details") as HTMLElement;
    expect(d).toHaveTextContent("1 new business this week (you ran it)");
  });
  it("Sales read it and have no buttons; the Owner and an Admin have them; at the most allowed there is no Add", () => {
    render(<SweepPanel read={read([SWEEP()])} w={W} lang="en" canChange={false} demo actions={actions()} settingsHref="/s" />);
    expect(screen.queryByRole("button")).toBeNull();
    cleanup();
    render(<SweepPanel read={read([SWEEP()])} w={W} lang="en" canChange demo actions={actions()} settingsHref="/s" />);
    expect(screen.getByRole("button", { name: "Add a weekly search" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Pause" })).toBeInTheDocument();
    cleanup();
    const five = Array.from({ length: 5 }, (_, i) => SWEEP({ id: `5e1e0000-0000-4000-8000-00000000000${i + 1}` }));
    render(<SweepPanel read={read(five)} w={W} lang="en" canChange demo actions={actions()} settingsHref="/s" />);
    expect(screen.queryByRole("button", { name: "Add a weekly search" })).toBeNull();
    expect(screen.getByText("You have the most weekly searches allowed. Remove one to add another.")).toBeInTheDocument();
  });
});

describe("Add a weekly search", () => {
  it("asks for the words, the day, the time and the most results; says what is wrong; then ONE clear second step before anything is sent", async () => {
    const a = actions();
    render(<SweepAdd w={W} add={a.add} preview={a.preview} settingsHref="/app/tenants/T/settings?section=leadfinder" />);
    fireEvent.click(screen.getByRole("button", { name: "Add a weekly search" }));
    fireEvent.click(screen.getByRole("button", { name: "Check and continue" }));
    expect(screen.getByText("Type what to find and where.")).toBeInTheDocument();
    expect(a.add).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("What to look for, and where"), { target: { value: "find new retailers in Jayanagar" } });
    fireEvent.change(screen.getByLabelText("Day"), { target: { value: "3" } });
    fireEvent.change(screen.getByLabelText("Time (India time)"), { target: { value: "18" } });
    fireEvent.change(screen.getByLabelText("Most businesses"), { target: { value: "10" } });
    fireEvent.click(screen.getByRole("button", { name: "Check and continue" }));
    await waitFor(() => expect(screen.getByText("This search will run by itself every week.")).toBeInTheDocument());
    expect(a.preview).toHaveBeenCalledWith({ text: "find new retailers in Jayanagar", weekday: 3, hour: 18, maxResults: 10 });
    expect(screen.getByText("Runs every Wednesday at 18:00 · retailers, Jayanagar · up to 10 businesses")).toBeInTheDocument(); // the card is what the API understood
    const prev = document.querySelector("[data-part=sweep-preview]") as HTMLElement;
    expect(prev).toHaveTextContent("Made-up businesses: no cost.");
    expect(prev).toHaveTextContent("First run:");
    expect(prev).toHaveTextContent("That makes 3 of 5 weekly searches.");
    expect(a.add).not.toHaveBeenCalled(); // the preview stores nothing
    expect(screen.getByText(/Every Wednesday at 18:00 it looks for up to 10 businesses/)).toBeInTheDocument();
    expect(screen.getByText(/Nobody is called\./)).toBeInTheDocument();
    fireEvent.click(await screen.findByRole("button", { name: "Yes, run it every week" }));
    await waitFor(() => expect(a.add).toHaveBeenCalledWith({ text: "find new retailers in Jayanagar", weekday: 3, hour: 18, maxResults: 10 }));
    await waitFor(() => expect(nav.refresh).toHaveBeenCalled());
  });
  it("a Google Maps search that does not fit the weekly budget says so, with the way to Settings; creating is still possible", async () => {
    const a = actions();
    a.preview.mockResolvedValueOnce(CARD({ provider: "places", estCostPaise: 45000, costIsEstimate: true, attribution: "Google Maps", fitsBudget: false, budgetLeftPaise: 0, weeklyBudgetPaise: 0 }) as never);
    render(<SweepAdd w={W} add={a.add} preview={a.preview} settingsHref="/app/tenants/T/settings?section=leadfinder" />);
    fireEvent.click(screen.getByRole("button", { name: "Add a weekly search" }));
    fireEvent.change(screen.getByLabelText("What to look for, and where"), { target: { value: "find shops in Eluru" } });
    fireEvent.click(screen.getByRole("button", { name: "Check and continue" }));
    await screen.findByText("This search will run by itself every week.");
    const prev = document.querySelector("[data-part=sweep-preview]") as HTMLElement;
    expect(prev).toHaveTextContent("About ₹450 a week (an estimate). · Google Maps");
    expect(prev).toHaveTextContent("This does not fit this week's budget (₹0 left). It will be skipped until the budget allows it.");
    expect(within(prev).getByRole("link", { name: "Set a weekly budget first (Settings > Lead Finder)" })).toHaveAttribute("href", "/app/tenants/T/settings?section=leadfinder");
    expect(screen.getByRole("button", { name: "Yes, run it every week" })).toBeEnabled();
  });
  it("a refused preview (the most weekly searches) is said on the form and the second step never shows", async () => {
    const a = actions();
    a.preview.mockResolvedValueOnce({ ok: false, error: "You have the most weekly searches allowed. Remove one to add another." } as never);
    render(<SweepAdd w={W} add={a.add} preview={a.preview} settingsHref="/x" />);
    fireEvent.click(screen.getByRole("button", { name: "Add a weekly search" }));
    fireEvent.change(screen.getByLabelText("What to look for, and where"), { target: { value: "find shops in Eluru" } });
    fireEvent.click(screen.getByRole("button", { name: "Check and continue" }));
    expect(await screen.findByText("You have the most weekly searches allowed. Remove one to add another.")).toBeInTheDocument();
    expect(screen.queryByText("This search will run by itself every week.")).toBeNull();
  });
  it("Go back keeps what was typed; a refusal comes back in plain words on the form", async () => {
    const a = actions();
    a.add.mockResolvedValueOnce({ ok: false as never, error: "You have the most weekly searches allowed. Remove one to add another." } as never);
    render(<SweepAdd w={W} add={a.add} preview={a.preview} settingsHref="/app/tenants/T/settings?section=leadfinder" />);
    fireEvent.click(screen.getByRole("button", { name: "Add a weekly search" }));
    fireEvent.change(screen.getByLabelText("What to look for, and where"), { target: { value: "find shops in Eluru" } });
    fireEvent.click(screen.getByRole("button", { name: "Check and continue" }));
    fireEvent.click(await screen.findByRole("button", { name: "Go back" }));
    expect((screen.getByLabelText("What to look for, and where") as HTMLTextAreaElement).value).toBe("find shops in Eluru");
    fireEvent.click(screen.getByRole("button", { name: "Check and continue" }));
    fireEvent.click(await screen.findByRole("button", { name: "Yes, run it every week" }));
    expect(await screen.findByText("You have the most weekly searches allowed. Remove one to add another.")).toBeInTheDocument();
    expect(screen.queryByText("This search will run by itself every week.")).toBeNull(); // back on the form, not stuck on the second step
    expect(nav.refresh).not.toHaveBeenCalled();
  });
});

describe("the buttons of one weekly search", () => {
  const mount = (over: Partial<{ enabled: boolean }> = {}) => {
    const a = actions();
    render(<SweepControls w={W} sweepId={ID} enabled={over.enabled ?? true} weekday={1} hour={7} maxResults={20} actions={{ change: a.change, run: a.run, remove: a.remove }} />);
    return a;
  };
  it("Pause and Resume send enabled false / true and read the page again", async () => {
    const a = mount();
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    await waitFor(() => expect(a.change).toHaveBeenCalledWith(ID, { enabled: false }));
    expect(nav.refresh).toHaveBeenCalled();
    cleanup();
    const b = mount({ enabled: false });
    fireEvent.click(screen.getByRole("button", { name: "Resume" }));
    await waitFor(() => expect(b.change).toHaveBeenCalledWith(ID, { enabled: true }));
  });
  it("Run now and Remove ask first, in plain words; only the yes sends", async () => {
    const a = mount();
    fireEvent.click(screen.getByRole("button", { name: "Run now" }));
    expect(screen.getByText("Run it now? This counts as one search today. Nobody is called.")).toBeInTheDocument();
    expect(a.run).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(a.run).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Run now" }));
    fireEvent.click(screen.getByRole("button", { name: "Yes, run it now" }));
    await waitFor(() => expect(a.run).toHaveBeenCalledWith(ID));
    expect(await screen.findByRole("status")).toHaveTextContent("It ran. The new businesses are in Prospects.");
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(screen.queryByText("It ran. The new businesses are in Prospects.")).toBeNull(); // the old message is not left standing
    expect(screen.getByText("Remove this weekly search? What it already found stays in Prospects.")).toBeInTheDocument();
    expect(a.remove).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Yes, remove it" }));
    await waitFor(() => expect(a.remove).toHaveBeenCalledWith(ID));
  });
  it("Change day and time sends the new day, hour and cap; a refusal (the day's cap) says so", async () => {
    const a = mount();
    fireEvent.click(screen.getByRole("button", { name: "Change day and time" }));
    fireEvent.change(screen.getByLabelText("Day"), { target: { value: "5" } });
    fireEvent.change(screen.getByLabelText("Time (India time)"), { target: { value: "9" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(a.change).toHaveBeenCalledWith(ID, { weekday: 5, hour: 9, maxResults: 20 }));
    cleanup();
    const b = actions();
    b.run.mockResolvedValueOnce({ ok: false as never, error: "Today's searches are used up. Try again tomorrow, or change the limit in Settings." } as never);
    render(<SweepControls w={W} sweepId={ID} enabled weekday={1} hour={7} maxResults={20} actions={{ change: b.change, run: b.run, remove: b.remove }} />);
    fireEvent.click(screen.getByRole("button", { name: "Run now" }));
    fireEvent.click(screen.getByRole("button", { name: "Yes, run it now" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Today's searches are used up.");
  });
});
