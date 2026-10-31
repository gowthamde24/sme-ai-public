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
const data = (over: Partial<TodayData> = {}): TodayData => ({ cards: { waiting: 3, money_held_paise: 0, orders_open: 0 }, needs: CARDS, recent: [], team: TEAM, deskTeam: null, store: null, week: null, sending: null, digest: Promise.resolve(READY), ...over });
const view = async (d: TodayData, { name = "Asha" as string | null, hour = 9, role = "owner" as Role, ...rest }: { name?: string | null; hour?: number; role?: Role; lang?: string; demo?: boolean; outboxHref?: string | null; calendarHref?: string | null } = {}) => {
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

describe("Today: the command bar", () => {
  it("is a compact bar (not a card with a headline): one line to write in, with the chips, and no empty chat area", async () => {
    await view(data());
    const bar = document.querySelector('[data-part="command-bar"]') as HTMLElement;
    expect(bar).not.toBeNull();
    expect(bar.className).toContain("max-md:hidden"); // a phone has the floating orb instead
    expect(document.querySelector('[data-part="agent-owl"]')).toBeNull(); // the big assistant card is gone
    const ask = document.querySelector('[data-ask="live"]')!;
    expect(ask.closest('[data-part="command-bar"]')).not.toBeNull();
    const input = within(ask as HTMLElement).getByRole("textbox", { name: "Your question for your assistant" });
    expect(input).toHaveAttribute("placeholder", "Ask your assistant anything, in any language…");
    expect(document.querySelectorAll("input[type=text], input:not([type])")).toHaveLength(1); // exactly one input on the page
    expect(within(ask as HTMLElement).getAllByRole("listitem").map((li) => li.textContent)).toEqual(["What needs me today?", "Who should I call first?", "How much customer money is held?"]);
    cleanup();
    await view(data(), { lang: "te" });
    const chips = within(document.querySelector('[data-ask="live"]') as HTMLElement).getAllByRole("listitem").map((li) => li.textContent);
    expect(chips).toEqual([appT("te")("ask.chip.needs"), appT("te")("ask.chip.call"), appT("te")("ask.chip.money")]); // the person's language, all three
  });
  it("the question line is a line, not a bar fixed to the screen", async () => {
    await view(data());
    const form = document.querySelector('[data-ask="live"] form')!;
    expect(form.className).not.toContain("fixed");
    expect(form.closest('[data-part="command-bar"]')).not.toBeNull();
    expect(document.querySelector('[data-screen="today"] form.fixed')).toBeNull();
  });
  it("is 'Not available yet' while your assistant is not built and 'Switched off' when its switch is off", async () => {
    await view(data({ team: TEAM!.map((a) => (a.agent === "main" ? { ...a, state: "not_available" as const } : a)) }));
    expect(document.querySelector('[data-ask="unavailable"]')).toHaveTextContent("Not available yet");
    cleanup();
    await view(data({ team: TEAM!.map((a) => (a.agent === "main" ? { ...a, state: "switched_off" as const } : a)) }));
    expect(document.querySelector('[data-ask="unavailable"]')).toHaveTextContent("Switched off");
  });
  it("no usage meter on Today any more (it moved to Settings, Plan and usage)", async () => {
    await view(data());
    expect(screen.queryByText(/% left/)).toBeNull();
    expect(screen.queryByRole("meter")).toBeNull();
  });
});

describe("Today: the order of the sections", () => {
  it("header, then Needs you FIRST, then the command bar, then the other cards (below it on a phone)", async () => {
    await view(data({ store: ready([{ id: "v1", starts_at: "2026-10-11T05:30:00Z", who: "Priya S.", extra: 2, topic: "Bridal sarees", status: "confirmed", here: false }]), digest: Promise.resolve(READY) }));
    const order = ["h1", "#needs-you", '[data-part="command-bar"]', '[data-part="visits"]', '[data-part="done"]', '[data-part="team"]'].map((sel) => document.querySelector(sel));
    expect(order.every(Boolean)).toBe(true);
    order.slice(1).forEach((el, i) => expect(order[i]!.compareDocumentPosition(el!) & Node.DOCUMENT_POSITION_FOLLOWING, `${i}`).toBeTruthy());
  });
  it("the other cards are store visits, then done while you slept, then your team", async () => {
    await view(data({ store: ready([{ id: "v1", starts_at: "2026-10-11T05:30:00Z", who: "Priya S.", extra: 0, topic: null, status: "confirmed", here: false }]) }));
    expect([...document.querySelectorAll('[data-screen="today"] section[data-part]:not([data-part="command-bar"])')].map((s) => s.getAttribute("data-part"))).toEqual(["visits", "done", "team"]);
  });
  it("has no spacer for a bottom bar any more: there is none", async () => {
    const { container } = await view(data());
    expect(container.querySelector('[data-screen="today"] > div[aria-hidden="true"]')).toBeNull();
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
  it("'Your team' shows the six helpers as icons of their jobs, one live status line each, and not your assistant itself", async () => {
    await view(data());
    const s = screen.getByRole("heading", { name: "Your team" }).closest("section")!;
    const rows = within(s).getAllByRole("listitem");
    expect(rows).toHaveLength(6);
    expect(rows.map((r) => r.querySelector("[data-agent-mark]")?.getAttribute("data-agent-mark"))).toEqual(["lead_finder", "researcher", "requirement_analyst", "quote_writer", "followup_desk", "order_desk"]);
    expect(within(s).queryByText("Your assistant")).toBeNull();
    // the still has one pose, so each helper's state is also a dot beside its name (working, calm, off)
    expect(rows.map((r) => r.querySelector("[data-state-dot]")?.getAttribute("data-state-dot"))).toEqual(["off", "working", "off", "idle", "idle", "idle"]);
    expect(rows.map((r) => r.querySelector("span.line-clamp-2")?.textContent ?? r.textContent)).toEqual([
      expect.stringContaining("Not available yet"),
      expect.stringContaining("Working"),
      expect.stringContaining("Switched off"),
      expect.stringContaining("Prepared quote 3 · 3h"),
      expect.stringContaining("Idle"),
      expect.stringContaining("Idle"),
    ]);
    expect(within(s).getByRole("link", { name: /Open the office/ })).toHaveAttribute("href", "/app/tenants/T/office");
  });
  it("'Your team' of a Lead Desk workspace lists its own workers with the real status line, never the shop's helpers or 'Not available yet'", async () => {
    await view(data({ deskTeam: [
      { key: "leads", state: "idle", name: "Lead catcher", text: "Last lead: Anita R. from IndiaMART", at: "2026-10-11T04:40:00Z" },
      { key: "calls", state: "working", name: "Caller", text: "Calling Diwali leads: 12 of 40 done", at: null },
      { key: "rules", state: "off", name: "Standing rules", text: "No rule is on", at: null },
      { key: "tasks", state: "not_available", name: "Task helper", text: null, at: null },
    ] }));
    const s = screen.getByRole("heading", { name: "Your team" }).closest("section")!;
    const rows = within(s).getAllByRole("listitem");
    expect(rows.map((r) => r.querySelector("[data-part=team-name]")?.textContent)).toEqual(["Lead catcher", "Caller", "Standing rules", "Task helper"]);
    expect(rows.map((r) => r.querySelector("[data-part=team-status]")?.textContent)).toEqual(["Last lead: Anita R. from IndiaMART · 20m", "Calling Diwali leads: 12 of 40 done", "No rule is on", "Not available yet"]);
    expect(rows.map((r) => r.querySelector("[data-state-dot]")?.getAttribute("data-state-dot"))).toEqual(["idle", "working", "off", "off"]);
    expect(within(s).queryByText("Quote writer")).toBeNull();
    expect(within(s).queryByText("Lead Finder")).toBeNull();
  });
  it("'Your team' says 'Not available yet' when the helpers could not be read", async () => {
    await view(data({ team: null }));
    expect(within(screen.getByRole("heading", { name: "Your team" }).closest("section")!).getByText("Not available yet")).toBeInTheDocument();
  });
});

describe("Today: the count is the cards", () => {
  it("the badge says 3 for three cards, one of them a visit your assistant proposed (the API already counts it)", async () => {
    await view(data({ cards: { waiting: 3, money_held_paise: 0, orders_open: 0 }, needs: [outbox(), call(), proposal()] }));
    expect(document.querySelector("[data-count]")).toHaveAttribute("data-count", "3");
  });
  it("when the API counts more than it lists, the difference is said, never a card-less number hidden", async () => {
    await view(data({ cards: { waiting: 5, money_held_paise: 0, orders_open: 0 }, needs: [outbox(), call(), proposal()] }));
    expect(document.querySelector("[data-count]")).toHaveAttribute("data-count", "5");
  });
});

describe("Today: sending stopped", () => {
  it("a clear banner above Needs you when sending is stopped for the whole system", async () => {
    await view(data({ sending: { stopped: true } }));
    const banner = document.querySelector('[data-banner="sending-stopped"]') as HTMLElement;
    expect(banner).toHaveTextContent("Sending is stopped");
    expect(banner).toHaveTextContent("Nothing goes out and everything waits until our team switches sending back on.");
    expect(banner.compareDocumentPosition(document.querySelector("#needs-you") as Element) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
  it("a demo workspace says it is a demo and that nothing goes out, and never says 'operator' (fix-today-ask)", async () => {
    await view(data({ sending: { stopped: true } }), { demo: true });
    const banner = document.querySelector('[data-banner="sending-stopped"]') as HTMLElement;
    expect(banner).toHaveTextContent("Demo workspace: sending is switched off. Nothing goes out; you can still read and edit messages.");
    expect(banner.textContent ?? "").not.toMatch(/operator/i);
    cleanup();
    await view(data({ sending: { stopped: true } }));
    expect((document.querySelector('[data-banner="sending-stopped"]')!.textContent ?? "")).not.toMatch(/operator/i);
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

describe("Today: the greeting names the member, respectfully, in their language (owner 31 Oct)", () => {
  it("English: the name alone, never sir or madam; Telugu: గారు; Hindi: जी; Kannada: ಅವರೇ; none when there is no name", async () => {
    await view(data(), { name: "Gowtham Reddy", hour: 20 });
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Good evening, Gowtham Reddy");
    expect(screen.getByRole("heading", { level: 1 }).textContent).not.toMatch(/sir|madam/i);
    for (const [lang, tail] of [["te", "గారు"], ["hi", "जी"], ["kn", "ಅವರೇ"]] as const) {
      cleanup();
      await view(data(), { name: "Gowtham", hour: 20, lang });
      expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(`${appT(lang)("today.greeting.evening")}, Gowtham ${tail}`);
    }
    cleanup();
    await view(data(), { name: null, hour: 20, lang: "te" });
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(appT("te")("today.greeting.evening"));
  });
  it("the Live now pill sits on the greeting row (the same header as the heading), not in the top bar", async () => {
    await view(data());
    const header = document.querySelector('[data-screen="today"] > header') as HTMLElement;
    expect(header.querySelector("h1")).not.toBeNull();
    expect(header.className).toContain("md:justify-between");
  });
});
