import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { appDict } from "@/i18n/app";
import { fixtureTransport } from "@/lib/assistant-work/client";
import { parseWorkCard } from "@/lib/assistant-work/types";

import { makeT } from "../../../words";
import { WorkCards } from "./WorkCards";
import type { WorkEnv } from "./work-env";
import { createWorkStore } from "./work-store";

const nav = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn(), back: vi.fn(), pathname: "/app/tenants/T" }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: nav.push, refresh: nav.refresh, back: nav.back }), usePathname: () => nav.pathname }));
const talking = vi.hoisted(() => ({ set: vi.fn() }));
vi.mock("../../v6/v6-state", () => ({ setTalking: (on: boolean) => talking.set(on) }));

const WORDS = Object.fromEntries(Object.entries(appDict("en") as Record<string, string>).filter(([k]) => k.startsWith("bv.")));
const BASE = "/app/tenants/T";
let n = 0;
const card = (action: string, args: Record<string, unknown>) => ({ kind: "client_action", id: `b6000000-0000-4000-8000-${String(++n).padStart(12, "0")}`, action, args });
const draw = (json: unknown) => {
  const parsed = parseWorkCard(json, BASE);
  if (!parsed) throw new Error("does not parse");
  const env: WorkEnv = { t: makeT(WORDS), role: "owner", transport: fixtureTransport({ delay: 0 }), store: createWorkStore(), onChange: () => undefined, base: BASE };
  return render(<WorkCards cards={[parsed]} env={env} />);
};

