import { act, cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => undefined, push: () => undefined }), usePathname: () => "/", useSearchParams: () => new URLSearchParams() }));
vi.mock("./ask/LazyAskCard", async () => ({ AskCard: (await import("./ask/AskCard")).AskCard }));
vi.mock("../live/live-calls-store", () => ({ useLiveCalls: () => ({ calls: [], at: 0, status: "ok" }) }));
// the band, "Your day", "Your assistant is working on" and the day-one checklist are lazy chunks (next/dynamic): a test draws them at once
vi.mock("./v6/LazyTodayBand", async () => {
  const m = await import("./v6/TodayBand");
  return { LazyTodayBand: m.TodayBand, LazyTodayBandAfter: m.TodayBandAfter };
});
vi.mock("./v6/LazyYourDay", async () => ({ LazyYourDay: (await import("./v6/YourDay")).default }));
vi.mock("./v6/LazyWorkingOn", async () => ({ LazyWorkingOn: (await import("./v6/WorkingOn")).default }));
vi.mock("./v6/day-one/LazyDayOne", async () => ({ LazyDayOne: (await import("./v6/day-one/DayOne")).default }));

import { appDict } from "@/i18n/app";

import { TodayView } from "./TodayView";
import { NOW, call, classic, fakeActions, outbox, t } from "./today-test-kit";
import { stepViews } from "./v6/day-one/steps";
import type { V6In } from "./v6/types";
import { NOTHING_TODAY, type TodayData } from "./types";

const WORDS = Object.fromEntries(Object.entries(appDict("en") as Record<string, string>).filter(([k]) => k.startsWith("tv6.") || k.startsWith("dst.")));
const BASE = "/app/tenants/22222222-2222-2222-2222-222222222222";
const base: V6In = { words: WORDS, language: "English", businessLang: "te", shop: "Sri Lakshmi Silks", working: null, results: { stages: [], costs: [] }, dayCalls: null, liveCalls: [], mockLive: null, dayOne: null, chip: null };
const data = (over: Partial<TodayData> = {}): TodayData => ({ ...NOTHING_TODAY, cards: { waiting: 3, money_held_paise: 0, orders_open: 0 }, needs: [outbox(), call(), classic()], team: [{ agent: "main", state: "idle", job: "Answers.", last_event: null }], digest: null, ...over });
const view = async (v6: V6In | null, over: Partial<React.ComponentProps<typeof TodayView>> = {}) => {
  let out!: ReturnType<typeof render>;
  await act(async () => {
    out = render(<TodayView v6={v6} data={data()} name="Asha" hour={9} now={NOW} base={BASE} t={t} role="owner" actions={fakeActions()} newLeads={4} {...over} />);
  });
  return out;
};

