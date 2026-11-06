import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { appT } from "@/i18n/app";
import { AGENT_KEYS } from "@/lib/api/today";

import type { AgentSwitch } from "@/lib/api/agent-switches";

import { OfficeRoom, type RoomRow, type TeamExtras } from "./OfficeRoom";
import type { ClientEnv } from "./view";

const h = vi.hoisted(() => ({ env: {} as Record<string, unknown> }));
vi.mock("./view", async (orig) => ({ ...(await orig<typeof import("./view")>()), readClientEnv: () => h.env }));
const en = appT("en");
const W = (k: string) => en(k as "frame.notyet");
const KEYS = ["office.title", "office.sub", "office.idle", "office.working", "office.switchedoff", "frame.notyet", "office.latest", "office.noevents", "office.pick", "office.runs", "office.viewroom", "office.viewlist", "office.listintro", "office.viewswitch", "office.hint", "office.feed", "office.settings", "office.switch", "office.done.one", "office.done.other", "office.locked.platform", "office.locked.workspace_off", "office.sw.on", "office.sw.off", "office.sw.err.forbidden", "office.sw.err.locked", "office.sw.err.down", ...AGENT_KEYS.map((a) => `agent.${a}`)];
const WORDS = Object.fromEntries(KEYS.map((k) => [k, W(k)]));
const NOW = Date.UTC(2026, 9, 9, 12, 0, 0);
const at = (minutesAgo: number) => new Date(NOW - minutesAgo * 60_000).toISOString();
const rows = (patch: Partial<Record<(typeof AGENT_KEYS)[number], Partial<RoomRow>>> = {}): RoomRow[] =>
  AGENT_KEYS.map((agent) => ({ agent, state: "idle" as const, job: `Job of ${agent}.`, event: null, ...patch[agent] }));
const CAPABLE: ClientEnv = { reducedMotion: false, lite: false, remembered: null };
/** The board's own tests start on the board (a person who chose it before): My AI team opens on the cards (sidebar v2). */
const ON_BOARD: ClientEnv = { ...CAPABLE, remembered: "room" };
const room = (r: RoomRow[] = rows(), selected: RoomRow["agent"] | null = null) => render(<OfficeRoom rows={r} selected={selected} base="/app/tenants/T" words={WORDS} />);
const switchBtn = (name: string) => screen.getByRole("button", { name });
const seat = (id: string) => document.querySelector<HTMLElement>(`[data-office="team"] li[data-agent="${id}"]`)!;
const tag = (id: string, text: string) => within(seat(id)).getByRole("button", { name: text });

beforeEach(() => {
  h.env = { ...ON_BOARD };
  window.localStorage.clear();
  window.history.replaceState(null, "", "/app/tenants/T/office");
});
afterEach(cleanup);

describe("OfficeRoom: which view first", () => {
  it("My AI team opens on one card per helper (owner, 5 Nov), and the switch says so; the board is one press away", () => {
    h.env = { ...CAPABLE };
    room();
    expect(screen.getByRole("region", { name: "My AI team" })).toBeInTheDocument();
    expect(switchBtn("List view")).toHaveAttribute("aria-pressed", "true");
    expect(switchBtn("Board view")).toHaveAttribute("aria-pressed", "false");
    expect(document.querySelector('[data-office="team"]')).toBeNull();
  });
  it("the board, once chosen, is remembered", () => {
    room();
    expect(document.querySelector('[data-office="team"]')).not.toBeNull();
    expect(switchBtn("Board view")).toHaveAttribute("aria-pressed", "true");
  });
  it("the server's first paint (no browser facts yet) is the room too, so the page and the hydrated page agree", () => {
    h.env = null as unknown as Record<string, unknown>;
    expect(() => room()).not.toThrow();
  });
  it("seven tiles: the main assistant first and the six helpers in the API's order, each with its own picture (the circle, or the icon of its job)", () => {
    room();
    expect([...document.querySelectorAll('[data-office="team"] li')].map((li) => li.getAttribute("data-agent"))).toEqual([...AGENT_KEYS]);
    expect(seat("main").querySelector('[data-orb]')).not.toBeNull();
    for (const id of AGENT_KEYS.filter((k) => k !== "main")) expect(seat(id).querySelector(`[data-agent-mark="${id}"]`), id).not.toBeNull();
  });
  it("the person can leave the room for the List (and it is remembered), and come back", () => {
    room();
    fireEvent.click(switchBtn("List view"));
    expect(document.querySelector('[data-office="team"]')).toBeNull();
    expect(screen.getByRole("region", { name: "My AI team" })).toBeInTheDocument();
    expect(window.localStorage.getItem("sme_office_view")).toBe("list");
    fireEvent.click(switchBtn("Board view"));
    expect(document.querySelector('[data-office="team"]')).not.toBeNull();
    expect(window.localStorage.getItem("sme_office_view")).toBe("room");
  });
  it("what the person chose last time wins; the old view's name (3d) is forgotten, not an error", () => {
    h.env = { ...CAPABLE, remembered: "list" };
    room();
    expect(screen.getByRole("region", { name: "My AI team" })).toBeInTheDocument();
    cleanup();
    h.env = { ...CAPABLE, remembered: null };
    window.localStorage.setItem("sme_office_view", "3d");
    room();
    expect(screen.getByRole("region", { name: "My AI team" })).toBeInTheDocument(); // the cards, the default
  });
});

