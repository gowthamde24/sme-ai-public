import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

import { appDict } from "@/i18n/app";
import { parsePracticeCall, parseProspect, parseQuoteDraftMade, parseQuoteDraftPreview, parseSearch } from "@/lib/api/lead-finder";
import { P1, P2, P3, PRACTICE, PROSPECT, PROSPECT_LOW, PROSPECT_READY, QUOTE_DRAFT, QUOTE_DRAFT_MADE, SEARCH_DONE, SEARCH_PLACES, SEARCH_PLANNED } from "@/lib/api/lead-finder-fixtures";

import { FinderBox, type FinderActions } from "./FinderBox";
import { ProspectList, type ListActions } from "./ProspectList";

const words = Object.fromEntries(Object.entries(appDict("en") as Record<string, string>).filter(([k]) => /^(lf|apierr)\./.test(k) || k === "today.state.draft"));
const BASE = "/app/tenants/t";
beforeEach(() => vi.clearAllMocks());

const box = (canApprove: boolean, over: Partial<FinderActions> = {}) => {
  const actions: FinderActions = { plan: vi.fn(async () => ({ ok: true as const, data: parseSearch(SEARCH_PLANNED) })), approve: vi.fn(async () => ({ ok: true as const, data: parseSearch(SEARCH_DONE) })), cancel: vi.fn(async () => ({ ok: true as const, data: parseSearch({ ...SEARCH_PLANNED, state: "cancelled" }) })), ...over };
  render(<FinderBox words={words} canApprove={canApprove} base={BASE} actions={actions} />);
  return actions;
};
const type = (text: string) => {
  fireEvent.change(screen.getByRole("textbox", { name: "Find new retailers in …" }), { target: { value: text } });
  fireEvent.click(screen.getByRole("button", { name: "Plan the search" }));
};

describe("the plan card and the result card", () => {
  it("plans from the owner's words, shows what, where, how many, the cost (₹0 for made-up businesses) and the searches left; OK runs it and shows the result card", async () => {
    const a = box(true);
    type("  find new retailers in Jayanagar ");
    expect(a.plan).toHaveBeenCalledWith("find new retailers in Jayanagar");
    const plan = await screen.findByText("The search plan");
    const card = within(plan.closest("[data-plan-card]") as HTMLElement);
    for (const text of ["saree shops", "Jayanagar Bengaluru", "20 businesses", "₹0", "5", "Made-up businesses for the demo"]) expect(card.getByText(text)).toBeInTheDocument();
    expect(a.approve).not.toHaveBeenCalled();
    fireEvent.click(card.getByRole("button", { name: "OK" }));
    expect(await screen.findByText("Found 18 · 0 call-ready · 11 need you · 7 skipped")).toBeInTheDocument();
    expect(a.approve).toHaveBeenCalledWith(SEARCH_PLANNED.id);
    expect(refresh).toHaveBeenCalled();
    expect(screen.getByRole("link", { name: "Show the ones that need you" })).toHaveAttribute("href", `${BASE}/retailers?status=needs_owner`);
  });
  it("a Google Maps plan says the cost is an estimate and shows Google Maps", async () => {
    box(true, { plan: vi.fn(async () => ({ ok: true as const, data: parseSearch(SEARCH_PLACES) })) });
    type("find saree shops in Jayanagar Bengaluru");
    expect(await screen.findByText("₹29.50 (estimate)")).toBeInTheDocument();
    expect(screen.getByText("Google Maps")).toBeInTheDocument();
  });
  it("a salesperson can plan but not OK: they are told who can, and Cancel only puts the card away", async () => {
    const a = box(false);
    type("find new retailers in Jayanagar");
    expect(await screen.findByText("Only the owner or an admin can OK a search.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "OK" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByText("The search plan")).toBeNull();
    expect(a.cancel).not.toHaveBeenCalled();
  });
  it("Cancel by the owner cancels the plan", async () => {
    const a = box(true);
    type("find new retailers in Jayanagar");
    fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));
    expect(await screen.findByText("Search cancelled. Nothing was searched.")).toBeInTheDocument();
    expect(a.cancel).toHaveBeenCalledWith(SEARCH_PLANNED.id);
  });
  it("empty words are refused on the screen; the API's refusal (not a search, the cap) is shown in words", async () => {
    const a = box(true, { plan: vi.fn(async () => ({ ok: false as const, kind: "invalid" as const, code: "not_a_search", error: "Say what to find and where, for example: find new retailers in Jayanagar." })) });
    type(" ");
    expect(screen.getByRole("alert")).toHaveTextContent("Type what to find and where.");
    expect(a.plan).not.toHaveBeenCalled();
    type("hello");
    expect(await screen.findByText("Say what to find and where, for example: find new retailers in Jayanagar.")).toBeInTheDocument();
  });
  it("a failed search says nothing was billed", async () => {
    box(true, { approve: vi.fn(async () => ({ ok: true as const, data: parseSearch({ ...SEARCH_PLANNED, state: "failed" }) })) });
    type("find new retailers in Jayanagar");
    fireEvent.click(await screen.findByRole("button", { name: "OK" }));
    expect(await screen.findByText(/Nothing was billed and nothing was kept/)).toBeInTheDocument();
  });
});

