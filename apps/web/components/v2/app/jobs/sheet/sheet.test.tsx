import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const nav = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: nav.push, replace: vi.fn(), refresh: vi.fn() }) }));

import { appDict } from "@/i18n/app";
import { parseNewJobSheet } from "@/lib/api/job-templates";
import { festivalHint } from "@/lib/jobs/festival";
import { mockPlan, mockStartPlan } from "@/lib/jobs/plan-mock";
import type { PlanInput } from "@/lib/jobs/plan";
import { wireNewJobSheet } from "@/lib/jobs/template-fixtures";
import type { JobTemplate, SheetLoad } from "@/lib/jobs/templates";

import { FestivalSuggestion } from "./FestivalSuggestion";
import { JobsEmpty } from "./JobsEmpty";
import NewJobSheet from "./NewJobSheet";
import { NewJobButton } from "./NewJobButton";
import { TemplateCard, type CardContext } from "./TemplateCard";
import type { SheetActions } from "./types";

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});
beforeEach(() => nav.push.mockClear());
const words = Object.fromEntries(Object.entries(appDict("en") as Record<string, string>).filter(([k]) => k.startsWith("jobs.")));
const BASE = "/app/tenants/t";
const DATA = parseNewJobSheet(wireNewJobSheet());
const LOAD: SheetLoad = { data: DATA, lang: "en", business: "Neelambari Silks", assistant: "Asha" };
const CTX: CardContext = { lang: "en", business: "Neelambari Silks", assistant: "Asha", item: "Kanchipuram silk sarees", customer: "Lakshmi" };
const planCard = async () => {
  await waitFor(() => expect(document.querySelector('[data-part="plan"]')).not.toBeNull());
  return within(document.querySelector('[data-part="plan"]') as HTMLElement);
};
const tpl = (id: string, pack = DATA.own) => pack.templates.find((t) => t.id === id)!;

function acts(over: Partial<SheetActions> = {}): SheetActions {
  return {
    plan: vi.fn(async (input: PlanInput) => ({ ok: true as const, data: mockPlan(input) })),
    start: vi.fn(async (planId: string) => ({ ok: true as const, data: mockStartPlan(planId) })),
    test: vi.fn(async (_id: string, channel) => ({ ok: true as const, data: { channel, mock: true, minutesUsed: 0 } })),
    load: vi.fn(async () => ({ ok: true as const, data: LOAD })),
    ...over,
  };
}
const sheet = (a: SheetActions, over: Partial<{ initial: SheetLoad | null; initialAsk: string | null; initialSeason: "diwali" | null; onClose: () => void; lang: string }> = {}) =>
  render(<NewJobSheet words={words} base={BASE} actions={a} onClose={over.onClose ?? vi.fn()} initial={"initial" in over ? over.initial : LOAD} initialAsk={over.initialAsk} initialSeason={over.initialSeason} />);