describe("OfficeRoom: the pose of each helper follows the API's state", () => {
  const mixed = rows({
    main: { state: "not_available" },
    lead_finder: { state: "not_available" },
    researcher: { state: "switched_off" },
    quote_writer: { state: "working", event: { text: "Prepared quote 3", ago: "3h", at: at(180) } },
  });
  it("working pulses its dot, idle is calm, switched off and not built are faded", () => {
    room(mixed);
    expect(seat("quote_writer").querySelector('[data-state-dot="working"]')).not.toBeNull();
    expect(seat("order_desk").querySelector('[data-state-dot="idle"]')).not.toBeNull();
    for (const id of ["main", "lead_finder", "researcher"]) {
      expect(seat(id).querySelector('[data-state-dot="off"]'), id).not.toBeNull();
      expect(seat(id).innerHTML, id).toContain("opacity-45");
    }
    expect(seat("order_desk").innerHTML).not.toContain("opacity-45");
  });
  it("each tag carries the helper's name and state (Working, Idle, Switched off, Not available yet)", () => {
    room(mixed);
    expect(tag("main", "Your assistant Not available yet")).toHaveAttribute("aria-pressed", "false");
    expect(seat("main")).toHaveAttribute("data-pose", "off");
    expect(tag("researcher", "Researcher Switched off")).toBeInTheDocument();
    expect(tag("quote_writer", "Quote Writer Working")).toBeInTheDocument();
    expect(seat("quote_writer")).toHaveAttribute("data-pose", "working");
    expect(tag("order_desk", "Order Desk Idle")).toBeInTheDocument();
    expect(seat("order_desk")).toHaveAttribute("data-pose", "idle");
  });
  it("the List says 'Switched off' for a switched-off helper and 'Not available yet' for one that is not built", () => {
    h.env = { ...CAPABLE, remembered: "list" };
    room(mixed);
    const items = within(screen.getByRole("region", { name: "My AI team" })).getAllByRole("listitem");
    expect(items[2]).toHaveTextContent("ResearcherSwitched off");
    expect(items[1]).toHaveTextContent("Lead FinderNot available yet");
  });
});