const list = (canPractice: boolean, over: Partial<ListActions> = {}, rows: unknown[] = [PROSPECT, PROSPECT_LOW, PROSPECT_READY]) => {
  const actions: ListActions = { act: vi.fn(async (ids: string[]) => ({ ok: true as const, data: ids.map((id, i) => (i === 0 ? { id, ok: true, status: "call_ready" as const, error: null } : { id, ok: false, status: null, error: "prospect_state" as const })) })), practice: vi.fn(async () => ({ ok: true as const, data: parsePracticeCall(PRACTICE) })), quoteDraft: vi.fn(async () => ({ ok: true as const, data: { ...parseQuoteDraftPreview(QUOTE_DRAFT), enquiryId: null } })), makeQuoteDraft: vi.fn(async () => ({ ok: true as const, data: parseQuoteDraftMade(QUOTE_DRAFT_MADE) })), ...over };
  render(<ProspectList items={rows.map(parseProspect)} words={words} base={BASE} canPractice={canPractice} langNames={{ en: "English", te: "తెలుగు" }} actions={actions} />);
  return actions;
};
const tick = (name: string) => fireEvent.click(screen.getByRole("checkbox", { name: `Tick ${name}` }));

describe("the bulk buttons", () => {
  it("Call sends the ticked ones and shows the result of each", async () => {
    const a = list(true);
    tick("Sri Lakshmi Sarees");
    tick("Sri Sai Constructions");
    fireEvent.click(screen.getByRole("button", { name: "Call" }));
    expect(a.act).toHaveBeenCalledWith([P1, P2], "call");
    const out = within(await screen.findByRole("status"));
    expect(out.getByText("1 changed, 1 not changed.")).toBeInTheDocument();
    expect(out.getByText("Sri Lakshmi Sarees: now Ready to call")).toBeInTheDocument();
    expect(out.getByText("Sri Sai Constructions: not possible in the state it is in now")).toBeInTheDocument();
    expect(refresh).toHaveBeenCalled();
  });
  it("nothing ticked: nothing is sent", () => {
    const a = list(true);
    fireEvent.click(screen.getByRole("button", { name: "Skip" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Tick at least one business first.");
    expect(a.act).not.toHaveBeenCalled();
  });
  it.each(["Not interested", "Do not call"])("%s asks first (it is for good) and sends only after Yes", async (label) => {
    const a = list(true);
    fireEvent.click(screen.getByRole("checkbox", { name: "Tick all on this page" }));
    fireEvent.click(screen.getByRole("button", { name: label }));
    expect(a.act).not.toHaveBeenCalled();
    expect(screen.getByRole("alertdialog")).toHaveTextContent("Mark 3 for good? They are never called again from this workspace.");
    fireEvent.click(screen.getByRole("button", { name: "No, go back" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: label }));
    fireEvent.click(screen.getByRole("button", { name: "Yes, never call them" }));
    await waitFor(() => expect(a.act).toHaveBeenCalledWith([P1, P2, P3], label === "Do not call" ? "do_not_call" : "not_interested"));
  });
});

describe("the practice call (simulated)", () => {
  it("only on a Ready to call business, and only for the Owner and Admin", () => {
    list(true);
    expect(screen.getAllByText("Practice call")).toHaveLength(1);
    expect(within(document.querySelector(`[data-prospect="${P3}"]`) as HTMLElement).getByText("Practice call")).toBeInTheDocument();
    list(false);
    expect(screen.getAllByText("Practice call")).toHaveLength(1); // the first render's only
  });
  it("runs with the chosen persona and language, and shows the label, the outcome, the summary, the draft quote and what was said", async () => {
    const a = list(true);
    const row = within(document.querySelector(`[data-prospect="${P3}"]`) as HTMLElement);
    fireEvent.click(row.getByText("Practice call"));
    expect(row.getAllByText("Practice call (simulated): nothing was dialled")).toHaveLength(1);
    fireEvent.change(row.getByRole("combobox", { name: "The shopkeeper is" }), { target: { value: "wants_whatsapp" } });
    fireEvent.change(row.getByRole("combobox", { name: "Language" }), { target: { value: "te" } });
    fireEvent.click(row.getByRole("button", { name: "Start the practice call" }));
    expect(a.practice).toHaveBeenCalledWith(P3, "wants_whatsapp", "te");
    const result = within(await row.findByRole("status"));
    expect(result.getByRole("heading", { name: "Practice call (simulated): nothing was dialled" })).toBeInTheDocument();
    expect(result.getByText("Interested: a lead was made on the Lead Desk")).toBeInTheDocument();
    expect(result.getByRole("link", { name: "Open the lead" })).toHaveAttribute("href", `${BASE}/leads/c1c1c1c1-0000-4000-8000-000000000001`);
    expect(result.getByText(/Wants new designs before the wedding season/)).toBeInTheDocument();
    expect(result.getByText("Draft")).toBeInTheDocument();
    expect(result.getByText(/₹18,500 \/ piece/)).toBeInTheDocument();
    expect(result.getByText("you give the price")).toBeInTheDocument();
    expect(result.getByText(/A draft only: the prices come from your catalogue/)).toBeInTheDocument();
    expect(result.getByText("Namaste, I am the AI assistant of Acme Silks.")).toBeInTheDocument();
  });
  it("a refusal is said in words", async () => {
    list(true, { practice: vi.fn(async () => ({ ok: false as const, kind: "conflict" as const, error: "Only a business marked Ready to call can have a practice call." })) });
    const row = within(document.querySelector(`[data-prospect="${P3}"]`) as HTMLElement);
    fireEvent.click(row.getByText("Practice call"));
    fireEvent.click(row.getByRole("button", { name: "Start the practice call" }));
    expect(await row.findByRole("alert")).toHaveTextContent("Only a business marked Ready to call can have a practice call.");
  });
});