beforeEach(() => {
  nav.push.mockReset();
  nav.refresh.mockReset();
  nav.back.mockReset();
  talking.set.mockReset();
  nav.pathname = "/app/tenants/T";
  document.cookie = "sme_theme=; Max-Age=0; Path=/";
  document.documentElement.setAttribute("data-theme", "light");
  window.matchMedia = vi.fn().mockImplementation((q: string) => ({ matches: false, media: q, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
});
afterEach(cleanup);

describe("the assistant does it in the browser: Done · Undo", () => {
  it("an unknown action is no card at all", () => {
    expect(parseWorkCard(card("open_url", { url: "https://evil.example" }), BASE)).toBeNull();
  });

  it("theme: switches at once, says so, and Undo goes back to what it was", () => {
    draw(card("theme", { mode: "dark" }));
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(document.cookie).toContain("sme_theme=dark");
    expect(screen.getByText("Switched to the dark theme")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    expect(screen.getByText("Undone")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
  });

  it("language: the cookie, a refresh, and Undo puts the old one back", () => {
    draw(card("language", { lang: "te" }));
    expect(document.cookie).toContain("sme_lang=te");
    expect(nav.refresh).toHaveBeenCalledTimes(1);
    expect(screen.getByText("App language: తెలుగు")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(nav.refresh).toHaveBeenCalledTimes(2);
  });

  it("navigate: opens the page (Reports with its period) and offers Back, not Undo", () => {
    draw(card("navigate", { page: "reports", period: "month" }));
    expect(nav.push).toHaveBeenCalledWith(`${BASE}/report?range=month`);
    expect(screen.getByText("Opened Reports · this month")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(nav.back).toHaveBeenCalledTimes(1);
  });

  it("filter: Calls with the closed status and range, said in words", () => {
    draw(card("filter", { page: "calls", status: "no_answer", when: "7d", q: "Ravi" }));
    expect(nav.push).toHaveBeenCalledWith(`${BASE}/calls?status=no_answer&when=7d&q=Ravi`);
    expect(screen.getByText("Calls: missed · last 7 days · “Ravi”")).toBeTruthy();
  });

  it("Talk live: start on Today opens the bar, Undo closes it; away from Today it goes to Today first", async () => {
    vi.useFakeTimers();
    const first = draw(card("talk_live", { state: "start" }));
    expect(talking.set).toHaveBeenCalledWith(true);
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(talking.set).toHaveBeenLastCalledWith(false);
    first.unmount();
    nav.pathname = "/app/tenants/T/calls";
    talking.set.mockReset();
    draw(card("talk_live", { state: "start" }));
    expect(nav.push).toHaveBeenCalledWith(BASE);
    await act(async () => void vi.advanceTimersByTime(600));
    expect(talking.set).toHaveBeenCalledWith(true);
    vi.useRealTimers();
  });

  it("a card read back from history is shown as done and never runs (no navigation, no theme change)", () => {
    const json = card("navigate", { page: "reports", period: "month" });
    const parsed = parseWorkCard(json, BASE);
    if (!parsed || parsed.kind !== "client_action") throw new Error("does not parse");
    const env: WorkEnv = { t: makeT(WORDS), role: "owner", transport: fixtureTransport({ delay: 0 }), store: createWorkStore(), onChange: () => undefined, base: BASE };
    render(<WorkCards cards={[{ ...parsed, replayed: true }]} env={env} />);
    expect(nav.push).not.toHaveBeenCalled();
    expect(screen.getByText("Opened Reports · this month")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("a card drawn again (the page came back) shows its state and never runs a second time", () => {
    const json = card("navigate", { page: "leads" });
    const a = draw(json);
    a.unmount();
    draw(json);
    expect(nav.push).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Opened Leads")).toBeTruthy();
  });

  it("opening the sources page (Connect my IndiaMART) says where it goes and goes there with the card named; filtering Leads says what it filters", () => {
    draw(card("navigate", { page: "lead_sources", card: "indiamart" }));
    expect(screen.getByText("Opened where your enquiries come from")).toBeTruthy();
    expect(nav.push).toHaveBeenCalledWith(`${BASE}/lead-sources?card=indiamart`);
    cleanup();
    nav.push.mockReset();
    draw(card("filter", { page: "leads", status: "new", q: "Reddy" }));
    expect(screen.getByText(/new · “Reddy”/)).toBeTruthy();
    expect(nav.push).toHaveBeenCalledWith(`${BASE}/lead-desk?chip=new&q=Reddy`);
  });
});

describe("the one line the assistant leaves on the page it opens", () => {
  beforeEach(async () => {
    const { takeNote } = await import("@/lib/client-actions/note");
    takeNote("leads");
  });

  it("a Leads filter with a note: the note is kept for the Leads page BEFORE it opens, and the page takes it once", async () => {
    const { takeNote, stashNote } = await import("@/lib/client-actions/note");
    // the note is already kept when the page is asked to open: read it without losing it
    const takeNoteBefore = () => {
      const t = takeNote("leads");
      if (t !== null) stashNote("leads", t);
      return t;
    };
    nav.push.mockImplementation(() => expect(takeNoteBefore()).toContain("date part"));
    draw({ ...card("filter", { page: "leads", chip: "new", q: "" }), note: "Showing these leads; the date part is not available yet, so it shows all of them." });
    expect(nav.push).toHaveBeenCalledTimes(1);
    expect(takeNote("leads")).toBe("Showing these leads; the date part is not available yet, so it shows all of them.");
    expect(takeNote("leads")).toBeNull();
  });

  it("no note, or a note on any other action, keeps nothing", async () => {
    const { takeNote } = await import("@/lib/client-actions/note");
    draw(card("filter", { page: "leads", chip: "new", q: "" }));
    draw({ ...card("navigate", { page: "reports" }), note: "should not be kept" });
    expect(takeNote("leads")).toBeNull();
  });

  it("a note that is not text is dropped, and a long one is cut", () => {
    expect(parseWorkCard({ ...card("filter", { page: "leads", chip: "new", q: "" }), note: 5 }, BASE)).not.toHaveProperty("note");
    const long = parseWorkCard({ ...card("filter", { page: "leads", chip: "new", q: "" }), note: "x".repeat(500) }, BASE);
    expect((long as { note: string }).note).toHaveLength(200);
  });
});

describe("catalogue pages the assistant opens after the rename (Products and Price lists)", () => {
  it("open my catalogue / show my sarees go to the catalogue (the Products tab); add a product opens the add form", () => {
    draw(card("navigate", { page: "catalogue" }));
    expect(nav.push).toHaveBeenLastCalledWith("/app/tenants/T/catalogue");
    expect(screen.getByText("Opened Catalogue")).toBeTruthy();
    cleanup();
    draw(card("navigate", { page: "catalogue_new" }));
    expect(nav.push).toHaveBeenLastCalledWith("/app/tenants/T/catalogue/new");
    expect(screen.getByText("Opened Add a product")).toBeTruthy();
  });
});