describe("a live preview template card", () => {
  it("a WhatsApp job: the real bubble with the shop's name and the customer's name filled in, one benefit line, what it needs, Use this and a round mic", () => {
    render(<TemplateCard template={tpl("new_collection_arrived")} ctx={CTX} words={words} onUse={vi.fn()} onSay={vi.fn()} />);
    const c = screen.getByRole("article", { name: "New collection arrived" });
    const bubble = c.querySelector('[data-part="preview-whatsapp"]') as HTMLElement;
    expect(bubble).toHaveTextContent("Neelambari Silks");
    expect(bubble).toHaveTextContent("Hi Lakshmi! New arrivals at Neelambari Silks: Kanchipuram silk sarees.");
    expect(bubble.textContent).not.toMatch(/[{}]/);
    expect(c).toHaveTextContent("Tell customers who said yes to messages, with photos on request");
    expect(c.querySelector('[data-part="needs"]')).toHaveTextContent("Needs: WhatsApp connected · Items in What you sell");
    expect(within(c).getByRole("button", { name: "Use this" })).toBeInTheDocument();
    expect(within(c).getByRole("button", { name: /Change .* by talking/ })).toBeInTheDocument();
    expect(c).toHaveTextContent("WhatsApp message");
  });
  it("a season tag from the data: Diwali", () => {
    render(<TemplateCard template={tpl("festival_collection")} ctx={CTX} words={words} onUse={vi.fn()} />);
    expect(screen.getByRole("article")).toHaveTextContent("Diwali");
  });
  it("a call job: the two assistant lines (the first says it is an AI) and NO play button while there is no sample_audio", () => {
    render(<TemplateCard template={tpl("answer_calls_when_busy")} ctx={CTX} words={words} onUse={vi.fn()} />);
    const snippet = document.querySelector('[data-part="preview-call"]') as HTMLElement;
    expect(snippet.querySelectorAll("p")).toHaveLength(2);
    expect(snippet).toHaveTextContent("Asha, the AI assistant of Neelambari Silks.");
    expect(screen.queryByRole("button", { name: /sample/i })).toBeNull();
    expect(document.querySelector('[data-part="sample-player"]')).toBeNull();
  });
  it("a recorded sample draws the round play button; pressing it plays that file and flips to pause", () => {
    let paused = true;
    vi.spyOn(window.HTMLMediaElement.prototype, "paused", "get").mockImplementation(() => paused);
    const play = vi.spyOn(window.HTMLMediaElement.prototype, "play").mockImplementation(function (this: HTMLMediaElement) {
      paused = false;
      this.dispatchEvent(new Event("play"));
      return Promise.resolve();
    });
    vi.spyOn(window.HTMLMediaElement.prototype, "pause").mockImplementation(function (this: HTMLMediaElement) {
      paused = true;
      this.dispatchEvent(new Event("pause"));
    });
    render(<TemplateCard template={{ ...tpl("store_visit_booking"), sampleAudio: { en: "/job-samples/textiles/store_visit_booking.en.mp3" } }} ctx={CTX} words={words} onUse={vi.fn()} />);
    const btn = screen.getByRole("button", { name: "Play 10-second sample" });
    expect(document.querySelector("audio")).toHaveAttribute("src", "/job-samples/textiles/store_visit_booking.en.mp3");
    fireEvent.click(btn);
    expect(play).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Pause the sample" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Pause the sample" }));
    expect(screen.getByRole("button", { name: "Play 10-second sample" })).toBeInTheDocument();
  });
  it("the sample is picked by the person's language, then the business's, then Telugu, then English; none of them = no player", () => {
    const audio = { te: "/job-samples/p/x.te.mp3", en: "/job-samples/p/x.en.mp3", kn: "/job-samples/p/x.kn.mp3" };
    const src = (over: Partial<CardContext>, a: Record<string, string> = audio) => {
      const { unmount } = render(<TemplateCard template={{ ...tpl("store_visit_booking"), sampleAudio: a }} ctx={{ ...CTX, ...over }} words={words} onUse={vi.fn()} />);
      const el = document.querySelector("audio");
      const out = el ? el.getAttribute("src") : null;
      unmount();
      return out;
    };
    expect(src({ lang: "kn" })).toBe("/job-samples/p/x.kn.mp3");
    expect(src({ lang: "hi", businessLang: "kn" })).toBe("/job-samples/p/x.kn.mp3");
    expect(src({ lang: "hi", businessLang: "hi" })).toBe("/job-samples/p/x.te.mp3");
    expect(src({ lang: "hi", businessLang: null }, { en: "/job-samples/p/x.en.mp3" })).toBe("/job-samples/p/x.en.mp3");
    expect(src({ lang: "hi" }, { hi: "/job-samples/p/x.hi.mp3" })).toBe("/job-samples/p/x.hi.mp3");
    expect(src({ lang: "te" }, {})).toBeNull();
  });
  it("Lead Finder with the workspace's REAL best prospects: the fit chip is drawn, no Example label, each why is its own sentence; an unknown code or a missing number reads as the generic line", () => {
    const lf = tpl("find_saree_shops");
    const real: JobTemplate = {
      ...lf,
      examplesReal: true,
      examples: [
        { name: "Lotus Bay Sarees", area: "Market Road", fit: 91, why: { code: "near_you", params: { km: 3 } } },
        { name: "Peacock Lane", area: "Old Town", fit: 74, why: { code: "well_rated", params: { rating: "4.6", count: 212 } } },
        { name: "Silk Thread", area: "Station Road", fit: 60, why: { code: "category_match", params: { category: "Boutique" } } },
        { name: "Mystery Mart", area: "Ring Road", fit: 55, why: { code: "from_the_future", params: {} } },
        { name: "Half Mart", area: "Ring Road", fit: 50, why: { code: "near_you", params: {} } },
        { name: "Open Mart", area: "Ring Road", fit: 40, why: { code: "open_business", params: {} } },
        { name: "Chain Mart", area: "Ring Road", fit: 30, why: { code: "sells_what_you_buy_from", params: { category: "Wholesaler" } } },
      ],
    };
    render(<TemplateCard template={real} ctx={CTX} words={words} onUse={vi.fn()} />);
    const rows = [...document.querySelectorAll("[data-example]")] as HTMLElement[];
    expect(rows).toHaveLength(7);
    expect(rows.every((r) => r.getAttribute("data-example") === "real")).toBe(true);
    expect(screen.queryByText("Example")).toBeNull();
    expect(rows.map((r) => r.querySelector("[data-fit]")?.getAttribute("data-fit"))).toEqual(["91", "74", "60", "55", "50", "40", "30"]);
    expect(rows[0]).toHaveTextContent("Fit 91");
    expect(rows[0]).toHaveTextContent("About 3 km from you.");
    expect(rows[1]).toHaveTextContent("Scored 4.6 out of 5 by 212 customers.");
    expect(rows[2]).toHaveTextContent("A Boutique, the kind you are looking for.");
    expect(rows[3]).toHaveTextContent("A good match for what you are looking for.");
    expect(rows[4]).toHaveTextContent("A good match for what you are looking for."); // near_you without its km
    expect(rows[5]).toHaveTextContent("Listed as open for business.");
    expect(rows[6]).toHaveTextContent("A Wholesaler: the kind of business that sells what you buy from.");
    expect(document.body.textContent).not.toMatch(/[{}]/);
    expect(screen.getByText(/The best matches we found for you/)).toBeInTheDocument();
    expect(screen.queryByText(/Made-up shops/)).toBeNull();
  });
  it("the invented examples (not real) stay labelled Example with the note, and have no fit unless the mock gives one", () => {
    const lf = tpl("find_saree_shops");
    expect(lf.examplesReal).toBe(false);
    render(<TemplateCard template={{ ...lf, examples: lf.examples.map((e) => ({ ...e, fit: null })) }} ctx={CTX} words={words} onUse={vi.fn()} />);
    expect(screen.getAllByText("Example")).toHaveLength(3);
    expect(document.querySelectorAll("[data-fit]")).toHaveLength(0);
    expect(screen.getByText(/Made-up shops/)).toBeInTheDocument();
  });
  it("{item} reads the template's own sample item first, then the shop's, else 'your item'", () => {
    const base = tpl("new_collection_arrived");
    const own = { ...base, sampleItem: { en: "bridal silk sarees" } };
    const { unmount } = render(<TemplateCard template={own} ctx={CTX} words={words} onUse={vi.fn()} />);
    expect(document.querySelector('[data-part="preview-whatsapp"]')).toHaveTextContent("New arrivals at Neelambari Silks: bridal silk sarees.");
    unmount();
    render(<TemplateCard template={base} ctx={CTX} words={words} onUse={vi.fn()} />);
    expect(document.querySelector('[data-part="preview-whatsapp"]')).toHaveTextContent("New arrivals at Neelambari Silks: Kanchipuram silk sarees.");
  });
  it("Lead Finder: three example shops, each labelled Example; the fit only when the data has a score; it says you contact them yourself", () => {
    render(<TemplateCard template={tpl("find_saree_shops")} ctx={CTX} words={words} onUse={vi.fn()} />);
    const rows = document.querySelectorAll("[data-example]");
    expect(rows).toHaveLength(3);
    rows.forEach((r) => expect(r).toHaveTextContent("Example"));
    expect([...document.querySelectorAll("[data-fit]")].map((e) => e.textContent)).toEqual(["Fit 92", "Fit 87", "Fit 78"]);
    expect(screen.getByRole("article")).toHaveTextContent(/You contact them yourself/);
    expect(document.querySelector('[data-part="preview-whatsapp"]')).toBeNull();
    cleanup();
    const noFit = { ...tpl("find_saree_shops"), examples: tpl("find_saree_shops").examples.map((e) => ({ ...e, fit: null })) };
    render(<TemplateCard template={noFit} ctx={CTX} words={words} onUse={vi.fn()} />);
    expect(document.querySelectorAll("[data-fit]")).toHaveLength(0);
    expect(document.querySelectorAll("[data-example]")).toHaveLength(3);
  });
  it("Telugu: C1's Telugu letters are kept, the shop's name stays in Latin letters", () => {
    render(<TemplateCard template={tpl("new_collection_arrived")} ctx={{ ...CTX, lang: "te", item: "కంచి పట్టు చీరలు" }} words={words} onUse={vi.fn()} />);
    const bubble = document.querySelector('[data-part="preview-whatsapp"]') as HTMLElement;
    expect(bubble.textContent).toMatch(/[ఀ-౿]/);
    expect(bubble).toHaveTextContent("Neelambari Silks లో కొత్తగా కంచి పట్టు చీరలు వచ్చాయి");
  });
});

