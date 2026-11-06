import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const nav = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: nav.push, refresh: () => undefined }), usePathname: () => "/app", useSearchParams: () => new URLSearchParams() }));

import { appDict } from "@/i18n/app";
import { parseDay, parsePanel } from "@/lib/api/ai-team";
import { aiTeamDayFixture, aiTeamPanelFixture } from "@/lib/api/ai-team-fixtures";

import { AiTeamView } from "./AiTeamView";

const T = "11111111-1111-4111-8111-111111111111";
const B = `/app/tenants/${T}`;
const WORDS = Object.fromEntries(Object.entries(appDict("en") as Record<string, string>).filter(([k]) => k.startsWith("aiteam.")));
const DATE = "2026-11-06";
const day = parseDay(aiTeamDayFixture({ date: DATE }));
const onSwitch = vi.fn(async (_h: string, enabled: boolean) => ({ ok: true as const, enabled }));
const draw = (over: Partial<React.ComponentProps<typeof AiTeamView>> = {}) =>
  render(<AiTeamView tenantId={T} base={B} date={DATE} today={DATE} initialDay={day} words={WORDS} manages onSwitch={onSwitch} mfaHref={`${B}/settings?section=security`} {...over} />);

beforeEach(() => {
  nav.push.mockReset();
  onSwitch.mockClear();
  vi.stubGlobal("fetch", vi.fn(async (url: string) => (String(url).includes("/panel?") ? new Response(JSON.stringify({ panel: parsePanel(aiTeamPanelFixture({ helper: "caller", tenantId: T, date: DATE })) })) : new Response(JSON.stringify({ day: parseDay(aiTeamDayFixture({ date: DATE })) })))));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("My AI team v2 (job ai-team-v2)", () => {
  it("draws a lane per helper with its status and count, the marks as links to their items, and the ⚑ marks", () => {
    draw();
    const lanes = document.querySelectorAll("[data-lane]");
    expect([...lanes].map((l) => l.getAttribute("data-lane"))).toEqual(day.lanes.map((l) => l.helper));
    const caller = document.querySelector('[data-lane="caller"]') as HTMLElement;
    expect(within(caller).getByText(/on call · Ramesh K \(example\)/)).toBeInTheDocument();
    const owner = document.querySelectorAll('[data-lane] [data-owner]');
    expect(owner.length).toBe(day.needsOwnerTotal);
    const first = caller.querySelector("a[data-mark]") as HTMLAnchorElement;
    expect(first.getAttribute("href")).toMatch(new RegExp(`^${B}/leads/`));
    expect(first.getAttribute("aria-label")).toMatch(/^09:15 · Caller · Anjali Boutique \(example\) · interested · 3:04$/);
    expect(document.querySelector('[data-lane] [data-part="now"]')).not.toBeNull();
  });
  it("the flow strip's numbers filter the timeline, and Show all brings everything back", () => {
    draw();
    fireEvent.click(document.querySelector('[data-flow="orders"]')!);
    expect(document.querySelectorAll('[data-lane] [data-mark]').length).toBe(1);
    expect(screen.getByText(/Showing only: orders/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Show all" }));
    expect(document.querySelectorAll('[data-lane] [data-mark]').length).toBeGreaterThan(10);
  });
  it("the cost of the day is in the strip only when the API gives it (Owner and Admin)", () => {
    draw();
    expect(document.querySelector('[data-part="cost"]')).toHaveTextContent("cost today ₹184.50");
    cleanup();
    draw({ initialDay: { ...day, costToday: null } });
    expect(document.querySelector('[data-part="cost"]')).toBeNull();
  });
  it("the day picker goes to Yesterday and to a chosen day; a past day is not live", () => {
    draw();
    fireEvent.click(screen.getByRole("button", { name: "Yesterday" }));
    expect(nav.push).toHaveBeenCalledWith(`${B}/ai-team?date=2026-11-05`);
    cleanup();
    draw({ date: "2026-11-05", initialDay: parseDay(aiTeamDayFixture({ date: "2026-11-05", past: true })) });
    expect(document.querySelector('[data-part="live"]')).toBeNull();
    expect(document.querySelector('[data-lane] [data-part="now"]')).toBeNull();
    expect(screen.getByRole("heading", { name: "The shift of 05/11/2026" })).toBeInTheDocument();
  });
  it("reads today's day again every 20 seconds while the tab is in front", async () => {
    vi.useFakeTimers();
    draw();
    expect(fetch).not.toHaveBeenCalled();
    await act(async () => {
      vi.advanceTimersByTime(20_000);
    });
    expect(fetch).toHaveBeenCalledWith(`${B}/ai-team/day?date=${DATE}`, expect.objectContaining({ credentials: "same-origin" }));
  });
  it("the poll's answer replaces the day (a helper switched off elsewhere shows Paused)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ day: parseDay(aiTeamDayFixture({ date: DATE, paused: ["order_desk"] })) }))));
    vi.useFakeTimers();
    draw();
    await act(async () => {
      vi.advanceTimersByTime(20_000);
    });
    vi.useRealTimers();
    await waitFor(() => expect(within(document.querySelector('[data-lane="order_desk"]') as HTMLElement).getByText("Paused")).toBeInTheDocument());
    expect(screen.queryByText(/Couldn't refresh/)).toBeNull();
  });
  it("a lane's name opens its panel: numbers, last actions, the switch (Owner) and Train it", async () => {
    draw();
    fireEvent.click(document.querySelector('[data-lane] [data-lane-open="caller"]')!);
    const panel = await screen.findByRole("dialog", { name: "Caller" });
    await waitFor(() => expect(within(panel).getByText("connected")).toBeInTheDocument());
    expect(within(panel).getByText("71%")).toBeInTheDocument();
    expect(within(panel).getByRole("link", { name: "Train it" })).toHaveAttribute("href", `${B}/ai-team/training`);
    const sw = within(panel).getByRole("switch");
    expect(sw).toHaveAttribute("aria-checked", "true");
    await act(async () => {
      fireEvent.click(sw);
    });
    expect(onSwitch).toHaveBeenCalledWith("caller", false);
    await waitFor(() => expect(within(panel).getByRole("switch")).toHaveAttribute("aria-checked", "false"));
    expect(within(panel).getByText(/it does nothing on its own/)).toBeInTheDocument();
    fireEvent.keyDown(panel, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });
  it("the switch asks for the second factor when the API wants it; Sales sees no switch", async () => {
    draw({ onSwitch: vi.fn(async () => ({ ok: false as const, error: "mfa" as const })) });
    fireEvent.click(document.querySelector('[data-lane] [data-lane-open="caller"]')!);
    const panel = await screen.findByRole("dialog");
    const sw = await within(panel).findByRole("switch");
    await act(async () => {
      fireEvent.click(sw);
    });
    expect(await within(panel).findByRole("link", { name: "Turn it on" })).toHaveAttribute("href", `${B}/settings?section=security`);
    cleanup();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ panel: parsePanel(aiTeamPanelFixture({ helper: "caller", tenantId: T, date: DATE, role: "sales" })) }))));
    draw({ manages: false, onSwitch: null });
    fireEvent.click(document.querySelector('[data-lane] [data-lane-open="caller"]')!);
    const p2 = await screen.findByRole("dialog");
    await within(p2).findByText("Only the owner or an admin can switch it.");
    expect(within(p2).queryByRole("switch")).toBeNull();
  });
  it("the phone's day lists every mark in time order with the now line among them", () => {
    draw();
    const phone = document.querySelector('[data-part="phone-day"]') as HTMLElement;
    const rows = [...phone.querySelectorAll("ol > li")];
    const nowAt = rows.findIndex((r) => r.getAttribute("data-part") === "now");
    expect(nowAt).toBeGreaterThan(0);
    expect(rows[nowAt + 1]?.getAttribute("data-mark")).toBe("followup_due");
  });
});
