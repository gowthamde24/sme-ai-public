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

  it("a card drawn again (the page came back) shows its state and never runs a second time", () => {
    const json = card("navigate", { page: "leads" });
    const a = draw(json);
    a.unmount();
    draw(json);
    expect(nav.push).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Opened Leads")).toBeTruthy();
  });
});