describe("the New job sheet", () => {
  it("has ONE height on a phone (92% of the screen), not the height of what it holds: it is anchored to the bottom, so a sheet that grew when its ideas arrived moved up by 131 px (staging, CLS 0.147)", () => {
    sheet(acts());
    const panel = document.querySelector(".jb-sheet") as HTMLElement;
    expect(panel.className).toContain("h-[92dvh]");
    expect(panel.className).not.toContain("max-h-[92dvh]");
    expect(panel.className).toContain("md:h-auto"); // the side panel of a wide screen is not touched
  });
  it("opens as a dialog with the box, Popular for saree shops (4 live cards), More ideas by goal and Ideas from other businesses", () => {
    sheet(acts());
    const dlg = screen.getByRole("dialog", { name: "New team member" });
    expect(within(dlg).getByText("Tell your assistant what you want done")).toBeInTheDocument();
    expect(within(dlg).getByRole("heading", { name: "Popular for saree shops" })).toBeInTheDocument();
    expect(dlg.querySelectorAll('[data-part="popular"] [data-part="template-card"]')).toHaveLength(4);
    const goals = [...dlg.querySelectorAll("[data-goal]")].map((g) => g.getAttribute("data-goal"));
    expect(goals).toEqual(["answer_every_enquiry", "bring_customers_back", "fill_your_visits", "find_new_customers"]);
    expect(dlg).toHaveTextContent("Bring customers back");
    expect(within(dlg).getByRole("heading", { name: "Ideas from other businesses" })).toBeInTheDocument();
    expect([...dlg.querySelectorAll("[data-chip]")].map((c) => c.getAttribute("data-chip"))).toEqual(["own", "clinic", "coaching", "real_estate", "wholesale_b2b"]);
  });
  it("Get paid is later: no group, no card, no payment reminder anywhere in the sheet", () => {
    sheet(acts());
    const dlg = screen.getByRole("dialog");
    expect(dlg).not.toHaveTextContent(/get paid/i);
    for (const g of dlg.querySelectorAll("[data-goal] > button")) fireEvent.click(g);
    expect(dlg.querySelector('[data-idea="payment_reminder_gentle"]')).toBeNull();
    expect(dlg).not.toHaveTextContent(/payment reminder|gentle payment/i);
    fireEvent.click(dlg.querySelector('[data-chip="coaching"]')!);
    for (const g of dlg.querySelectorAll("[data-goal] > button")) if (g.getAttribute("aria-expanded") === "false") fireEvent.click(g);
    expect(dlg.querySelector('[data-idea="fee_reminder"]')).toBeNull();
  });
  it("a group opens to its ideas; an idea opens to its live card", () => {
    sheet(acts());
    const dlg = screen.getByRole("dialog");
    fireEvent.click(within(dlg.querySelector('[data-goal="fill_your_visits"]') as HTMLElement).getByRole("button", { name: /Fill your visits/ }));
    const idea = dlg.querySelector('[data-idea="visit_reminder_day_before"]') as HTMLElement;
    expect(idea).toBeInTheDocument();
    fireEvent.click(within(idea).getAllByRole("button")[0]);
    expect(idea.querySelector('[data-part="template-card"]')).toBeInTheDocument();
  });
  it("Ideas from other businesses: a chip swaps More ideas to that business type's templates, with the note that the words are written again for this shop", () => {
    sheet(acts());
    const dlg = screen.getByRole("dialog");
    fireEvent.click(dlg.querySelector('[data-chip="clinic"]')!);
    expect(dlg.querySelector('[data-part="other-note"]')).toHaveTextContent("Ideas from clinics. When you pick one, the words are written again for Neelambari Silks.");
    fireEvent.click(within(dlg.querySelector('[data-goal="fill_your_visits"]') as HTMLElement).getByRole("button", { name: /Fill your visits/ }));
    expect(dlg.querySelector('[data-idea="appointment_booking"]')).toBeInTheDocument();
    expect(dlg.querySelector('[data-idea="store_visit_booking"]')).toBeNull();
  });
  it("TWO TAPS: a card's Use this asks the planner for the card's own template (its id and its sentence: the server sends the id to the real planner and the sentence to the mock), the plan card appears, Start calls the SAME start action as typing", async () => {
    const a = acts();
    const onClose = vi.fn();
    sheet(a, { onClose });
    const card = document.querySelector('[data-template="enquiry_call_right_away"]') as HTMLElement;
    fireEvent.click(within(card).getByRole("button", { name: "Use this" }));
    expect(a.plan).toHaveBeenCalledWith({ templateId: "enquiry_call_right_away", ask: "Call every new saree enquiry right away" });
    const plan = await planCard();
    expect(a.start).not.toHaveBeenCalled(); // nothing starts before Start
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("Call every new saree enquiry right away");
    fireEvent.click(plan.getByRole("button", { name: "Start" }));
    await waitFor(() => expect(a.start).toHaveBeenCalledWith("plan-kind-speed_to_lead"));
    await waitFor(() => expect(nav.push).toHaveBeenCalledWith(expect.stringMatching(/^\/app\/tenants\/t\/jobs\/.+\?started=1$/)));
    expect(onClose).toHaveBeenCalled();
  });
  it("typing the same sentence ends in the very same plan and the very same start", async () => {
    const a = acts();
    sheet(a);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Call every new saree enquiry right away" } });
    fireEvent.click(screen.getByRole("button", { name: "Show me the plan" }));
    const plan = await planCard();
    fireEvent.click(plan.getByRole("button", { name: "Start" }));
    await waitFor(() => expect(a.start).toHaveBeenCalledWith("plan-kind-speed_to_lead"));
    expect(a.plan).toHaveBeenCalledTimes(1);
    expect(a.plan).toHaveBeenCalledWith({ text: "Call every new saree enquiry right away" });
  });
  it("with a plan on screen the ideas fold into one row; it opens them again", async () => {
    sheet(acts());
    fireEvent.click(within(document.querySelector('[data-template="new_collection_arrived"]') as HTMLElement).getByRole("button", { name: "Use this" }));
    await planCard();
    expect(document.querySelector('[data-part="popular"]')).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show popular and more ideas" }));
    expect(document.querySelector('[data-part="popular"]')).toBeInTheDocument();
  });
  it("the round mic of a card puts its sentence in the box to be changed by talking, and plans nothing", () => {
    const a = acts();
    sheet(a);
    fireEvent.click(within(document.querySelector('[data-template="enquiry_call_right_away"]') as HTMLElement).getByRole("button", { name: /Change .* by talking/ }));
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("Call every new saree enquiry right away");
    expect(a.plan).not.toHaveBeenCalled();
  });
  it("the offer waits for the Owner's OK (409 approval_needed): the sheet says so and stays", async () => {
    const a = acts();
    sheet(a);
    fireEvent.click(within(document.querySelector('[data-template="new_collection_arrived"]') as HTMLElement).getByRole("button", { name: "Use this" }));
    const plan = await planCard();
    fireEvent.click(plan.getByRole("button", { name: "Start" }));
    expect(await screen.findByText(/Waiting for your OK/i)).toBeInTheDocument();
    expect(nav.push).not.toHaveBeenCalled();
  });
  it("a sentence that is too short is refused before anything is asked", () => {
    const a = acts();
    sheet(a);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "hi" } });
    fireEvent.click(screen.getByRole("button", { name: "Show me the plan" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Say a little more");
    expect(a.plan).not.toHaveBeenCalled();
  });
  it("without server data it reads the ideas itself: a skeleton first, then the cards; none yet = a plain line and the box still there", async () => {
    const a = acts();
    const { unmount } = sheet(a, { initial: undefined });
    expect(screen.getByRole("status", { name: "Getting ideas…" })).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "Popular for saree shops" })).toBeInTheDocument();
    expect(a.load).toHaveBeenCalledTimes(1);
    unmount();
    sheet(acts({ load: vi.fn(async () => ({ ok: true as const, data: null })) }), { initial: undefined });
    expect(await screen.findByText(/Ideas are not ready yet/)).toBeInTheDocument();
    expect(screen.getByRole("textbox")).toBeInTheDocument();
  });
  it("a failed read says why", async () => {
    sheet(acts({ load: vi.fn(async () => ({ ok: false as const, kind: "unavailable" as const, error: "Something went wrong." })) }), { initial: undefined });
    expect(await screen.findByRole("alert")).toHaveTextContent("Something went wrong.");
  });
  it("opened on a card's sentence (the empty Jobs page) it asks for that plan at once", async () => {
    const a = acts();
    sheet(a, { initialAsk: "Call every new saree enquiry right away" });
    await planCard();
    expect(a.plan).toHaveBeenCalledWith({ text: "Call every new saree enquiry right away" });
  });
  it("opened on a card's sentence AND its template id (the empty Jobs page) the planner is asked for the template", async () => {
    const a = acts();
    render(<NewJobSheet words={words} base={BASE} actions={a} onClose={vi.fn()} initial={LOAD} initialAsk="Call every new saree enquiry right away" initialTemplate="enquiry_call_right_away" />);
    await planCard();
    expect(a.plan).toHaveBeenCalledWith({ templateId: "enquiry_call_right_away", ask: "Call every new saree enquiry right away" });
  });
  it("opened on a festival it asks for the plan of that festival's template (the sentence comes from the data)", async () => {
    const a = acts();
    sheet(a, { initialSeason: "diwali" });
    await planCard();
    expect(a.plan).toHaveBeenCalledWith({ templateId: "festival_collection", ask: "Send the Diwali festival offer to my customers" });
  });
  it("Escape closes; the page behind stops scrolling and gets it back", () => {
    const onClose = vi.fn();
    const { unmount } = sheet(acts(), { onClose });
    expect(document.body.style.overflow).toBe("hidden");
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
    unmount();
    expect(document.body.style.overflow).not.toBe("hidden");
  });
  it("Telugu: the cards speak the person's language", () => {
    sheet(acts(), { initial: { ...LOAD, lang: "te" } });
    expect(document.querySelector('[data-template="enquiry_call_right_away"] h3')).toHaveTextContent("కొత్త ఎంక్వైరీకి వెంటనే కాల్ చేయండి");
  });
});

