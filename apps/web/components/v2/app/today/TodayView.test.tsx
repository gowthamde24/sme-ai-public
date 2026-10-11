import { act, cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => undefined, push: () => undefined }), usePathname: () => "/", useSearchParams: () => new URLSearchParams() }));

import { appT } from "@/i18n/app";

import { TodayView, dayLine } from "./TodayView";
import { NOW, call, classic, fakeActions, outbox, proposal, t } from "./today-test-kit";
import { NOTHING_TODAY, type Digest, type NeedsCard, type Role, type StoreToday, type StoreVisit, type TodayData } from "./types";

const READY: Digest = { state: "ready", sent: 6, held: 1, lines: [{ kind: "reply_to_inbound", n: 6 }, { kind: "quiet", n: 1, time: "9:00" }] };
const TEAM: TodayData["team"] = [
  { agent: "main", state: "idle", job: "Answers.", last_event: null },
  { agent: "lead_finder", state: "not_available", job: "Finds new businesses.", last_event: null },
  { agent: "researcher", state: "working", job: "Reads public pages.", last_event: null },
  { agent: "requirement_analyst", state: "switched_off", job: "Reads an enquiry.", last_event: null },
  { agent: "quote_writer", state: "idle", job: "Prepares a quote.", last_event: { text: "Prepared quote 3", at: "2026-10-11T02:00:00Z" } },
  { agent: "followup_desk", state: "idle", job: "Drafts follow-ups.", last_event: null },
  { agent: "order_desk", state: "idle", job: "Keeps orders in order.", last_event: null },
];
const CARDS: NeedsCard[] = [outbox(), call(), classic()];
const ready = (visits: StoreVisit[], over: Partial<StoreToday> = {}): TodayData["store"] => ({ state: "ready", visits, slots: "unknown", nextFree: null, ...over });
const data = (over: Partial<TodayData> = {}): TodayData => ({ cards: { waiting: 3, money_held_paise: 0, orders_open: 0 }, needs: CARDS, recent: [], team: TEAM, store: null, week: null, sending: null, digest: Promise.resolve(READY), ...over });
const view = async (d: TodayData, { name = "Asha" as string | null, hour = 9, role = "owner" as Role, ...rest }: { name?: string | null; hour?: number; role?: Role; lang?: string; outboxHref?: string | null; calendarHref?: string | null } = {}) => {
  const words = rest.lang && rest.lang !== "en" ? appT(rest.lang as "te") : null;
  // rendered inside an awaited act, so the parts that read a promise (use) settle before the test looks
  let out!: ReturnType<typeof render>;
  await act(async () => {
    out = render(<TodayView data={d} name={name} hour={hour} now={NOW} base="/app/tenants/T" t={words ? (k, v) => words(k as "frame.notyet", v) : t} role={role} actions={fakeActions()} {...rest} />);
  });
  return out;
};

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

describe("dayLine", () => {
  it("is the day in India, whatever zone the machine is in", () => {
    expect(dayLine(Date.parse("2026-10-11T05:00:00Z"), "en")).toBe("Sunday, 11 October");
    expect(dayLine(Date.parse("2026-10-10T19:00:00Z"), "en")).toBe("Sunday, 11 October"); // past midnight in India
  });
});

describe("Today: the header", () => {
  it("greets by the hour and by name, with the date", async () => {
    await view(data(), { name: "Asha", hour: 9 });
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Good morning, Asha");
    expect(screen.getByText("Sunday, 11 October")).toBeInTheDocument();
    cleanup();
    await view(data(), { name: null, hour: 14 });
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(/^Good afternoon$/);
    cleanup();
    await view(data(), { name: "Asha", hour: 20 });
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Good evening, Asha");
  });
});

