import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const nav = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: nav.push, replace: vi.fn(), refresh: vi.fn() }) }));
vi.mock("./LazySearchPlan", async () => ({ SearchPlan: (await import("./SearchPlan")).SearchPlan }));

import { appDict } from "@/i18n/app";
import { parsePlan } from "@/lib/api/jobs-parse";
import { mockPlan, mockStartPlan, mockStartedFor, mockSuggestions, WIRE_RESEARCHER_PLAN } from "@/lib/jobs/plan-mock";
import type { JobPlan, PlanInput, SearchPatch } from "@/lib/jobs/plan";

import { NewJob, type NewJobActions } from "./NewJob";
import { PlanCard, type PlanCardState } from "./PlanCard";
import { messagesCostText } from "./plan-text";
import { makeT } from "../words";

afterEach(cleanup);
beforeEach(() => nav.push.mockClear());
const words = Object.fromEntries(Object.entries(appDict("en") as Record<string, string>).filter(([k]) => k.startsWith("jobs.")));
const t = makeT(words);
const BASE = "/app/tenants/t";
const IDLE: PlanCardState = { starting: false, testing: false, swapping: false, note: null, error: null, waiting: null, quiet: false };
const researcher = (over: Parameters<typeof WIRE_RESEARCHER_PLAN>[0] = {}): JobPlan => parsePlan(WIRE_RESEARCHER_PLAN(over));
const drawCard = (plan: JobPlan, over: { onSearch?: (p: SearchPatch) => void; onStart?: () => void; state?: Partial<PlanCardState> } = {}) =>
  render(<PlanCard plan={plan} words={words} base={BASE} state={{ ...IDLE, ...over.state }} onStart={over.onStart ?? vi.fn()} onSwap={vi.fn()} onChange={vi.fn()} onTest={vi.fn()} onSearch={over.onSearch} />);

