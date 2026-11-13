import { act, cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => undefined, push: () => undefined }), usePathname: () => "/", useSearchParams: () => new URLSearchParams() }));
vi.mock("./ask/LazyAskCard", async () => ({ AskCard: (await import("./ask/AskCard")).AskCard }));
vi.mock("../live/live-calls-store", () => ({ useLiveCalls: () => ({ calls: [], at: 0, status: "ok" }) }));
// the band, the phone parts and the day-one checklist are lazy chunks (next/dynamic): a test draws them at once
vi.mock("./v6/LazyTodayBand", async () => {
  const m = await import("./v6/TodayBand");
  return { LazyTodayBand: m.TodayBand, LazyTodayBandAfter: m.TodayBandAfter };
});
vi.mock("./v6/day-one/LazyDayOne", async () => ({ LazyDayOne: (await import("./v6/day-one/DayOne")).default }));

import { appDict } from "@/i18n/app";

import { TodayView } from "./TodayView";
import { NOW, call, classic, fakeActions, outbox, t } from "./today-test-kit";
import { stepViews } from "./v6/day-one/steps";
import type { V6In } from "./v6/types";
import { NOTHING_TODAY, type TodayData } from "./types";

const WORDS = Object.fromEntries(Object.entries(appDict("en") as Record<string, string>).filter(([k]) => k.startsWith("tv6.") || k.startsWith("dst.")));
const BASE = "/app/tenants/22222222-2222-2222-2222-222222222222";
const base: V6In = { words: WORDS, language: "English", businessLang: "te", number: "+91 ••••• ••421", last: null, mock: null, mockMore: 1, dayOne: null, chip: null };
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

describe("Today with the design system v6", () => {
  it("draws the band first (greeting, one line from Today's own data), then Needs you, then the summary; the page's H1 stays 'Today'", async () => {
    await view(base);
    expect(screen.getByRole("heading", { level: 1, name: "Today" })).toBeInTheDocument();
    const band = document.querySelector('[data-part="today-band"]') as HTMLElement;
    expect(band).not.toBeNull();
    expect(within(band).getByText("Good morning, Asha", { selector: "h2[data-part=greeting]" })).toBeInTheDocument();
    const line = band.querySelector('[data-part="band-line"]') as HTMLElement;
    expect(line.textContent).toContain("4 new enquiries");
    expect(line.textContent).toContain("₹14,175 in quotes");
    expect(line.textContent).not.toMatch(/visit/); // the store is not known: nothing is guessed
    const order = [...document.querySelectorAll('[data-part="today-band"], [data-part="needs-you"], section[aria-labelledby], [data-part="phone-after"]')];
    expect(order[0]).toBe(band);
  });

  it("the greeting, the command bar and the status card sit in one rounded band", async () => {
    await view(base);
    const band = document.querySelector('[data-part="band"]') as HTMLElement;
    expect(band).toHaveClass("ds-band", "rounded-[30px]");
    expect(band.querySelector('[data-part="greeting"]')).not.toBeNull();
    expect(band.querySelector('[data-part="command-bar"]')).not.toBeNull();
    expect(band.querySelector('[data-part="status-card"]')).not.toBeNull();
  });

  it("the old hero and the old command bar are gone (one bar, not two)", async () => {
    await view(base, { hero: <p data-testid="old-hero">hero</p> });
    expect(document.querySelectorAll('[data-part="command-bar"]')).toHaveLength(1);
    expect(document.querySelector('[data-part="command-bar"]')).toHaveAttribute("data-v6");
  });

  it("suggests jobs from the business's own data (new enquiries, quotes waiting) and the status card shows today's counts", async () => {
    await view(base);
    const items = [...document.querySelectorAll('[data-variant="row"] [data-suggestion]')].map((x) => x.getAttribute("data-suggestion"));
    expect(items).toEqual(["leads", "quotes"]);
    expect(document.querySelector('[data-part="today-counts"]')).toHaveTextContent("3Need you");
    expect(document.querySelector('[data-part="masked-number"]')).toHaveTextContent("+91 ••••• ••421");
  });

  it("shows the next visit in the status card, from the store's own list", async () => {
    const store: TodayData["store"] = { state: "ready", slots: "unknown", nextFree: null, visits: [{ id: "v", starts_at: "2026-10-11T12:00:00Z", who: "Ravi Kumar", extra: 0, topic: null, status: "confirmed", here: false }] };
    await view(base, { data: data({ store }) });
    expect(document.querySelector('[data-part="next-up"]')).toHaveTextContent(/Next up: Ravi Kumar · 5:30/);
    expect(document.querySelector('[data-part="band-line"]')?.textContent).toContain("1 visit booked");
  });

  it("the day-one checklist takes the band's place, with the phone parts gone", async () => {
    const dayOne: V6In["dayOne"] = { name: "Asha", steps: stepViews({ shop: true }, BASE), canGoLive: false, missing: ["phone_number"], actions: { skip: async () => undefined, goLive: async () => ({ ok: false, missing: [] }), testNumber: null }, helpHref: "/app/support/whatsapp?page=today", testCallHref: `${BASE}/calls` };
    await view({ ...base, dayOne });
    expect(document.querySelector('[data-part="day-one"]')).not.toBeNull();
    expect(document.querySelector('[data-part="today-band"]')).toBeNull();
    expect(document.querySelector('[data-part="phone-bar"]')).toBeNull();
  });

  it("the 'Finish setup' chip sits at the top of the normal Today", async () => {
    await view({ ...base, chip: <a data-part="finish-chip" href="#x">Finish setup · 3/7</a> });
    expect(screen.getByText("Finish setup · 3/7")).toBeInTheDocument();
    expect(document.querySelector('[data-part="v6-heading"] [data-part="finish-chip"]')).not.toBeNull();
  });

  it("with no v6 (the flag off) Today is exactly as it was: the old bar, no band, no phone bar", async () => {
    await view(null);
    expect(document.querySelector('[data-part="today-band"]')).toBeNull();
    expect(document.querySelector('[data-part="phone-bar"]')).toBeNull();
    expect(document.querySelector('[data-part="v6-heading"]')).toBeNull();
    expect(document.querySelector('[data-part="command-bar"]')).not.toHaveAttribute("data-v6");
  });
});