describe("OfficeRoom: choosing a helper, the feed, the switch", () => {
  const mixed = rows({
    main: { state: "not_available" },
    lead_finder: { state: "not_available" },
    researcher: { state: "switched_off" },
    quote_writer: { state: "working", event: { text: "Prepared quote 3", ago: "3h", at: at(180) } },
  });
  it("tapping a helper in the room opens their panel (state, job, latest event) and writes ?agent= into the address; tapping again closes it", () => {
    room(mixed);
    expect(screen.getByText(/Tap a teammate on the board/)).toBeInTheDocument();
    fireEvent.click(tag("quote_writer", "Quote Writer Working"));
    const panel = screen.getByRole("heading", { level: 2, name: "Quote Writer" }).closest("section")!;
    expect(panel).toHaveTextContent("Working");
    expect(panel).toHaveTextContent("Job of quote_writer.");
    expect(panel).toHaveTextContent("Prepared quote 3 · 3h");
    expect(window.location.search).toBe("?agent=quote_writer");
    fireEvent.click(tag("quote_writer", "Quote Writer Working"));
    expect(screen.getByText(/Tap a teammate on the board/)).toBeInTheDocument();
    expect(window.location.search).toBe("");
    // a tile is one button: pressing it chooses the helper
    fireEvent.click(tag("researcher", "Researcher Switched off"));
    expect(screen.getByRole("heading", { level: 2, name: "Researcher" })).toBeInTheDocument();
    expect(tag("researcher", "Researcher Switched off")).toHaveAttribute("aria-pressed", "true");
  });
  it("a card of the List chooses a helper without leaving the page, but stays a real link (a new tab or a modified click goes to ?agent=)", () => {
    h.env = { ...CAPABLE, remembered: "list" };
    room(mixed);
    const link = screen.getByRole("link", { name: /Quote Writer/ });
    expect(link).toHaveAttribute("href", "/app/tenants/T/ai-team?agent=quote_writer");
    expect(fireEvent.click(link)).toBe(false); // default prevented: handled here
    expect(screen.getByRole("heading", { level: 2, name: "Quote Writer" })).toBeInTheDocument();
    expect(fireEvent.click(screen.getByRole("link", { name: /Researcher/ }), { ctrlKey: true })).toBe(true); // left to the browser
  });
  it("a helper chosen by ?agent= is open from the first paint", () => {
    room(mixed, "researcher");
    expect(screen.getByRole("heading", { level: 2, name: "Researcher" })).toBeInTheDocument();
    expect(seat("researcher")).toHaveAttribute("data-selected", "true");
  });
  it("the event feed is the helpers' latest events, newest first, with the time and the helper on one line", () => {
    const r = rows({
      researcher: { event: { text: "Read a public page", ago: "2d", at: at(2 * 1440) } },
      quote_writer: { event: { text: "Prepared quote 3", ago: "5m", at: at(5) } },
      order_desk: { event: { text: "Checked an advance", ago: "1h", at: at(60) } },
    });
    room(r);
    const feed = screen.getByRole("heading", { name: "Event feed" }).closest("section")!;
    const items = within(feed).getAllByRole("listitem");
    expect(items.map((i) => i.textContent)).toEqual(["5m · Quote WriterPrepared quote 3", "1h · Order DeskChecked an advance", "2d · ResearcherRead a public page"]);
  });
  it("an event with a page is a link in the feed and in the panel; one without is plain text", () => {
    const r = rows({
      quote_writer: { event: { text: "Prepared quote 3", ago: "5m", at: at(5), href: "/app/tenants/T/enquiries/E?quote=Q" } },
      main: { event: { text: "Answered a question", ago: "9m", at: at(9), href: null } },
    });
    room(r, "quote_writer");
    const feed = screen.getByRole("heading", { name: "Event feed" }).closest("section")!;
    expect(within(feed).getByRole("link", { name: "Prepared quote 3" })).toHaveAttribute("href", "/app/tenants/T/enquiries/E?quote=Q");
    expect(within(feed).getByText("Answered a question").closest("a")).toBeNull();
    const panel = screen.getByRole("heading", { level: 2, name: "Quote Writer" }).closest("section")!;
    expect(within(panel).getByRole("link", { name: "Prepared quote 3" })).toHaveAttribute("href", "/app/tenants/T/enquiries/E?quote=Q");
  });
  it("with no event at all the feed says so; it invents none", () => {
    room(rows());
    expect(within(screen.getByRole("heading", { name: "Event feed" }).closest("section")!).getByText("No events yet.")).toBeInTheDocument();
  });
  it("the feed shows at most six", () => {
    const r = rows(Object.fromEntries(AGENT_KEYS.map((a, i) => [a, { event: { text: `Event ${i}`, ago: `${i}m`, at: at(i) } }])));
    room(r);
    expect(within(screen.getByRole("heading", { name: "Event feed" }).closest("section")!).getAllByRole("listitem")).toHaveLength(6);
  });
});