describe("the researcher plan card (Lead Finder): three plain choices, no 'what it says'", () => {
  it("draws the area (the shop's town as the default), how many and the fit bar as labelled fields (no sentence with a blank); no who, says, when or test", () => {
    drawCard(researcher(), { onSearch: vi.fn() });
    const card = within(screen.getByRole("article"));
    expect(card.getByRole("heading", { name: "Find new customers: saree shops and boutiques" })).toBeInTheDocument();
    expect((card.getByRole("textbox", { name: /Where to look/ }) as HTMLInputElement).value).toBe("Vijayawada");
    expect((card.getByRole("combobox", { name: /How many businesses to find/ }) as HTMLSelectElement).value).toBe("10");
    expect(Array.from((card.getByRole("combobox", { name: /How many businesses to find/ }) as HTMLSelectElement).options).map((o) => o.value)).toEqual(["5", "10", "20"]);
    expect((card.getByRole("combobox", { name: /Keep only the ones that fit at least/ }) as HTMLSelectElement).value).toBe("70");
    expect(Array.from((card.getByRole("combobox", { name: /Keep only the ones that fit at least/ }) as HTMLSelectElement).options).map((o) => o.value)).toEqual(["60", "70", "80", "90"]);
    expect(card.getByText(/Free searches left this month: 2 of 3/)).toBeInTheDocument();
    expect(card.getByRole("button", { name: "Start" })).toBeEnabled();
    expect(card.queryByText("Who")).toBeNull();
    expect(document.querySelector('[data-part="plan-says"]')).toBeNull();
    expect(document.querySelector('[data-part="plan-when"]')).toBeNull();
    expect(card.queryByRole("button", { name: /test/i })).toBeNull();
    expect(card.getByText(/You contact them yourself/)).toBeInTheDocument();
  });
  it("changing a choice sends ONLY what changed", () => {
    const onSearch = vi.fn();
    drawCard(researcher(), { onSearch });
    fireEvent.change(screen.getByRole("combobox", { name: /How many businesses to find/ }), { target: { value: "20" } });
    expect(onSearch).toHaveBeenLastCalledWith({ results: 20 });
    fireEvent.change(screen.getByRole("combobox", { name: /Keep only the ones that fit at least/ }), { target: { value: "90" } });
    expect(onSearch).toHaveBeenLastCalledWith({ fitBar: 90 });
    const area = screen.getByRole("textbox", { name: /Where to look/ });
    fireEvent.change(area, { target: { value: "Guntur" } });
    expect(onSearch).toHaveBeenCalledTimes(2); // typing sends nothing
    fireEvent.keyDown(area, { key: "Enter" });
    expect(onSearch).toHaveBeenLastCalledWith({ area: "Guntur" });
    expect(onSearch).toHaveBeenCalledTimes(3);
  });
  it("the area goes when the box is left; an empty box or an unchanged one sends nothing and puts the plan's own area back", () => {
    const onSearch = vi.fn();
    drawCard(researcher(), { onSearch });
    const area = screen.getByRole("textbox", { name: /Where to look/ }) as HTMLInputElement;
    fireEvent.change(area, { target: { value: "  " } });
    fireEvent.blur(area);
    expect(area.value).toBe("Vijayawada");
    fireEvent.change(area, { target: { value: "Vijayawada" } });
    fireEvent.blur(area);
    expect(onSearch).not.toHaveBeenCalled();
    fireEvent.change(area, { target: { value: "Tenali" } });
    fireEvent.blur(area);
    expect(onSearch).toHaveBeenCalledWith({ area: "Tenali" });
  });
  it("with search_limit the Start is replaced by a quiet line (no purchase yet), and the card is still the card", () => {
    const onStart = vi.fn();
    drawCard(researcher({ left: 0 }), { onSearch: vi.fn(), onStart });
    const card = within(screen.getByRole("article"));
    expect(card.queryByRole("button", { name: "Start" })).toBeNull();
    expect(card.getByText("No free search left this month.")).toBeInTheDocument();
    expect(card.getByText(/Free searches left this month: 0 of 3/)).toBeInTheDocument();
    expect(card.queryByRole("button", { name: /buy/i })).toBeNull();
    expect(document.querySelector('[data-part="plan-blocked"]')).toBeNull();
    expect(onStart).not.toHaveBeenCalled();
  });
  it("an empty area blocks Start (area_needed): the card says to type one, keeps the choices, and typing an area goes to the API", () => {
    const onStart = vi.fn();
    const onSearch = vi.fn();
    const plan = { ...researcher(), search: { ...researcher().search!, area: "" }, blockers: ["area_needed"] };
    drawCard(plan, { onSearch, onStart });
    const card = within(screen.getByRole("article"));
    expect(card.queryByRole("button", { name: "Start" })).toBeNull();
    expect(card.getByText(/Type the area to search in/)).toBeInTheDocument();
    expect(document.querySelector('[data-part="plan-blocked"]')).toBeNull(); // still the search card, not the plain blocked one
    const area = screen.getByRole("textbox", { name: /Where to look/ }) as HTMLInputElement;
    expect(area.value).toBe("");
    fireEvent.change(area, { target: { value: "Tenali" } });
    fireEvent.blur(area);
    expect(onSearch).toHaveBeenCalledWith({ area: "Tenali" });
    expect(onStart).not.toHaveBeenCalled();
  });
  it("without a handler the choices are read, not changed", () => {
    drawCard(researcher());
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.getByText("Vijayawada")).toBeInTheDocument();
  });
  it("a search plan blocked for another reason is the plain blocked card", () => {
    const plan = { ...researcher(), blockers: ["search_limit", "no_number"] };
    drawCard(plan);
    expect(document.querySelector('[data-part="plan-blocked"]')).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Start" })).toBeNull();
  });
  it("Start asks for the Owner's OK (kind search): the waiting box replaces it", () => {
    drawCard(researcher(), { state: { waiting: "search" } });
    expect(document.querySelector('[data-part="plan-waiting"]')).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Start" })).toBeNull();
  });
});