describe("where the sheet is opened from", () => {
  it("the New job button opens the sheet (its chunk is loaded on the first touch) and Escape gives the focus back to it", async () => {
    render(<NewJobButton words={words} base={BASE} actions={acts()} />);
    const btn = screen.getByRole("button", { name: "New team member" });
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(btn);
    expect(await screen.findByRole("dialog", { name: "New team member" })).toBeInTheDocument();
    await screen.findByRole("heading", { name: "Popular for saree shops" });
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
  it("Sales and Viewer have no button (they read)", () => {
    const { container } = render(<NewJobButton words={words} base={BASE} actions={null} />);
    expect(container).toBeEmptyDOMElement();
  });
  it("?new=1: the sheet is there already with the ideas the server read", () => {
    render(<NewJobButton words={words} base={BASE} actions={acts()} initial={LOAD} defaultOpen />);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
  it("the empty Jobs page: three live cards, one tap each opens the sheet on that plan; Or say what you need opens it empty", async () => {
    const a = acts();
    render(<JobsEmpty words={words} base={BASE} actions={a} load={LOAD} />);
    expect(document.querySelectorAll('[data-part="template-card"]')).toHaveLength(3);
    expect(screen.getByRole("heading", { name: "No team members yet" })).toBeInTheDocument();
    fireEvent.click(within(document.querySelector('[data-template="enquiry_call_right_away"]') as HTMLElement).getByRole("button", { name: "Use this" }));
    await waitFor(() => expect(a.plan).toHaveBeenCalledWith({ templateId: "enquiry_call_right_away", ask: "Call every new saree enquiry right away" }));
  });
});

describe("the assistant's festival suggestion on Today", () => {
  const hint = festivalHint([{ season: "diwali", name: { en: "Diwali" }, date: "2026-12-03" }], "en", new Date("2026-11-19T10:00:00"))!;
  it("says the festival and the days to go from the calendar; Not now hides it for a week with Undo; the choice is kept in this browser", () => {
    const { unmount } = render(<FestivalSuggestion festival={hint} words={words} base={BASE} actions={acts()} />);
    expect(screen.getByText("Diwali is in 14 days. Want me to prepare the festival offer?")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Not now" }));
    expect(screen.queryByText(/Want me to prepare/)).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent("OK, I will ask again in a week.");
    unmount();
    render(<FestivalSuggestion festival={hint} words={words} base={BASE} actions={acts()} />);
    expect(screen.queryByText(/Want me to prepare/)).toBeNull(); // still hidden after a reload
    cleanup();
    render(<FestivalSuggestion festival={hint} words={words} base={BASE} actions={acts()} />);
    expect(screen.queryByText(/Want me to prepare/)).toBeNull();
  });
  it("Undo brings it back", () => {
    render(<FestivalSuggestion festival={hint} words={words} base={BASE} actions={acts()} />);
    fireEvent.click(screen.getByRole("button", { name: "Not now" }));
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(screen.getByText(/Want me to prepare/)).toBeInTheDocument();
  });
  it("Yes, show me opens the sheet on the festival's plan", async () => {
    const a = acts({ load: vi.fn(async () => ({ ok: true as const, data: LOAD })) });
    render(<FestivalSuggestion festival={hint} words={words} base={BASE} actions={a} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Yes, show me" }));
    });
    await waitFor(() => expect(a.plan).toHaveBeenCalledWith({ templateId: "festival_collection", ask: "Send the Diwali festival offer to my customers" }));
  });
});
