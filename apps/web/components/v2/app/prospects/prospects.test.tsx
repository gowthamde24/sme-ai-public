import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

import { appDict } from "@/i18n/app";
import { parsePracticeCall, parseProspect, parseQuoteDraftMade, parseQuoteDraftPreview, parseSearch } from "@/lib/api/lead-finder";
import { P1, P2, P3, PRACTICE, PROSPECT, PROSPECT_LOW, PROSPECT_READY, QUOTE_DRAFT, QUOTE_DRAFT_MADE, SEARCH_DONE, SEARCH_PLACES, SEARCH_PLANNED } from "@/lib/api/lead-finder-fixtures";

import { FinderBox, type FinderActions } from "./FinderBox";
import { ProspectList, type ListActions } from "./ProspectList";
import { FinderRadar } from "./FinderRadar";
import { ProspectCards, type CardActions } from "./ProspectCards";
import { buildRadar } from "@/lib/lead-finder/radar";

const words = Object.fromEntries(Object.entries(appDict("en") as Record<string, string>).filter(([k]) => /^(lf|apierr)\./.test(k) || k === "today.state.draft" || k === "nav.item.v4d-finder"));
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

// app v4 part 5: the cards and the radar (from app-Finder.png)
describe("the Lead Finder's cards (app v4)", () => {
  const rows = [parseProspect(PROSPECT), parseProspect({ ...PROSPECT_LOW, status: "skipped", decision_reason: "fit_low" }), parseProspect(PROSPECT_READY)];
  const ok = (ids: string[], status: string) => ({ ok: true as const, data: ids.map((id) => ({ id, ok: true, status: status as never, error: null })) });
  const cards = (over: Partial<CardActions> = {}, items = rows) => {
    const actions: CardActions = {
      act: vi.fn(async (ids: string[], action: string) => ok(ids, action === "call" ? "call_ready" : "skipped")),
      practice: vi.fn(),
      quoteDraft: vi.fn(),
      makeQuoteDraft: vi.fn(),
      planLikeThis: vi.fn(async () => ({ ok: true as const, data: parseSearch(SEARCH_PLANNED) })),
      approve: vi.fn(async () => ({ ok: true as const, data: parseSearch(SEARCH_DONE) })),
      cancel: vi.fn(async () => ({ ok: true as const, data: parseSearch({ ...SEARCH_PLANNED, state: "cancelled" }) })),
      ...over,
    } as never;
    render(<ProspectCards items={items} words={words} base={BASE} canPractice canSearch langNames={{ en: "English", te: "తెలుగు" }} actions={actions} />);
    return actions;
  };
  const card = (id: string) => within(document.querySelector(`[data-prospect="${id}"]`) as HTMLElement);

  it("each shop has its decision chip and, where the owner decides, Call and Not now on one line; a shop that is ready to call has neither (it has the practice call)", () => {
    cards();
    expect(card(P1).getByText("Ask you first")).toBeInTheDocument();
    expect(card(P1).getByRole("button", { name: "Call" })).toBeInTheDocument();
    expect(card(P1).getByRole("button", { name: "Not now" })).toBeInTheDocument();
    expect(card(P2).getByText("Skip")).toBeInTheDocument();
    expect(card(P2).getByRole("button", { name: "Call" })).toBeInTheDocument(); // the owner may say yes to a skipped one
    expect(card(P3).getByText("Call now")).toBeInTheDocument();
    expect(card(P3).queryByRole("button", { name: "Not now" })).toBeNull();
  });
  it("Call is the owner's yes and Not now asks again tomorrow, for that shop only; the card says what it is now", async () => {
    const a = cards();
    fireEvent.click(card(P1).getByRole("button", { name: "Call" }));
    await waitFor(() => expect(a.act).toHaveBeenCalledWith([P1], "call"));
    expect(await card(P1).findByRole("status")).toHaveTextContent("Sri Lakshmi Sarees: now Ready to call");
    fireEvent.click(card(P2).getByRole("button", { name: "Not now" }));
    await waitFor(() => expect(a.act).toHaveBeenLastCalledWith([P2], "later"));
    expect(refresh).toHaveBeenCalled();
  });
  it("Skip is under More, and Not interested and Do not call (for good) ask once more before they go through", async () => {
    const a = cards();
    fireEvent.click(card(P1).getByText("More"));
    fireEvent.click(card(P1).getByRole("button", { name: "Not interested" }));
    expect(a.act).not.toHaveBeenCalled();
    expect(card(P1).getByRole("alertdialog")).toHaveTextContent("never called again");
    fireEvent.click(card(P1).getByRole("button", { name: "No, go back" }));
    expect(card(P1).queryByRole("alertdialog")).toBeNull();
    fireEvent.click(card(P1).getByRole("button", { name: "Do not call" }));
    fireEvent.click(card(P1).getByRole("button", { name: "Yes, never call them" }));
    await waitFor(() => expect(a.act).toHaveBeenCalledWith([P1], "do_not_call"));
  });
  it('"Call all suggested shops" says yes to the ones waiting for the owner\'s OK, after one confirm', async () => {
    const a = cards();
    fireEvent.click(screen.getByRole("button", { name: "Call all suggested shops (1)" }));
    expect(a.act).not.toHaveBeenCalled();
    expect(screen.getByRole("alertdialog")).toHaveTextContent("Say yes to calling these 1 shops?");
    fireEvent.click(screen.getByRole("button", { name: "Not yet" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Call all suggested shops (1)" }));
    fireEvent.click(screen.getByRole("button", { name: "Yes, call 1" }));
    await waitFor(() => expect(a.act).toHaveBeenCalledWith([P1], "call"));
  });
  it('no button at all when nothing waits for the owner', () => {
    cards({}, [parseProspect(PROSPECT_READY)]);
    expect(screen.queryByRole("button", { name: /Call all suggested/ })).toBeNull();
  });
  it('"Find more like this shop" opens the plan card under the shop; nothing is searched until OK; OK reads the page again', async () => {
    const a = cards();
    fireEvent.click(card(P1).getByRole("button", { name: "Find more like this shop" }));
    expect(a.planLikeThis).toHaveBeenCalledWith(P1);
    const plan = await card(P1).findByText("The search plan");
    expect(a.approve).not.toHaveBeenCalled();
    fireEvent.click(within(plan.closest("[data-plan-card]") as HTMLElement).getByRole("button", { name: "OK" }));
    await waitFor(() => expect(a.approve).toHaveBeenCalledWith(SEARCH_PLANNED.id));
    expect(await card(P1).findByText("Found 18 · 0 call-ready · 11 need you · 7 skipped")).toBeInTheDocument();
  });
  it("a refusal of the plan is said in words under the shop; a shop with no type has no such button", async () => {
    cards({ planLikeThis: vi.fn(async () => ({ ok: false as const, kind: "unavailable" as const, error: "" })) });
    fireEvent.click(card(P1).getByRole("button", { name: "Find more like this shop" }));
    expect(await card(P1).findByRole("alert")).toBeInTheDocument();
    document.body.innerHTML = "";
    cards({}, [parseProspect({ ...PROSPECT, category: null })]);
    expect(screen.queryByRole("button", { name: "Find more like this shop" })).toBeNull();
  });
});

describe("the radar (app v4)", () => {
  const spread = [PROSPECT, PROSPECT_READY, PROSPECT_LOW].map((p, i) => parseProspect({ ...p, lat: 12.9 + i * 0.03, lng: 77.5 + (i % 2) * 0.04 }));
  it("draws a pin for each positioned business, the best few named, rings in kilometres, and what it checked", () => {
    const radar = buildRadar(spread)!;
    render(<FinderRadar radar={radar} w={words} around="Hyderabad" checked={{ checked: 35, worth: 1 }} />);
    expect(document.querySelectorAll("[data-pin]")).toHaveLength(3);
    expect(screen.getByText("Searching around Hyderabad")).toBeInTheDocument();
    expect(screen.getByText("Checked 35 businesses. 1 worth a call.")).toBeInTheDocument();
    expect(screen.getByText("Rings are kilometres from the middle of the businesses it found.")).toBeInTheDocument();
    expect(screen.getAllByText(/ km$/).length).toBe(3);
    expect(document.querySelector("[data-pin]")?.textContent).toBe("Jayanagar");
  });
});