describe("the researcher plan inside the Start a job page: a change calls PATCH and draws the plan that comes back", () => {
  const acts = (over: Partial<NewJobActions> = {}): NewJobActions => ({
    plan: vi.fn(async (input: PlanInput) => ({ ok: true as const, data: mockPlan(input) })),
    start: vi.fn(async (planId: string) => ({ ok: true as const, data: mockStartPlan(planId) })),
    startSuggestion: vi.fn(async (kind) => ({ ok: true as const, data: mockStartedFor(kind) })),
    test: vi.fn(async (_id: string, channel) => ({ ok: true as const, data: { channel, mock: true, minutesUsed: 0 } })),
    ...over,
  });
  const draw = (a: NewJobActions) => render(<NewJob words={words} base={BASE} actions={a} suggestions={mockSuggestions(null).items} heading={null} initialPlan={researcher()} />);
  it("the whole plan comes back and replaces the card (same plan id); nothing starts", async () => {
    const search = vi.fn(async (_id: string, patch: SearchPatch) => ({ ok: true as const, data: researcher({ results: patch.results ?? 10, left: 0 }) }));
    const a = acts({ search });
    draw(a);
    fireEvent.change(await screen.findByRole("combobox", { name: /How many businesses to find/ }), { target: { value: "5" } });
    await waitFor(() => expect(search).toHaveBeenCalledWith("plan-researcher", { results: 5 }));
    await waitFor(() => expect(screen.getByText("No free search left this month.")).toBeInTheDocument());
    expect((screen.getByRole("combobox", { name: /How many businesses to find/ }) as HTMLSelectElement).value).toBe("5");
    expect(a.start).not.toHaveBeenCalled();
  });
  it("a refusal is shown on the card and the plan stays as it was", async () => {
    const search = vi.fn(async () => ({ ok: false as const, kind: "unavailable" as const, error: "This plan has expired: say it again." }));
    draw(acts({ search }));
    fireEvent.change(await screen.findByRole("combobox", { name: /How many businesses to find/ }), { target: { value: "20" } });
    expect(await screen.findByRole("alert")).toHaveTextContent("This plan has expired: say it again.");
    expect((screen.getByRole("combobox", { name: /How many businesses to find/ }) as HTMLSelectElement).value).toBe("10");
  });
});

describe("Cost.messages on the plan card", () => {
  const withMessages = (messages: unknown): JobPlan => parsePlan({ ...(WIRE_RESEARCHER_PLAN() as Record<string, unknown>), search: null, says: [{ language: "en", channel: "whatsapp", text: "Hi" }], who: { basis: { code: "consented_messages", params: { days: 30, count: 5 } }, total: 5, eligible: 5, excluded: [] }, cost: { minutes: 0, minutes_included: 60, rupees: null, messages } });
  it("'Included in your plan' only when there are messages and they are included", () => {
    expect(messagesCostText(t, withMessages({ count: 5, rupees: null, included: true }))).toBe("Messages: included in your plan.");
    expect(messagesCostText(t, withMessages({ count: 0, rupees: null, included: true }))).toBeNull();
    expect(messagesCostText(t, withMessages({ count: 5, rupees: null, included: false }))).toBeNull();
    expect(messagesCostText(t, withMessages(null))).toBeNull();
    expect(messagesCostText(t, withMessages(undefined))).toBeNull();
  });
  it("a rupee amount shows with the rupee formatter and (GST extra); count 0 shows nothing at all", () => {
    expect(messagesCostText(t, withMessages({ count: 1200, rupees: 12500, included: false }))).toBe("Messages: about ₹12,500 (GST extra).");
    expect(messagesCostText(t, withMessages({ count: 3, rupees: 8, included: false }))).toBe("Messages: about ₹8 (GST extra).");
    expect(messagesCostText(t, withMessages({ count: 0, rupees: 500, included: false }))).toBeNull();
  });
  it("it is drawn inside the Cost part of the card", () => {
    drawCard(withMessages({ count: 5, rupees: null, included: true }));
    expect(within(document.querySelector('[data-part="plan-cost"]') as HTMLElement).getByText("Messages: included in your plan.")).toBeInTheDocument();
    cleanup();
    drawCard(withMessages({ count: 0, rupees: null, included: true }));
    expect(document.querySelector('[data-part="plan-cost-messages"]')).toBeNull();
  });
});
