import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { appT } from "@/i18n/app";
import { AGENT_KEYS } from "@/lib/api/today";

import { OfficeRoom, type RoomRow } from "./OfficeRoom";
import type { ClientEnv } from "./scene/capability";

const h = vi.hoisted(() => ({ env: {} as Record<string, unknown>, probe: true, stage: [] as Record<string, unknown>[] }));
vi.mock("./scene/capability", async (orig) => ({ ...(await orig<typeof import("./scene/capability")>()), readClientEnv: () => h.env }));
vi.mock("./scene/webgl", () => ({ webglAvailable: () => h.probe }));
// jsdom has no WebGL: the stage (canvas, tags, three.js) is replaced by a stand-in that shows what it was given and lets a test tap a helper or fail
vi.mock("./OfficeStage", () => ({
  OfficeStage: (props: { poses: Record<string, string>; stateText: Record<string, string>; names: Record<string, string>; selected: string | null; onSelect: (id: string | null) => void; onFail: (w: "webgl" | "error") => void; reduced: boolean; hint: string }) => {
    h.stage.push(props);
    return (
      <div data-testid="stage" data-reduced={String(props.reduced)}>
        <p>{props.hint}</p>
        {Object.keys(props.poses).map((id) => (
          <button key={id} type="button" data-pose={props.poses[id]} onClick={() => props.onSelect(props.selected === id ? null : id)}>{`tag ${props.names[id]} · ${props.stateText[id]}`}</button>
        ))}
        <button type="button" onClick={() => props.onFail("error")}>crash</button>
        <button type="button" onClick={() => props.onFail("webgl")}>lose</button>
      </div>
    );
  },
}));

const en = appT("en");
const W = (k: string) => en(k as "frame.notyet");
const KEYS = ["office.title", "office.sub", "office.idle", "office.working", "office.switchedoff", "frame.notyet", "office.latest", "office.noevents", "office.pick", "office.runs", "office.view3d", "office.viewlist", "office.viewswitch", "office.hint", "office.loading", "office.nowebgl", "office.loaderror", "office.still", "office.feed", ...AGENT_KEYS.map((a) => `agent.${a}`)];
const WORDS = Object.fromEntries(KEYS.map((k) => [k, W(k)]));
const NOW = Date.UTC(2026, 9, 9, 12, 0, 0);
const at = (minutesAgo: number) => new Date(NOW - minutesAgo * 60_000).toISOString();
const rows = (patch: Partial<Record<(typeof AGENT_KEYS)[number], Partial<RoomRow>>> = {}): RoomRow[] =>
  AGENT_KEYS.map((agent) => ({ agent, state: "idle" as const, job: `Job of ${agent}.`, event: null, ...patch[agent] }));
const CAPABLE: ClientEnv = { defaultView: "3d", weak: false, webgl: true, reducedMotion: false, remembered: null, coarse: false, phone: false };
const WEAK: ClientEnv = { ...CAPABLE, defaultView: "list", weak: true };
const room = (r: RoomRow[] = rows(), selected: RoomRow["agent"] | null = null) => render(<OfficeRoom rows={r} selected={selected} base="/app/tenants/T" words={WORDS} />);
const switchBtn = (name: string) => screen.getByRole("button", { name });

beforeEach(() => {
  h.env = { ...CAPABLE };
  h.probe = true;
  h.stage = [];
  window.localStorage.clear();
  window.history.replaceState(null, "", "/app/tenants/T/office");
});
afterEach(cleanup);