describe("Today: the Agent OWL card", () => {
  it("says in one sentence how many things need the person, built from the real cards", async () => {
    await view(data());
    const hero = screen.getByRole("region", { name: "3 things need you. The rest is handled." });
    expect(within(hero).getByText("Agent OWL", { selector: "p" })).toBeInTheDocument();
    expect(hero).toHaveAttribute("data-part", "agent-owl");
  });
  it.each([
    [[], "Nothing needs you right now."],
    [[classic()], "1 thing needs you. The rest is handled."],
    [[classic(), call()], "2 things need you. The rest is handled."],
  ])("%# cards: '%s'", async (needs, text) => {
    await view(data({ needs: needs as NeedsCard[], cards: { waiting: (needs as NeedsCard[]).length, money_held_paise: 0, orders_open: 0 } }));
    expect(screen.getByRole("heading", { level: 2, name: text as string })).toBeInTheDocument();
  });
  it("an unreadable Today says 'Not available yet' instead of a number", async () => {
    await view(data({ needs: null, cards: NOTHING_TODAY.cards }));
    expect(within(screen.getByRole("region", { name: "Not available yet" })).queryByText(/things need you/)).toBeNull();
  });
  it("the overnight line comes from the outbox log, while a pulse stands in until it has been read", async () => {
    let settle!: (d: Digest) => void;
    const digest = new Promise<Digest>((r) => (settle = r));
    await view(data({ digest }));
    expect(screen.queryByText(/Overnight on WhatsApp/)).toBeNull();
    expect(document.querySelector('[data-part="agent-owl"] .animate-pulse')).not.toBeNull();
    await act(async () => settle(READY));
    expect(screen.getByText("Overnight on WhatsApp: 6 sent, 1 held for your OK.")).toBeInTheDocument();
  });
  it("says so when nothing was sent, says it could not be read when it could not, and says nothing at all to a person who may not read the log", async () => {
    await view(data({ digest: Promise.resolve({ state: "ready", sent: 0, held: 0, lines: [] }) }));
    expect(screen.getByText("Nothing was sent on WhatsApp in the last 24 hours.", { selector: "p" })).toBeInTheDocument();
    cleanup();
    await view(data({ digest: Promise.resolve({ state: "error" }) }));
    expect(screen.getByText("The overnight summary is not available yet.")).toBeInTheDocument();
    cleanup();
    await view(data({ digest: Promise.resolve({ state: "none" }) }));
    expect(document.querySelector('[data-part="overnight"]')).toBeNull();
    cleanup();
    await view(data({ digest: null }), { role: "viewer" });
    expect(document.querySelector('[data-part="overnight"]')).toBeNull();
    expect(document.querySelector('[data-part="done"]')).toBeNull();
  });
  it("the Ask box is in the card, 56 px high, with a microphone slot and three chips, the middle one in English and the last in the person's language", async () => {
    await view(data());
    const ask = document.querySelector('[data-ask="live"]')!;
    expect(ask.closest('[data-part="agent-owl"]')).not.toBeNull();
    const input = within(ask as HTMLElement).getByRole("textbox", { name: "Your question for Agent OWL" });
    expect(input.className).toContain("md:min-h-14");
    expect(input).toHaveAttribute("placeholder", "Ask anything, in any language…");
    expect(within(ask as HTMLElement).getAllByRole("listitem").map((li) => li.textContent)).toEqual(["What needs me today?", "Who should I call first?", "How much customer money is held?"]);
    cleanup();
    await view(data(), { lang: "te" });
    const chips = within(document.querySelector('[data-ask="live"]') as HTMLElement).getAllByRole("listitem").map((li) => li.textContent);
    expect(chips.slice(0, 2)).toEqual(["What needs me today?", "Who should I call first?"]); // always English
    expect(chips[2]).toBe(appT("te")("ask.chip.money")); // the person's language
  });
  it("the question line is fixed above the bottom bar on a phone and sits in the card on a laptop", async () => {
    await view(data());
    const form = document.querySelector('[data-ask="live"] form')!;
    expect(form.className).toContain("max-md:fixed");
    expect(form.className).toContain("max-md:bottom-[calc(4rem+env(safe-area-inset-bottom))]");
  });
  it("is 'Not available yet' while Agent OWL is not built, 'Switched off' when its switch is off, and the owl rests", async () => {
    await view(data({ team: TEAM!.map((a) => (a.agent === "main" ? { ...a, state: "not_available" as const } : a)) }));
    expect(document.querySelector('[data-ask="unavailable"]')).toHaveTextContent("Not available yet");
    expect(screen.getByRole("img", { name: "Agent OWL, Resting" })).toBeInTheDocument();
    cleanup();
    await view(data({ team: TEAM!.map((a) => (a.agent === "main" ? { ...a, state: "switched_off" as const } : a)) }));
    expect(document.querySelector('[data-ask="unavailable"]')).toHaveTextContent("Switched off");
  });
  it("the owl starts in the 'Ready' mood when Agent OWL is live", async () => {
    await view(data());
    expect(screen.getByRole("img", { name: "Agent OWL, Ready" })).toBeInTheDocument();
  });
});

