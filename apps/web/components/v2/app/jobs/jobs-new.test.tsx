import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const nav = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: nav.push, replace: vi.fn(), refresh: vi.fn() }) }));
vi.mock("./LazySearchPlan", async () => ({ SearchPlan: (await import("./SearchPlan")).SearchPlan }));

import { appDict } from "@/i18n/app";
import { MOCK_JOBS } from "@/lib/jobs/mock";
import { mockPlan, mockSuggestions, mockStartPlan, mockStartedFor } from "@/lib/jobs/plan-mock";
import type { JobPlan, PlanInput } from "@/lib/jobs/plan";

import { JobsList } from "./JobsList";
import { NewJob, type NewJobActions } from "./NewJob";
import { voiceAllowed } from "../voice-input/VoiceMic";

afterEach(cleanup);
beforeEach(() => nav.push.mockClear());
const words = Object.fromEntries(Object.entries(appDict("en") as Record<string, string>).filter(([k]) => k.startsWith("jobs.")));
const BASE = "/app/tenants/t";
const SAREE = ["catalogue", "quotes", "visits"];
const SILK = "call customers who bought silk sarees last month and ask how they liked it";

function acts(over: Partial<NewJobActions> = {}): NewJobActions {
  return {
    plan: vi.fn(async (input: PlanInput) => ({ ok: true as const, data: mockPlan(input) })),
    start: vi.fn(async (planId: string) => ({ ok: true as const, data: mockStartPlan(planId) })),
    startSuggestion: vi.fn(async (kind) => ({ ok: true as const, data: mockStartedFor(kind) })),
    test: vi.fn(async (_id: string, channel) => ({ ok: true as const, data: { channel, mock: true, minutesUsed: 0 } })),
    ...over,
  };
}
const draw = (a: NewJobActions, over: { initialPlan?: JobPlan | null; saree?: boolean } = {}) =>
  render(<NewJob words={words} base={BASE} actions={a} suggestions={mockSuggestions(over.saree === false ? null : SAREE).items} heading={over.saree === false ? null : "saree"} initialPlan={over.initialPlan ?? null} />);
const say = (text: string) => {
  fireEvent.change(screen.getByRole("textbox"), { target: { value: text } });
  fireEvent.click(screen.getByRole("button", { name: "Show me the plan" }));
};
const card = async () => within(await screen.findByRole("article"));