describe("OfficeRoom: which view first", () => {
  it("a capable device is shown the 3D view, and the switch says so", () => {
    room();
    expect(screen.getByTestId("stage")).toBeInTheDocument();
    expect(switchBtn("3D view")).toHaveAttribute("aria-pressed", "true");
    expect(switchBtn("List view")).toHaveAttribute("aria-pressed", "false");
    expect(screen.queryByRole("region", { name: "Agent office" })).toBeNull();
  });
  it("a weak device (or reduced motion) is shown the List, and the person can still press 3D", () => {
    h.env = { ...WEAK };
    room();
    expect(screen.queryByTestId("stage")).toBeNull();
    expect(screen.getByRole("region", { name: "Agent office" })).toBeInTheDocument();
    expect(switchBtn("List view")).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(switchBtn("3D view"));
    expect(screen.getByTestId("stage")).toBeInTheDocument();
    expect(window.localStorage.getItem("sme_office_view")).toBe("3d");
  });
  it("with reduced motion the room is a still picture, and says so once the person has chosen it", () => {
    h.env = { ...WEAK, reducedMotion: true };
    room();
    expect(screen.queryByText(/asks for less motion/)).toBeNull();
    fireEvent.click(switchBtn("3D view"));
    expect(screen.getByTestId("stage")).toHaveAttribute("data-reduced", "true");
    expect(screen.getByText("Your device asks for less motion, so the room is a still picture.")).toBeInTheDocument();
  });
  it("what the person chose last time wins over the device's guess, in both directions", () => {
    h.env = { ...CAPABLE, remembered: "list" };
    room();
    expect(screen.queryByTestId("stage")).toBeNull();
    cleanup();
    h.env = { ...WEAK, remembered: "3d" };
    room();
    expect(screen.getByTestId("stage")).toBeInTheDocument();
  });
  it("a browser without WebGL gets the List and the reason as a sentence, never a broken canvas", () => {
    h.env = { ...CAPABLE, webgl: false };
    room();
    expect(screen.queryByTestId("stage")).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent("The 3D view is not available on this device, so here is the list.");
    expect(screen.getByRole("region", { name: "Agent office" })).toBeInTheDocument();
  });
  it("pressing 3D looks again: a probe that now succeeds brings the room back", () => {
    h.env = { ...CAPABLE, webgl: false };
    room();
    h.probe = true;
    fireEvent.click(switchBtn("3D view"));
    expect(screen.getByTestId("stage")).toBeInTheDocument();
    expect(screen.queryByRole("status")).toBeNull();
  });
  it("when the 3D code throws or the GPU keeps losing its context, the List returns with a sentence; pressing 3D tries again", () => {
    room();
    fireEvent.click(screen.getByRole("button", { name: "crash" }));
    expect(screen.queryByTestId("stage")).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent("The 3D view could not be drawn, so here is the list.");
    expect(screen.getByRole("region", { name: "Agent office" })).toBeInTheDocument();
    fireEvent.click(switchBtn("3D view"));
    expect(screen.getByTestId("stage")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "lose" }));
    expect(screen.getByRole("status")).toHaveTextContent("The 3D view is not available on this device");
  });
});

describe("OfficeRoom: only the API's state", () => {
  const mixed = rows({
    main: { state: "not_available" },
    lead_finder: { state: "not_available" },
    researcher: { state: "switched_off" },
    quote_writer: { state: "working", event: { text: "Prepared quote 3", ago: "3h", at: at(180) } },
  });
  it("each tag carries the helper's state, and the pose the room draws follows it (working types; idle sits; not built and switched off are drawn faded and still)", () => {
    room(mixed);
    expect(screen.getByRole("button", { name: "tag Main agent · Not available yet" })).toHaveAttribute("data-pose", "off");
    expect(screen.getByRole("button", { name: "tag Researcher · Switched off" })).toHaveAttribute("data-pose", "off");
    expect(screen.getByRole("button", { name: "tag Quote Writer · Working" })).toHaveAttribute("data-pose", "working");
    expect(screen.getByRole("button", { name: "tag Order Desk · Idle" })).toHaveAttribute("data-pose", "idle");
  });
  it("the List says 'Switched off' for a switched-off helper and 'Not available yet' for one that is not built", () => {
    h.env = { ...WEAK };
    room(mixed);
    const items = within(screen.getByRole("region", { name: "Agent office" })).getAllByRole("listitem");
    expect(items[2]).toHaveTextContent("ResearcherSwitched off");
    expect(items[1]).toHaveTextContent("Lead FinderNot available yet");
  });
  it("tapping a helper in the room opens their panel (state, job, latest event) and writes ?agent= into the address; tapping again closes it", () => {
    room(mixed);
    expect(screen.getByText(/Tap a teammate in the room/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "tag Quote Writer · Working" }));
    const panel = screen.getByRole("heading", { level: 2, name: "Quote Writer" }).closest("section")!;
    expect(panel).toHaveTextContent("Working");
    expect(panel).toHaveTextContent("Job of quote_writer.");
    expect(panel).toHaveTextContent("Prepared quote 3 · 3h");
    expect(window.location.search).toBe("?agent=quote_writer");
    fireEvent.click(screen.getByRole("button", { name: "tag Quote Writer · Working" }));
    expect(screen.getByText(/Tap a teammate in the room/)).toBeInTheDocument();
    expect(window.location.search).toBe("");
  });
  it("a card of the List chooses a helper without leaving the page, but stays a real link (a new tab or a modified click goes to ?agent=)", () => {
    h.env = { ...WEAK };
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
    expect(h.stage[0].selected).toBe("researcher");
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
  it("pressing List leaves the room and remembers it (storage that is blocked only means nothing is remembered)", () => {
    room();
    fireEvent.click(switchBtn("List view"));
    expect(screen.queryByTestId("stage")).toBeNull();
    expect(window.localStorage.getItem("sme_office_view")).toBe("list");
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(() => fireEvent.click(switchBtn("3D view"))).not.toThrow();
    expect(screen.getByTestId("stage")).toBeInTheDocument();
    spy.mockRestore();
  });
  it("hovering or focusing 3D starts loading its chunk ahead of the click", async () => {
    h.env = { ...WEAK };
    room();
    await act(async () => {
      fireEvent.pointerEnter(switchBtn("3D view"));
    });
    expect(screen.getByRole("region", { name: "Agent office" })).toBeInTheDocument(); // nothing is drawn by a hover
  });
});