describe("Today: the order of the sections", () => {
  it("header, then the Agent OWL card, then Needs you; the side sections follow in the document (below it on a phone)", async () => {
    await view(data({ store: ready([{ id: "v1", starts_at: "2026-10-11T05:30:00Z", who: "Priya S.", extra: 2, topic: "Bridal sarees", status: "confirmed", here: false }]), digest: Promise.resolve(READY) }));
    const at = (el: Element | null) => (el ? [...document.querySelectorAll("h1, h2")].indexOf(el.querySelector("h1, h2") ?? el) : -1);
    const order = ["h1", '[data-part="agent-owl"]', "#needs-you", '[data-part="visits"]', '[data-part="done"]', '[data-part="team"]'].map((sel) => document.querySelector(sel));
    expect(order.every(Boolean)).toBe(true);
    order.slice(1).forEach((el, i) => expect(order[i]!.compareDocumentPosition(el!) & Node.DOCUMENT_POSITION_FOLLOWING, `${i}`).toBeTruthy());
    void at;
  });
  it("the side column is store visits, then done while you slept, then your team", async () => {
    await view(data({ store: ready([{ id: "v1", starts_at: "2026-10-11T05:30:00Z", who: "Priya S.", extra: 0, topic: null, status: "confirmed", here: false }]) }));
    expect([...document.querySelectorAll("aside > section")].map((s) => s.getAttribute("data-part"))).toEqual(["visits", "done", "team"]);
  });
  it("leaves a room under the content for the fixed question line and bottom bar (phone only)", async () => {
    const { container } = await view(data());
    const spacer = container.querySelector('[data-screen="today"] > div[aria-hidden="true"]')!;
    expect(spacer.className).toContain("h-20");
    expect(spacer.className).toContain("md:hidden");
  });
});