describe("the command box and the plan card", () => {
  it("a box, two examples, and no plan until something is said", () => {
    draw(acts());
    expect(screen.getByPlaceholderText("Tell your assistant what to do…")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ask last month’s silk buyers how they liked it" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Call yesterday’s missed calls" })).toBeInTheDocument();
    expect(screen.queryByRole("article")).toBeNull();
  });
  it("the silk-saree sentence: a plan with who (38 of 42), who is left out and why, the AI line, when, what it finds out, the free minutes; NOTHING has started", async () => {
    const a = acts();
    draw(a);
    say(SILK);
    const c = await card();
    expect(a.plan).toHaveBeenCalledWith({ text: SILK });
    expect(c.getByRole("heading", { name: "Ask last month’s silk buyers how they liked it" })).toBeInTheDocument();
    expect(c.getByText(/38 of the 42 who bought in the last 30 days and agreed to calls/)).toBeInTheDocument();
    expect(c.getByText(/4 customers are left out/)).toBeInTheDocument();
    expect(c.getByText(/they did not say yes to be contacted/)).toBeInTheDocument();
    expect(c.getByText(/3 of them said yes to messages/)).toBeInTheDocument();
    expect(c.getByRole("button", { name: "Send those 3 a WhatsApp instead" })).toBeInTheDocument();
    expect(c.getByText(/this is the AI assistant of Neelambari Silks/)).toBeInTheDocument();
    expect(c.getByText("Tomorrow, 10 am to 6 pm, Mon to Sat, about 7 calls an hour")).toBeInTheDocument();
    expect(c.getByText("Did they like it · Anything they would change · Would they like to see new arrivals")).toBeInTheDocument();
    expect(c.getByText("Uses about 34 of your 60 free minutes this month.")).toBeInTheDocument();
    expect(c.getByRole("button", { name: "Test call to my phone" })).toBeInTheDocument();
    // a test call IS a real call to the owner's own phone: the card says so before the button is pressed
    expect(c.getByText("This calls YOUR phone and uses about 1 of your free minutes.")).toBeInTheDocument();
    expect(c.getByText(/never calls outside 10 am to 6 pm/)).toBeInTheDocument();
    expect(a.start).not.toHaveBeenCalled();
    expect(a.startSuggestion).not.toHaveBeenCalled();
    expect(nav.push).not.toHaveBeenCalled();
  });
  it("the box may have the app's own voice typing (it is a plain text field), which writes in the box and sends nothing; where voice is not set up no microphone is drawn", () => {
    const a = acts();
    draw(a);
    expect(voiceAllowed(screen.getByRole("textbox") as HTMLTextAreaElement)).toBe(true);
    expect(document.querySelector("[data-voice-mic]")).toBeNull();
    expect(a.plan).not.toHaveBeenCalled();
  });
  it("an example runs the planner at once; the missed calls plan is 6 people and nothing is left out", async () => {
    draw(acts());
    fireEvent.click(screen.getByRole("button", { name: "Call yesterday’s missed calls" }));
    const c = await card();
    expect(c.getByText(/^6 who asked you in the last 30 days and agreed to calls/)).toBeInTheDocument();
    expect(c.queryByText(/customers are left out/)).toBeNull();
  });
  it("too short a sentence is said so in the box and the planner is not asked", () => {
    const a = acts();
    draw(a);
    say("ab");
    expect(screen.getByRole("alert")).toHaveTextContent("3 to 500");
    expect(a.plan).not.toHaveBeenCalled();
  });
  it("something the planner cannot tell: a plain note, no plan card, no Start", async () => {
    draw(acts());
    say("do something nice for me");
    expect(await screen.findByText(/I could not tell who you mean/)).toBeInTheDocument();
    expect(screen.queryByRole("article")).toBeNull();
    expect(screen.getAllByRole("button", { name: "Start" })).toHaveLength(4); // only the suggested jobs have a Start
    expect(document.querySelector('[data-part="plan"] [data-action="start"]')).toBeNull();
    expect(screen.getByRole("button", { name: "Call yesterday’s missed calls" })).toBeInTheDocument();
  });
  it("Start is the only thing that begins a job: it asks once with the plan's id, shows Started and lands on the job's page", async () => {
    const a = acts();
    draw(a);
    say(SILK);
    const c = await card();
    fireEvent.click(c.getByRole("button", { name: "Start" }));
    await waitFor(() => expect(a.start).toHaveBeenCalledWith("plan-silk-call"));
    expect(a.start).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(nav.push).toHaveBeenCalledWith(expect.stringMatching(new RegExp(`^${BASE}/jobs/66666666-.*\\?started=1$`))));
    expect(screen.getByText("Started")).toBeInTheDocument();
  });
  it("a refusal on Start is said on the card and nothing moves", async () => {
    const a = acts({ start: vi.fn(async () => ({ ok: false as const, kind: "forbidden" as const, error: "You may not do this." })) });
    draw(a);
    say(SILK);
    fireEvent.click((await card()).getByRole("button", { name: "Start" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("You may not do this.");
    expect(nav.push).not.toHaveBeenCalled();
    expect(screen.queryByText("Started")).toBeNull();
  });
  it("Send those 3 a WhatsApp instead: a new plan for the 3 (a message, test message, no call minutes) and still nothing started", async () => {
    const a = acts();
    draw(a);
    say(SILK);
    fireEvent.click((await card()).getByRole("button", { name: "Send those 3 a WhatsApp instead" }));
    // the contract: {as: "whatsapp", plan_id} (the plan shown), never the sentence again
    await waitFor(() => expect(a.plan).toHaveBeenLastCalledWith({ as: "whatsapp", planId: "plan-silk-call" }));
    const c = await screen.findByText("Uses none of your free call minutes.");
    expect(c).toBeInTheDocument();
    const art = within(screen.getByRole("article"));
    expect(art.getByRole("button", { name: "Test message to my phone" })).toBeInTheDocument();
    expect(art.queryByText(/uses about 1 of your free minutes/)).toBeNull();
    expect(art.getByText(/Reply STOP/)).toBeInTheDocument();
    expect(a.start).not.toHaveBeenCalled();
  });
  it("Change by talking puts the sentence back in the box and focuses it", async () => {
    draw(acts());
    say(SILK);
    const c = await card();
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "" } });
    fireEvent.click(c.getByRole("button", { name: "Change by talking" }));
    expect(screen.getByRole("textbox")).toHaveValue(SILK);
    expect(screen.getByRole("textbox")).toHaveFocus();
  });
  it("the test goes to the owner's own phone through the test action (a call for a call plan) and in the mock says nothing was called", async () => {
    const a = acts();
    draw(a);
    say(SILK);
    fireEvent.click((await card()).getByRole("button", { name: "Test call to my phone" }));
    expect(await screen.findByText("Preview mode: nothing was called or sent.")).toBeInTheDocument();
    expect(a.test).toHaveBeenCalledWith("plan-silk-call", "call");
    expect(a.start).not.toHaveBeenCalled();
  });
  it("a real test says it is on its way; a paid plan shows rupees; a plan that says send_whatsapp makes that the main button", async () => {
    const paid: JobPlan = { ...mockPlan({ text: SILK }), cost: { minutes: 0, minutesIncluded: 0, minutesUsed: 0, rupees: 1890 }, primary: "send_whatsapp" };
    const a = acts({ plan: vi.fn(async () => ({ ok: true as const, data: paid })), test: vi.fn(async (_id, channel) => ({ ok: true as const, data: { channel, mock: false, minutesUsed: 1 } })) });
    draw(a);
    say(SILK);
    const c = await card();
    expect(c.getByText("Costs about ₹1,890.")).toBeInTheDocument();
    expect(c.queryByText(/free minutes/)).toBeNull();
    expect(c.getByRole("button", { name: "Send those 3 a WhatsApp" })).toBeInTheDocument();
    expect(c.queryByRole("button", { name: "Send those 3 a WhatsApp instead" })).toBeNull();
    fireEvent.click(c.getByRole("button", { name: "Test call to my phone" }));
    // the test says how many free minutes it used (the API's `minutes_used`)
    expect(await screen.findByText("A test call is on its way to your phone. That test used 1 of your free minutes.")).toBeInTheDocument();
  });
  it("a test refused for quiet hours (409 quiet_hours) turns the test button off and says when tests are sent; Start stays", async () => {
    const a = acts({ test: vi.fn(async () => ({ ok: false as const, kind: "conflict" as const, error: "x", code: "quiet_hours" })) });
    draw(a);
    say(SILK);
    const c = await card();
    fireEvent.click(c.getByRole("button", { name: "Test call to my phone" }));
    expect(await screen.findByText("Test calls and messages are only sent between 10 am and 9 pm.")).toBeInTheDocument();
    expect(c.getByRole("button", { name: "Test call to my phone" })).toBeDisabled();
    expect(c.getByRole("button", { name: "Start" })).toBeEnabled();
    expect(c.queryByRole("alert")).toBeNull();
  });
  it("Start answers 409 approval_needed: no error, the card says Waiting for your OK with a link to Needs you on Today, and Start is gone", async () => {
    const a = acts({ start: vi.fn(async () => ({ ok: true as const, data: { approval: { id: "ap-1", kind: "offer" as const } } })) });
    draw(a);
    say(SILK);
    const c = await card();
    fireEvent.click(c.getByRole("button", { name: "Start" }));
    const waiting = await screen.findByText("Waiting for your OK: the offer");
    expect(waiting).toBeInTheDocument();
    expect(c.getByRole("link", { name: "See it in Needs you" })).toHaveAttribute("href", `${BASE}#needs-you`);
    expect(c.queryByRole("button", { name: "Start" })).toBeNull();
    expect(c.queryByRole("alert")).toBeNull();
    expect(nav.push).not.toHaveBeenCalled();
    expect(screen.queryByText("Started")).toBeNull();
  });
  it("an expired plan is said in words: say it again", async () => {
    const a = acts({ start: vi.fn(async () => ({ ok: false as const, kind: "conflict" as const, error: "This plan has expired: say it again.", code: "plan_expired" })) });
    draw(a);
    say(SILK);
    fireEvent.click((await card()).getByRole("button", { name: "Start" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("This plan has expired: say it again.");
  });
  it("a plan with a blocker shows why and has no Start", async () => {
    const blocked: JobPlan = { ...mockPlan({ text: SILK }), blockers: ["no_whatsapp"] };
    draw(acts({ plan: vi.fn(async () => ({ ok: true as const, data: blocked })) }));
    say(SILK);
    const c = await card();
    expect(c.getByText("Connect WhatsApp first, so the assistant can write.")).toBeInTheDocument();
    expect(c.queryByRole("button", { name: "Start" })).toBeNull();
  });
  it("every blocker of the contract has its own sentence, and a code the web does not know gets the plain one", async () => {
    for (const [code, text] of [["no_number", "Add a phone number first, so the assistant can call."], ["minutes_used", "Your free minutes are used up, so this plan cannot start."], ["something_new", "This plan cannot start yet."]] as const) {
      cleanup();
      const blocked: JobPlan = { ...mockPlan({ text: SILK }), blockers: [code] };
      draw(acts({ plan: vi.fn(async () => ({ ok: true as const, data: blocked })) }));
      say(SILK);
      expect((await card()).getByText(text)).toBeInTheDocument();
    }
  });
  it("a refusal from the planner is said under the box", async () => {
    draw(acts({ plan: vi.fn(async () => ({ ok: false as const, kind: "rate_limited" as const, error: "Too many tries." })) }));
    say(SILK);
    expect(await screen.findByRole("alert")).toHaveTextContent("Too many tries.");
  });
});

describe("the suggested jobs", () => {
  it("a saree shop: four cards, each with why it fits (the shop's numbers), a preview of what it says, Start and Look first", () => {
    draw(acts());
    expect(screen.getByRole("heading", { name: "Jobs for a saree shop" })).toBeInTheDocument();
    const items = document.querySelectorAll("[data-suggestion]");
    expect([...items].map((i) => i.getAttribute("data-suggestion"))).toEqual(["speed_to_lead", "followups", "store_visits", "offers"]);
    const first = within(items[0] as HTMLElement);
    expect(first.getByText("Call every new enquiry right away")).toBeInTheDocument();
    expect(first.getByText("Last week 14 enquiries came in and 9 of them waited more than an hour for you.")).toBeInTheDocument();
    expect(first.getByText(/Which occasion is it for/)).toBeInTheDocument();
    expect(first.getByRole("button", { name: "Start" })).toBeInTheDocument();
    expect(first.getByRole("button", { name: "Look first" })).toBeInTheDocument();
    expect(within(items[3] as HTMLElement).getByText("Send the wedding-season offer to customers who said yes")).toBeInTheDocument();
    expect(within(items[3] as HTMLElement).getByText("38 customers said yes to offers. The offer goes only to them, after your OK.")).toBeInTheDocument();
  });
  it("another kind of business: the plain three, under the plain heading", () => {
    draw(acts(), { saree: false });
    expect(screen.getByRole("heading", { name: "Jobs to start with" })).toBeInTheDocument();
    expect(document.querySelectorAll("[data-suggestion]")).toHaveLength(3);
  });
  it("Start is one tap: it starts that job at once (no plan card) and lands on its page with the Started toast", async () => {
    const a = acts();
    draw(a);
    fireEvent.click(within(document.querySelector('[data-suggestion="offers"]') as HTMLElement).getByRole("button", { name: "Start" }));
    await waitFor(() => expect(a.startSuggestion).toHaveBeenCalledWith("offers"));
    // the festival offer goes only after the Owner's OK: the start answers 409 approval_needed, shown as "Waiting for your OK", not as an error
    const card = document.querySelector('[data-suggestion="offers"]') as HTMLElement;
    expect(await within(card).findByText("Waiting for your OK: the offer")).toBeInTheDocument();
    expect(within(card).getByRole("link", { name: "See it in Needs you" })).toHaveAttribute("href", `${BASE}#needs-you`);
    expect(within(card).getByRole("button", { name: "Start" })).toBeDisabled();
    expect(within(card).queryByRole("alert")).toBeNull();
    expect(nav.push).not.toHaveBeenCalled();
    expect(a.plan).not.toHaveBeenCalled();
  });
  it("a suggested job that starts at once lands on its page with the Started toast", async () => {
    const a = acts();
    draw(a);
    fireEvent.click(within(document.querySelector('[data-suggestion="followups"]') as HTMLElement).getByRole("button", { name: "Start" }));
    await waitFor(() => expect(nav.push).toHaveBeenCalledWith(`${BASE}/jobs/${MOCK_JOBS.find((j) => j.kind === "followups")!.id}?started=1`));
    expect(screen.getByText("Started")).toBeInTheDocument();
  });
  it("a suggestion that is not ready (a number or WhatsApp is missing) says what is missing and cannot be started", () => {
    const sug = [{ kind: "speed_to_lead" as const, title: null, why: { code: "no_number", params: {} }, preview: "Hi", ready: false }];
    render(<NewJob words={words} base={BASE} actions={acts()} suggestions={sug} heading={null} initialPlan={null} />);
    const card = document.querySelector('[data-suggestion="speed_to_lead"]') as HTMLElement;
    expect(within(card).getByText("Add a phone number first, then this job can start.")).toBeInTheDocument();
    expect(within(card).getByRole("button", { name: "Start" })).toBeDisabled();
  });
  it("Look first opens the same plan card for that job, and starts nothing", async () => {
    const a = acts();
    draw(a);
    fireEvent.click(within(document.querySelector('[data-suggestion="followups"]') as HTMLElement).getByRole("button", { name: "Look first" }));
    const c = await card();
    expect(a.plan).toHaveBeenCalledWith({ kind: "followups" });
    expect(c.getByRole("heading", { name: "Follow up on price questions and promises" })).toBeInTheDocument();
    expect(c.getByText(/this is the AI assistant of/)).toBeInTheDocument();
    expect(a.startSuggestion).not.toHaveBeenCalled();
    expect(a.start).not.toHaveBeenCalled();
  });
  it("a refusal on a suggested job's Start is said on that card", async () => {
    draw(acts({ startSuggestion: vi.fn(async () => ({ ok: false as const, kind: "forbidden" as const, error: "You may not do this." })) }));
    fireEvent.click(within(document.querySelector('[data-suggestion="speed_to_lead"]') as HTMLElement).getByRole("button", { name: "Start" }));
    expect(await within(document.querySelector('[data-suggestion="speed_to_lead"]') as HTMLElement).findByRole("alert")).toHaveTextContent("You may not do this.");
    expect(nav.push).not.toHaveBeenCalled();
  });
  it("opened from the empty Jobs page (?look=): the plan card is there at the start", () => {
    draw(acts(), { initialPlan: mockPlan({ kind: "store_visits" }) });
    expect(within(screen.getByRole("article")).getByRole("heading", { name: "Book and remind store visits" })).toBeInTheDocument();
  });
});

describe("the Jobs page with no jobs yet", () => {
  const stuff = { suggestions: mockSuggestions(SAREE).items, suggestionActions: { start: vi.fn(async (kind: Parameters<typeof mockStartedFor>[0]) => ({ ok: true as const, data: mockStartedFor(kind) })) } };
  it("shows the suggested jobs inline (a Start each, a way to look first) and a way to say it instead, in place of the plain note", async () => {
    const { container } = render(<JobsList jobs={[]} filter="all" words={words} base={BASE} actions={null} {...stuff} />);
    expect(screen.getByRole("heading", { name: "No jobs yet" })).toBeInTheDocument();
    expect(container.querySelectorAll("[data-suggestion]")).toHaveLength(4);
    expect(screen.getAllByRole("button", { name: "Start" })).toHaveLength(4);
    expect(screen.getAllByRole("link", { name: "Look first" })[0]).toHaveAttribute("href", `${BASE}/jobs/new?look=speed_to_lead`);
    expect(screen.getByRole("link", { name: "Or say what you need…" })).toHaveAttribute("href", `${BASE}/jobs/new`);
    fireEvent.click(within(container.querySelector('[data-suggestion="followups"]') as HTMLElement).getByRole("button", { name: "Start" }));
    await waitFor(() => expect(stuff.suggestionActions.start).toHaveBeenCalledWith("followups"));
    await waitFor(() => expect(nav.push).toHaveBeenCalledWith(expect.stringContaining(`${BASE}/jobs/`)));
  });
  it("with jobs, or with nothing to suggest, or in a filter that is empty, the plain note and the rows stay as they were", () => {
    const { container, rerender } = render(<JobsList jobs={MOCK_JOBS} filter="all" words={words} base={BASE} actions={null} {...stuff} />);
    expect(container.querySelector('[data-part="jobs-empty"]')).toBeNull();
    expect(container.querySelectorAll("[data-job]")).toHaveLength(6);
    rerender(<JobsList jobs={[]} filter="all" words={words} base={BASE} actions={null} />);
    expect(container.querySelector('[data-part="jobs-empty"]')).toBeNull();
    expect(container.querySelector('p[data-empty="jobs"]')).not.toBeNull();
    rerender(<JobsList jobs={[MOCK_JOBS[0]]} filter="paused" words={words} base={BASE} actions={null} {...stuff} />);
    expect(container.querySelector('p[data-empty="jobs"]')).not.toBeNull();
  });
});
