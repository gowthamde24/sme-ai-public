import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { appT } from "@/i18n/app";
import { AGENT_KEYS } from "@/lib/api/today";

import { OfficeRoom, type RoomRow } from "./OfficeRoom";
import type { ClientEnv } from "./view";

const h = vi.hoisted(() => ({ env: {} as Record<string, unknown>, owls: [] as Record<string, unknown>[] }));
vi.mock("./view", async (orig) => ({ ...(await orig<typeof import("./view")>()), readClientEnv: () => h.env }));
// jsdom has no layout, no IntersectionObserver and no canvas: the owl is replaced by a stand-in that shows what the room gave it
vi.mock("../owl/PlushOwl", () => ({
  PlushOwl: (props: { agent?: string; mood: string; still?: boolean; working?: boolean; follow?: boolean; sizes?: string }) => {
    h.owls.push(props);
    return <div data-testid="owl" data-agent={props.agent} data-mood={props.mood} data-still={String(Boolean(props.still))} data-working={String(Boolean(props.working))} data-follow={String(props.follow)} />;
  },
}));

const en = appT("en");
const W = (k: string) => en(k as "frame.notyet");
const KEYS = ["office.title", "office.sub", "office.idle", "office.working", "office.switchedoff", "frame.notyet", "office.latest", "office.noevents", "office.pick", "office.runs", "office.viewroom", "office.viewlist", "office.listintro", "office.viewswitch", "office.hint", "office.still", "office.feed", ...AGENT_KEYS.map((a) => `agent.${a}`)];
const WORDS = Object.fromEntries(KEYS.map((k) => [k, W(k)]));
const NOW = Date.UTC(2026, 9, 9, 12, 0, 0);
const at = (minutesAgo: number) => new Date(NOW - minutesAgo * 60_000).toISOString();
const rows = (patch: Partial<Record<(typeof AGENT_KEYS)[number], Partial<RoomRow>>> = {}): RoomRow[] =>
  AGENT_KEYS.map((agent) => ({ agent, state: "idle" as const, job: `Job of ${agent}.`, event: null, ...patch[agent] }));
const CAPABLE: ClientEnv = { reducedMotion: false, lite: false, remembered: null };
const LITE: ClientEnv = { reducedMotion: true, lite: true, remembered: null };
const room = (r: RoomRow[] = rows(), selected: RoomRow["agent"] | null = null) => render(<OfficeRoom rows={r} selected={selected} base="/app/tenants/T" words={WORDS} />);
const switchBtn = (name: string) => screen.getByRole("button", { name });
const seat = (id: string) => document.querySelector<HTMLElement>(`.office-seat[data-agent="${id}"]`)!;
const owlOf = (id: string) => within(seat(id)).getByTestId("owl");
const tag = (id: string, text: string) => within(seat(id)).getByRole("button", { name: text });

beforeEach(() => {
  h.env = { ...CAPABLE };
  h.owls = [];
  window.localStorage.clear();
  window.history.replaceState(null, "", "/app/tenants/T/office");
});
afterEach(cleanup);

describe("OfficeRoom: which view first", () => {
  it("the plush room is the first view on every device, and the switch says so", () => {
    room();
    expect(document.querySelector('[data-office="plush"]')).not.toBeNull();
    expect(switchBtn("Office view")).toHaveAttribute("aria-pressed", "true");
    expect(switchBtn("List view")).toHaveAttribute("aria-pressed", "false");
    expect(screen.queryByRole("region", { name: "Agent office" })).toBeNull();
  });
  it("the server's first paint (no browser facts yet) is the room too, so the page and the hydrated page agree", () => {
    h.env = null as unknown as Record<string, unknown>;
    expect(() => room()).not.toThrow();
  });
  it("seven owls sit at the table, Agent OWL first and the six in the API's order, each with its own agent's pictures, none following the pointer", () => {
    room();
    expect(h.owls.map((o) => o.agent)).toEqual([...AGENT_KEYS]);
    expect(h.owls.every((o) => o.follow === false)).toBe(true);
    expect(document.querySelectorAll(".office-seat")).toHaveLength(7);
    expect(document.querySelector(".office-table")).not.toBeNull();
  });
  it("the person can leave the room for the List (and it is remembered), and come back", () => {
    room();
    fireEvent.click(switchBtn("List view"));
    expect(document.querySelector('[data-office="plush"]')).toBeNull();
    expect(screen.getByRole("region", { name: "Agent office" })).toBeInTheDocument();
    expect(window.localStorage.getItem("sme_office_view")).toBe("list");
    fireEvent.click(switchBtn("Office view"));
    expect(document.querySelector('[data-office="plush"]')).not.toBeNull();
    expect(window.localStorage.getItem("sme_office_view")).toBe("room");
  });
  it("what the person chose last time wins; the old view's name (3d) is forgotten, not an error", () => {
    h.env = { ...CAPABLE, remembered: "list" };
    room();
    expect(screen.getByRole("region", { name: "Agent office" })).toBeInTheDocument();
    cleanup();
    h.env = { ...CAPABLE, remembered: null };
    window.localStorage.setItem("sme_office_view", "3d");
    room();
    expect(document.querySelector('[data-office="plush"]')).not.toBeNull();
  });
  it("with reduced motion every owl is a still picture and the room says so", () => {
    h.env = { ...LITE };
    room();
    expect(h.owls.every((o) => o.still === true && o.working === false)).toBe(true);
    expect(screen.getByText("Your device asks for less motion, so the owls are still pictures.")).toBeInTheDocument();
    cleanup();
    h.env = { ...CAPABLE };
    room();
    expect(screen.queryByText(/asks for less motion/)).toBeNull();
  });
});