describe("Today: the side sections", () => {
  it("'At the store today' is not drawn when it was not asked, and says so when it could not be read", async () => {
    await view(data({ store: null }));
    expect(document.querySelector('[data-part="visits"]')).toBeNull();
    cleanup();
    await view(data({ store: { state: "error" } }));
    expect(within(document.querySelector('[data-part="visits"]') as HTMLElement).getByText("Not available yet")).toBeInTheDocument();
  });
  it("draws the visits in time order with who comes with them, what for and where each stands", async () => {
    await view(
      data({ store: ready([
        { id: "b", starts_at: "2026-10-11T10:00:00Z", who: "Mahesh, Hindupur", extra: 0, topic: "Shop restock, about 40 pieces", status: "reminder_sent", here: false },
        { id: "a", starts_at: "2026-10-11T05:30:00Z", who: "Priya S.", extra: 2, topic: "Bridal sarees", status: "confirmed", here: false },
        { id: "c", starts_at: "2026-10-11T04:30:00Z", who: "Anita R.", extra: 0, topic: null, status: "requested", here: false },
      ]) }),
    );
    const s = screen.getByRole("heading", { name: "At the store today" }).closest("section")!;
    expect(within(s).getByText("3 visits")).toBeInTheDocument();
    expect(within(s).getAllByRole("listitem").map((li) => li.textContent)).toEqual(["10:00Anita R.Waiting for the customer", "11:00Priya S. + 2Bridal sareesConfirmed", "15:30Mahesh, HindupurShop restock, about 40 piecesReminder sent"]);
    expect(within(s).getByRole("link", { name: "Open the visit calendar" })).toHaveAttribute("href", "/app/tenants/T/visits");
    expect(within(s).getByRole("link", { name: "Book a visit" })).toHaveAttribute("href", "/app/tenants/T/visits#book");
  });
  it("says 'Here now' for a customer who has arrived", async () => {
    await view(data({ store: ready([{ id: "a", starts_at: "2026-10-11T05:30:00Z", who: "Priya S.", extra: 0, topic: null, status: "confirmed", here: true }]) }));
    const s = document.querySelector('[data-part="visits"]') as HTMLElement;
    expect(within(s).getByText("Here now")).toBeInTheDocument();
    expect(within(s).queryByText("Confirmed")).toBeNull();
  });
  it("one line about the rest of the day: the next free time, 'every time is taken', 'closed today', or nothing when it could not be read", async () => {
    await view(data({ store: ready([], { slots: "free", nextFree: "2026-10-11T11:00:00Z" }) }));
    expect(document.querySelector('[data-line="slots"]')).toHaveTextContent("Next free time today: 16:30");
    cleanup();
    await view(data({ store: ready([], { slots: "full" }) }));
    expect(document.querySelector('[data-line="slots"]')).toHaveTextContent("Every time left today is taken.");
    cleanup();
    await view(data({ store: ready([], { slots: "closed" }) }));
    expect(document.querySelector('[data-line="slots"]')).toHaveTextContent("The shop is closed today.");
    cleanup();
    await view(data({ store: ready([], { slots: "unknown" }) }));
    expect(document.querySelector('[data-line="slots"]')).toBeNull();
  });
  it("with no visits it still says so and offers the calendar and the booking", async () => {
    await view(data({ store: ready([]) }));
    const s = document.querySelector('[data-part="visits"]') as HTMLElement;
    expect(within(s).getByText("No visits booked for today.")).toBeInTheDocument();
    expect(within(s).getByText("None yet")).toBeInTheDocument();
    expect(within(s).getByRole("link", { name: "Book a visit" })).toBeInTheDocument();
  });
  it("a Viewer sees the visits and the calendar but is not offered the booking", async () => {
    await view(data({ store: ready([{ id: "a", starts_at: "2026-10-11T05:30:00Z", who: "Priya S.", extra: 0, topic: null, status: "requested", here: false }]) }), { role: "viewer" });
    const s = document.querySelector('[data-part="visits"]') as HTMLElement;
    expect(within(s).getByRole("link", { name: "Open the visit calendar" })).toBeInTheDocument();
    expect(within(s).queryByRole("link", { name: "Book a visit" })).toBeNull();
  });
  it("'Done while you slept' lists at most four lines from the outbox log, with plurals, and a link only when there is an outbox page", async () => {
    const lines: Digest = { state: "ready", sent: 8, held: 0, lines: [{ kind: "reply_to_inbound", n: 6 }, { kind: "info", n: 1 }, { kind: "visit", n: 2 }, { kind: "quiet", n: 1, time: "9:00" }] };
    await view(data({ digest: Promise.resolve(lines) }));
    const s = screen.getByRole("heading", { name: "Done while you slept" }).closest("section")!;
    expect(within(s).getAllByRole("listitem").map((li) => li.textContent)).toEqual(["Replied to 6 customers on WhatsApp", "Sent shop information to 1 customer", "Sent visit messages to 2 customers", "Held 1 message until 9:00 (quiet hours)"]);
    expect(within(s).queryByRole("link")).toBeNull();
    cleanup();
    await view(data({ digest: Promise.resolve(lines) }), { outboxHref: "/app/tenants/T/outbox" });
    expect(screen.getByRole("link", { name: "See everything in the outbox" })).toHaveAttribute("href", "/app/tenants/T/outbox");
  });
  it("'Done while you slept' has a loading state, an empty state, an error state, and is not drawn for someone who may not read the log", async () => {
    await view(data({ digest: new Promise<Digest>(() => {}) }));
    expect(document.querySelector('[data-part="done"]')).toBeNull();
    expect(screen.getByRole("heading", { name: "Done while you slept" }).closest("section")).toHaveAttribute("aria-busy", "true");
    cleanup();
    await view(data({ digest: Promise.resolve({ state: "ready", sent: 0, held: 0, lines: [] }) }));
    expect(within(document.querySelector('[data-part="done"]') as HTMLElement).getByText("Nothing was sent in the last 24 hours.")).toBeInTheDocument();
    cleanup();
    await view(data({ digest: Promise.resolve({ state: "error" }) }));
    expect(within(document.querySelector('[data-part="done"]') as HTMLElement).getByText("Not available yet")).toBeInTheDocument();
    cleanup();
    await view(data({ digest: Promise.resolve({ state: "none" }) }));
    expect(screen.queryByRole("heading", { name: "Done while you slept" })).toBeNull();
  });
  it("'Your team' shows the six helpers as owls in their own colours, one live status line each, and not Agent OWL itself", async () => {
    await view(data());
    const s = screen.getByRole("heading", { name: "Your team" }).closest("section")!;
    const rows = within(s).getAllByRole("listitem");
    expect(rows).toHaveLength(6);
    expect(rows.map((r) => r.querySelector("svg")?.getAttribute("data-owl"))).toEqual(["lead_finder", "researcher", "requirement_analyst", "quote_writer", "followup_desk", "order_desk"]);
    expect(within(s).queryByText("Agent OWL")).toBeNull();
    expect(rows.map((r) => r.querySelectorAll("span")[1]?.textContent ?? r.textContent)).toEqual([
      expect.stringContaining("Not available yet"),
      expect.stringContaining("Working"),
      expect.stringContaining("Switched off"),
      expect.stringContaining("Prepared quote 3 · 3h"),
      expect.stringContaining("Idle"),
      expect.stringContaining("Idle"),
    ]);
    expect(within(s).getByRole("link", { name: /Open the office/ })).toHaveAttribute("href", "/app/tenants/T/office");
  });
  it("'Your team' says 'Not available yet' when the helpers could not be read", async () => {
    await view(data({ team: null }));
    expect(within(screen.getByRole("heading", { name: "Your team" }).closest("section")!).getByText("Not available yet")).toBeInTheDocument();
  });
});