describe("OfficeRoom: the switch", () => {
  it("is a labelled group of two real buttons that are at least 44px tall", () => {
    room();
    const group = screen.getByRole("group", { name: "Choose a view" });
    expect(within(group).getAllByRole("button")).toHaveLength(2);
    for (const b of within(group).getAllByRole("button")) expect(b.className).toContain("min-h-11");
  });
  it("storage that is blocked only means the choice is not remembered", () => {
    room();
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(() => fireEvent.click(switchBtn("List view"))).not.toThrow();
    expect(screen.getByRole("region", { name: "My AI team" })).toBeInTheDocument();
    spy.mockRestore();
  });
});

describe("My AI team: each helper's own switch, today's work and settings (C1's agents-switches)", () => {
  const SW = (agent: string, over: Partial<AgentSwitch> = {}): AgentSwitch => ({ agent: agent as AgentSwitch["agent"], enabled: true, canSwitch: true, reasonLocked: null, doneToday: 0, ...over });
  const SWITCHES = {
    main: SW("main", { doneToday: 3 }),
    researcher: SW("researcher", { enabled: false, doneToday: 1 }),
    requirement_analyst: SW("requirement_analyst", { canSwitch: false, reasonLocked: "workspace_off" }),
    quote_writer: SW("quote_writer", { canSwitch: false, reasonLocked: "not_built", doneToday: null }),
  };
  const team = (over: Partial<TeamExtras> = {}): TeamExtras => ({ switches: SWITCHES, settings: { main: "/app/tenants/T/settings?section=assistant", quote_writer: "/app/tenants/T/quote-policy" }, toggle: vi.fn(async (agent: string, enabled: boolean) => ({ ok: true as const, data: SW(agent, { enabled, doneToday: 1 }) })), ...over });
  const cardOf = (id: string) => document.querySelector<HTMLElement>(`li[data-helper="${id}"]`)!;
  const show = (t: TeamExtras) => {
    h.env = { ...CAPABLE };
    render(<OfficeRoom rows={rows()} selected={null} base="/app/tenants/T" words={WORDS} team={t} />);
  };

  it("a switch only where the helper has one; a helper switched off by the workspace says so; a feature with none shows no toggle", () => {
    show(team());
    expect(within(cardOf("main")).getByRole("switch", { name: "On or off: " + W("agent.main") })).toBeChecked();
    expect(within(cardOf("main")).getByText("3 done today")).toBeInTheDocument();
    expect(within(cardOf("researcher")).getByRole("switch")).not.toBeChecked();
    expect(within(cardOf("researcher")).getByText("1 done today")).toBeInTheDocument();
    expect(within(cardOf("requirement_analyst")).queryByRole("switch")).toBeNull();
    expect(within(cardOf("requirement_analyst")).getByText("AI helpers are off in Settings")).toBeInTheDocument();
    expect(within(cardOf("quote_writer")).queryByRole("switch")).toBeNull();
    expect(within(cardOf("quote_writer")).getByRole("link", { name: "Settings" })).toHaveAttribute("href", "/app/tenants/T/quote-policy");
    expect(within(cardOf("order_desk")).queryByRole("link", { name: "Settings" })).toBeNull();
  });

  it("the Owner turns a helper on; the card shows what the API answered", async () => {
    const t = team();
    show(t);
    await act(async () => fireEvent.click(within(cardOf("researcher")).getByRole("switch")));
    expect(t.toggle).toHaveBeenCalledWith("researcher", true);
    expect(within(cardOf("researcher")).getByRole("switch")).toBeChecked();
  });

  it("a refusal is said in words and the switch stays as it was; an Admin sees the switch but cannot move it", async () => {
    show(team({ toggle: vi.fn(async () => ({ ok: false as const, error: "down" })) }));
    await act(async () => fireEvent.click(within(cardOf("main")).getByRole("switch")));
    expect(within(cardOf("main")).getByRole("alert")).toHaveTextContent("That didn't change. Please try again.");
    expect(within(cardOf("main")).getByRole("switch")).toBeChecked();
    cleanup();
    show(team({ toggle: null }));
    expect(within(cardOf("main")).getByRole("switch")).toBeDisabled();
  });

  it("switches that cannot be read draw no switch at all", () => {
    show(team({ switches: null }));
    expect(screen.queryByRole("switch")).toBeNull();
  });
});