describe("OfficeRoom: the pose of each owl follows the API's state", () => {
  const mixed = rows({
    main: { state: "not_available" },
    lead_finder: { state: "not_available" },
    researcher: { state: "switched_off" },
    quote_writer: { state: "working", event: { text: "Prepared quote 3", ago: "3h", at: at(180) } },
  });
  it("working types at a glowing laptop, idle breathes and blinks, switched off and not built are still and faded", () => {
    room(mixed);
    const qw = owlOf("quote_writer");
    expect(qw).toHaveAttribute("data-working", "true");
    expect(qw).toHaveAttribute("data-still", "false");
    expect(seat("quote_writer").querySelector("[data-office-laptop]")).not.toBeNull();
    expect(owlOf("order_desk")).toHaveAttribute("data-working", "false");
    expect(owlOf("order_desk")).toHaveAttribute("data-still", "false");
    expect(seat("order_desk").querySelector("[data-office-laptop]")).toBeNull();
    for (const id of ["main", "lead_finder", "researcher"]) {
      expect(owlOf(id)).toHaveAttribute("data-still", "true");
      expect(owlOf(id)).toHaveAttribute("data-working", "false");
      expect(seat(id).querySelector(".office-owl")!.className).toContain("opacity-45");
      expect(seat(id).querySelector("[data-office-laptop]")).toBeNull();
    }
    expect(seat("order_desk").querySelector(".office-owl")!.className).not.toContain("opacity-45");
  });
  it("with reduced motion a working helper is a still picture with its laptop lit", () => {
    h.env = { ...LITE };
    room(mixed);
    expect(owlOf("quote_writer")).toHaveAttribute("data-still", "true");
    expect(owlOf("quote_writer")).toHaveAttribute("data-working", "false");
    expect(seat("quote_writer").querySelector("[data-office-laptop]")).not.toBeNull();
  });
  it("each tag carries the helper's name and state (Working, Idle, Switched off, Not available yet)", () => {
    room(mixed);
    expect(tag("main", "Agent OWL Not available yet")).toHaveAttribute("aria-pressed", "false");
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
    const items = within(screen.getByRole("region", { name: "Agent office" })).getAllByRole("listitem");
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
    expect(screen.getByText(/Tap a teammate in the room/)).toBeInTheDocument();
    fireEvent.click(tag("quote_writer", "Quote Writer Working"));
    const panel = screen.getByRole("heading", { level: 2, name: "Quote Writer" }).closest("section")!;
    expect(panel).toHaveTextContent("Working");
    expect(panel).toHaveTextContent("Job of quote_writer.");
    expect(panel).toHaveTextContent("Prepared quote 3 · 3h");
    expect(window.location.search).toBe("?agent=quote_writer");
    fireEvent.click(tag("quote_writer", "Quote Writer Working"));
    expect(screen.getByText(/Tap a teammate in the room/)).toBeInTheDocument();
    expect(window.location.search).toBe("");
    // tapping the owl itself chooses it too
    fireEvent.click(seat("researcher").querySelector(".office-owl")!);
    expect(screen.getByRole("heading", { level: 2, name: "Researcher" })).toBeInTheDocument();
    expect(tag("researcher", "Researcher Switched off")).toHaveAttribute("aria-pressed", "true");
  });
  it("a card of the List chooses a helper without leaving the page, but stays a real link (a new tab or a modified click goes to ?agent=)", () => {
    h.env = { ...CAPABLE, remembered: "list" };
    room(mixed);
    const link = screen.getByRole("link", { name: /Quote Writer/ });
    expect(link).toHaveAttribute("href", "/app/tenants/T/office?agent=quote_writer");
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
    expect(screen.getByRole("region", { name: "Agent office" })).toBeInTheDocument();
    spy.mockRestore();
  });
});