beforeEach(() => {
  window.matchMedia = vi.fn().mockImplementation((q: string) => ({ matches: q.includes("min-width"), media: q, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
});
afterEach(cleanup);

describe("Today, the final design (DESIGN_V6)", () => {
  it("is the dark band first, then 'Your day' full width, then the two columns; the page's H1 stays 'Today'; the screen is marked for the 1560px column", async () => {
    await view(base);
    expect(screen.getByRole("heading", { level: 1, name: "Today" })).toBeInTheDocument();
    expect(document.querySelector('[data-screen="today"]')).toHaveAttribute("data-v6");
    const band = document.querySelector('[data-part="band"]') as HTMLElement;
    const day = document.querySelector('[data-part="your-day"]') as HTMLElement;
    const lower = document.querySelector('[data-part="v6-lower"]') as HTMLElement;
    expect(band).toHaveClass("ds-hero");
    expect(band.compareDocumentPosition(day) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(day.compareDocumentPosition(lower) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(band.querySelector('[data-part="greeting"]')).toHaveTextContent("Good morning, Asha");
    expect(band.querySelector('[data-part="eyebrow"]')).toHaveTextContent("Sri Lakshmi Silks");
  });

  it("the briefing is Today's own data: new enquiries, visits booked, and the quote at the top as a link", async () => {
    const store: TodayData["store"] = { state: "ready", slots: "unknown", nextFree: null, visits: [{ id: "v", starts_at: "2026-10-11T05:30:00Z", who: "Anitha", extra: 0, topic: "Bridal silks", status: "confirmed", here: false }] };
    await view(base, { data: data({ store }) });
    const brief = document.querySelector('[data-part="briefing"]') as HTMLElement;
    expect(brief).toHaveTextContent("Today: 4 new enquiries and 1 visit booked. One quote of ₹14,175 for SYNTHETIC Textiles is waiting for you.");
    expect(within(brief).getByRole("link", { name: "₹14,175 for SYNTHETIC Textiles" })).toHaveAttribute("href", "/app/tenants/T/enquiries/E");
  });

  it("leaves out a piece of the briefing that cannot be read (the store is not known: no visits)", async () => {
    await view(base);
    expect(document.querySelector('[data-part="briefing"]')?.textContent).not.toMatch(/visit/);
  });

  it("'Your day': the summary line from the page's calls, the visits as pins, the call-backs of the approved job", async () => {
    const store: TodayData["store"] = { state: "ready", slots: "unknown", nextFree: null, visits: [{ id: "v", starts_at: "2026-10-11T05:30:00Z", who: "Anitha", extra: 0, topic: null, status: "confirmed", here: false }] };
    const working = { id: "t", title: "Call back 9", status: "running" as const, approvedAt: null, total: 9, done: 5, positive: 2, waiting: 4, toMinute: 1200 };
    await view({ ...base, working, dayCalls: ["2026-10-11T03:35:00Z", "2026-10-11T03:50:00Z"] }, { data: data({ store }) });
    const day = document.querySelector('[data-part="your-day"]') as HTMLElement;
    expect(day.querySelector('[data-part="day-summary"]')).toHaveTextContent("2 calls handled · 3 sent to you · next: 4 call-backs at 11:00");
    expect(day.querySelectorAll('[data-dot="call"]')).toHaveLength(2);
    expect(day.querySelectorAll('[data-dot="planned"]')).toHaveLength(4);
    expect(day.querySelector('[data-pin="visit"]')).toHaveTextContent("Anitha11:00");
  });

  it("below the band: Needs you with the amount big, 'Your assistant is working on', Today's visits and This week's results", async () => {
    const store: TodayData["store"] = { state: "ready", slots: "unknown", nextFree: null, visits: [{ id: "v", starts_at: "2026-10-11T05:30:00Z", who: "Anitha", extra: 0, topic: "Bridal silks", status: "confirmed", here: false }] };
    const results = { stages: [{ id: "enquiries" as const, value: 58, width: 100 }, { id: "visits" as const, value: 18, width: 31 }], costs: [{ name: "Instagram ads", amountText: "₹180", width: 100 }] };
    await view({ ...base, results }, { data: data({ store }) });
    const lower = document.querySelector('[data-part="v6-lower"]') as HTMLElement;
    expect(within(lower).getByRole("heading", { name: /Needs you/ })).toBeInTheDocument();
    expect(lower.querySelector("[data-needs-design]")).not.toBeNull();
    expect([...lower.querySelectorAll("[data-needs-amount]")].map((x) => x.textContent)).toContain("₹14,175");
    expect(within(lower).getByRole("heading", { name: "Your assistant is working on" })).toBeInTheDocument();
    expect(within(lower).getByRole("heading", { name: "Today's visits" })).toBeInTheDocument();
    expect(within(lower).getByText("11:00")).toBeInTheDocument();
    expect(within(lower).getByRole("heading", { name: "This week's results" })).toBeInTheDocument();
    expect(within(lower).getByText("58")).toBeInTheDocument();
    expect(within(lower).getByText("₹180 / visit")).toBeInTheDocument();
    // left column: Needs you then working on; right: visits then results
    const left = lower.children[0] as HTMLElement;
    const right = lower.children[1] as HTMLElement;
    expect(left.querySelector("#needs-you")).not.toBeNull();
    expect(left.querySelector('[data-part="working-on"]')).not.toBeNull();
    expect(right.querySelector('[data-part="todays-visits"]')).not.toBeNull();
    expect(right.querySelector('[data-part="results"]')).not.toBeNull();
  });

  it("removes what the final design does not have: the stand-up, the team strip, the summary cards, the More fold, the totals, the old setup line, the status card, the suggested row", async () => {
    await view(base, { live: <p data-testid="standup">Daily stand-up</p>, outcomes: <p data-testid="outcomes">x</p>, intro: <p data-testid="intro">Finish setting up</p> });
    for (const gone of ["standup", "outcomes", "intro"]) expect(screen.queryByTestId(gone)).toBeNull();
    expect(document.querySelector('[data-part="v5-more"]')).toBeNull();
    expect(document.querySelector('[data-part="status-card"]')).toBeNull();
    expect(document.querySelector('[data-part="suggested"]')).toBeNull();
    expect(document.body.textContent).not.toMatch(/AI team|stand-up/i);
  });

  it("on a phone the sections follow the order Needs you, Your day, working on, visits, results (the order classes)", async () => {
    await view(base);
    const order = (el: Element | null) => {
      for (let e = el; e; e = e.parentElement) {
        const hit = [...e.classList].find((c) => /^order-\d$/.test(c));
        if (hit) return hit.slice(6);
      }
      return undefined;
    };
    expect(order(document.querySelector('[data-part="band"]'))).toBe("1");
    expect(order(document.querySelector("#needs-you"))).toBe("2");
    expect(order(document.querySelector('[data-part="your-day"]'))).toBe("3");
    expect(order(document.querySelector('[data-part="working-on"]'))).toBe("4");
    expect(order(document.querySelector('[data-part="results"]'))).toBe("6");
  });

  it("the day-one checklist takes the band's place (no 'Your day', no working-on card, no phone bar)", async () => {
    const dayOne: V6In["dayOne"] = { name: "Asha", steps: stepViews({ shop: true }, BASE), canGoLive: false, missing: ["phone_number"], actions: { skip: async () => undefined, goLive: async () => ({ ok: false, missing: [] }), testNumber: null }, helpHref: "/app/support/whatsapp?page=today", testCallHref: `${BASE}/calls` };
    await view({ ...base, dayOne });
    expect(document.querySelector('[data-part="day-one"]')).not.toBeNull();
    expect(document.querySelector('[data-part="band"]')).toBeNull();
    expect(document.querySelector('[data-part="your-day"]')).toBeNull();
    expect(document.querySelector('[data-part="working-on"]')).toBeNull();
    expect(document.querySelector('[data-part="phone-bar"]')).toBeNull();
  });

  it("the 'Finish setup' chip is in the band's first line; the page header above the band is only the screen reader's H1", async () => {
    await view({ ...base, chip: <a data-part="finish-chip" href="#x">Finish setup · 3/7</a> });
    expect(document.querySelector('[data-part="eyebrow"] [data-part="finish-chip"]')).not.toBeNull();
    expect(document.querySelector("header")).toHaveClass("sr-only");
    expect(document.querySelectorAll('[data-part="finish-chip"]')).toHaveLength(1);
  });

  it("the example-data note is ONE small line, last in the order of the page (at the bottom)", async () => {
    await view(base, { exampleLine: <p data-testid="example">You are looking at example data</p> });
    const note = screen.getByTestId("example").parentElement as HTMLElement;
    expect(note).toHaveClass("order-last"); // last in the visual order (the page is a flex column), whatever its place in the markup
  });

  it("on a phone the bottom bar's block is last in the order, so it cannot push the band down (the 170px gap)", async () => {
    await view(base);
    expect(document.querySelector('[data-part="phone-after"]')!.parentElement).toHaveClass("order-last");
  });

  it("with no v6 (the flag off) Today is exactly as it was: the old bar, no band, no phone bar", async () => {
    await view(null);
    expect(document.querySelector('[data-part="band"]')).toBeNull();
    expect(document.querySelector('[data-part="phone-bar"]')).toBeNull();
    expect(document.querySelector('[data-part="v6-heading"]')).toBeNull();
    expect(document.querySelector('[data-screen="today"]')).not.toHaveAttribute("data-v6");
    expect(document.querySelector('[data-part="command-bar"]')).not.toHaveAttribute("data-v6");
  });
});