describe("Today: the count is the cards", () => {
  it("the badge and the sentence say 3 for three cards, one of them a visit Agent OWL proposed (the API already counts it)", async () => {
    await view(data({ cards: { waiting: 3, money_held_paise: 0, orders_open: 0 }, needs: [outbox(), call(), proposal()] }));
    expect(screen.getByRole("heading", { level: 2, name: "3 things need you. The rest is handled." })).toBeInTheDocument();
    expect(document.querySelector("[data-count]")).toHaveAttribute("data-count", "3");
  });
  it("when the API counts more than it lists, the difference is said, never a card-less number hidden", async () => {
    await view(data({ cards: { waiting: 5, money_held_paise: 0, orders_open: 0 }, needs: [outbox(), call(), proposal()] }));
    expect(document.querySelector("[data-count]")).toHaveAttribute("data-count", "5");
  });
});

describe("Today: sending stopped", () => {
  it("a clear banner above the Agent OWL card when sending is stopped for the whole system", async () => {
    await view(data({ sending: { stopped: true } }));
    const banner = document.querySelector('[data-banner="sending-stopped"]') as HTMLElement;
    expect(banner).toHaveTextContent("Sending is stopped");
    expect(banner).toHaveTextContent("Nothing goes out and everything waits until the operator switches sending back on.");
    expect(banner.compareDocumentPosition(document.querySelector('[data-part="agent-owl"]') as Element) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
  it("no banner when sending is on, or when it is not known (a Sales, a Viewer, a read that failed)", async () => {
    await view(data({ sending: { stopped: false } }));
    expect(document.querySelector('[data-banner="sending-stopped"]')).toBeNull();
    cleanup();
    await view(data({ sending: null }));
    expect(document.querySelector('[data-banner="sending-stopped"]')).toBeNull();
  });
});

describe("Today: sections that have no data are not drawn, and nothing is invented", () => {
  it("with nothing readable it still draws the header, the card and the two honest places", async () => {
    await view({ ...NOTHING_TODAY }, { name: null });
    expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument();
    expect(document.querySelector('[data-part="visits"]')).toBeNull();
    expect(document.querySelector('[data-part="done"]')).toBeNull();
    expect(screen.getAllByText("Not available yet").length).toBeGreaterThanOrEqual(3);
    expect(screen.queryByText(/₹/)).toBeNull();
  });
});
