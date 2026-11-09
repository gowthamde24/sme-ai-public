import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { aiTeamDayFixture, standupFixture } from "@/lib/api/ai-team-fixtures";
import { parseDay, parseStandup } from "@/lib/api/ai-team";
import { NO_COUNTS } from "@/lib/nav-counts";

const h = vi.hoisted(() => ({ day: vi.fn(), standup: vi.fn(), counts: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (to: string) => { throw new Error(`redirect ${to}`); }, useRouter: () => ({ push: () => undefined }) }));
vi.mock("../menu-title", () => ({ menuTitle: async () => "AI team" }));
vi.mock("./actions", () => ({ remakeStandupAction: async () => ({ ok: false, error: "failed" }), switchHelperAction: async () => ({ ok: true, enabled: true }) }));
vi.mock("@/lib/api/nav-counts", async (orig) => ({ ...(await orig<typeof import("@/lib/api/nav-counts")>()), getNavCounts: (...a: unknown[]) => h.counts(...a) }));
vi.mock("./ai-team-data", async (orig) => ({ ...(await orig<typeof import("./ai-team-data")>()), readDay: (...a: unknown[]) => h.day(...a), readStandup: (...a: unknown[]) => h.standup(...a) }));

import { AiTeamV2Page } from "./v2-page";

const T = "22222222-2222-4222-8222-222222222222";
const ctx = (role = "owner") => ({ token: "tok", tenantId: T, mode: "on" as const, role, lang: "en" });
const TODAY = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
const page = async (o: { role?: string; tab?: string; date?: string } = {}) => render(await AiTeamV2Page({ ctx: ctx(o.role), lang: "en", wantedDate: o.date, wantedTab: o.tab }));

beforeEach(() => {
  vi.stubEnv("APP_V4", "1");
  h.day.mockReset().mockImplementation(async (_c: unknown, date: string) => parseDay(aiTeamDayFixture({ date })));
  h.standup.mockReset().mockImplementation(async (_c: unknown, date: string) => parseStandup(standupFixture({ date, language: "en" })));
  h.counts.mockReset().mockResolvedValue({ ...NO_COUNTS, quotesWaiting: 2, visitsToday: 1 });
});
afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

describe("AI team with app v4", () => {
  it("the Owner opens on the report: the scene with who is reporting, tomorrow's to do from the real counts, and the earlier reports", async () => {
    await page();
    expect(screen.getByRole("heading", { level: 1, name: "AI team" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Today's report" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByText("Caller is reporting")).toBeInTheDocument();
    const todo = document.querySelector("[data-part=todo]") as HTMLElement;
    expect(within(todo).getByText("Approve 2 quotes")).toBeInTheDocument();
    expect(within(todo).getByText("1 store visit today")).toBeInTheDocument();
    const earlier = document.querySelector("[data-part=earlier]") as HTMLElement;
    expect(within(earlier).getAllByRole("link")).toHaveLength(6);
    expect(h.counts).toHaveBeenCalledWith("tok", T);
  });
  it("an earlier day with no stand-up is not listed, and counts that cannot be read leave 'Nothing waits for you'", async () => {
    h.standup.mockImplementation(async (_c: unknown, date: string) => (date === TODAY ? parseStandup(standupFixture({ date, language: "en" })) : null));
    h.counts.mockRejectedValue(new Error("down"));
    await page();
    expect(within(document.querySelector("[data-part=earlier]") as HTMLElement).queryAllByRole("link")).toHaveLength(0);
    expect(screen.getByText("No earlier reports yet.")).toBeInTheDocument();
    expect(screen.getByText("Nothing waits for you.")).toBeInTheDocument();
  });
  it("the shift tab is the live shift as it was, with no stand-up and no counts asked", async () => {
    await page({ tab: "shift" });
    expect(screen.getByRole("link", { name: "Today's shift" })).toHaveAttribute("aria-current", "page");
    await waitFor(() => expect(document.querySelector("[data-part=flow]")).not.toBeNull()); // (the shift is a chunk of its own: it draws when the chunk arrives)
    expect(document.querySelector("[data-standup-scene]")).toBeNull();
    expect(h.counts).not.toHaveBeenCalled();
    expect(h.standup).not.toHaveBeenCalled();
  });
  it("the helpers tab has a card for each helper of the day", async () => {
    await page({ tab: "helpers" });
    expect(await screen.findByRole("button", { name: "Open Caller" })).toBeInTheDocument(); // (the tab is a chunk of its own: it draws when the chunk arrives)
    const cards = document.querySelectorAll("[data-helper]");
    expect(cards.length).toBe(parseDay(aiTeamDayFixture({ date: TODAY })).lanes.length);
  });
  it("a person who is not the Owner or an Admin has no report: two tabs, and the shift first; the stand-up is never read for them", async () => {
    await page({ role: "sales", tab: "report" });
    expect(screen.queryByRole("link", { name: /report/i })).toBeNull();
    expect(screen.getByRole("link", { name: "Today's shift" })).toHaveAttribute("aria-current", "page");
    expect(h.standup).not.toHaveBeenCalled();
  });
  it("an unknown tab is the first one; without app v4 the page is the old one (no tabs)", async () => {
    await page({ tab: "<script>" });
    expect(screen.getByRole("link", { name: "Today's report" })).toHaveAttribute("aria-current", "page");
    cleanup();
    vi.stubEnv("APP_V4", "");
    await page();
    expect(screen.queryByRole("navigation", { name: "AI team views" })).toBeNull();
  });
});
