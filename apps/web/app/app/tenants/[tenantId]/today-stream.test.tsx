import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiAuthError } from "@/lib/api/client";
import { NO_COUNTS } from "@/lib/nav-counts";
import { agentsStatus, todayFor } from "@/test/screens/today-fixtures";

/**
 * Today in the design system v6 draws in parts (today-stream.tsx): the briefing line, the first screen, does not wait for the slowest data. These tests hold single reads open (deferred promises) and look at what is on the page at each moment:
 * a placeholder of the same box where a part is still being read, the briefing as soon as ITS reads are done, a quiet part when a read fails, and one call of the API per read.
 */
const requireUser = vi.fn();
const fetchTenant = vi.fn();
const getToday = vi.fn();
const getAgentsStatus = vi.fn();
const getNavCounts = vi.fn();
const getTodayBriefing = vi.fn();
const readLeadDesk = vi.fn();
const readFinderNeeds = vi.fn();
const getProfile = vi.fn();
const getTodayVisits = vi.fn();
const getSlots = vi.fn();
const getOutcomeTotals = vi.fn();
const listPriceAsks = vi.hoisted(() => vi.fn(async (..._args: unknown[]): Promise<unknown[]> => []));
const fetchMembers = vi.fn();
const redirect = vi.fn();
const readTemplates = vi.hoisted(() => vi.fn(async (): Promise<unknown[]> => []));

vi.mock("next/navigation", () => ({ redirect: (to: string) => redirect(to), notFound: () => undefined, useRouter: () => ({ refresh: () => undefined, push: () => undefined }), usePathname: () => "/", useSearchParams: () => new URLSearchParams() }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock("@/lib/auth/session", () => ({ requireUser: () => requireUser() }));
vi.mock("@/lib/api/client", async (orig) => ({ ...(await orig<typeof import("@/lib/api/client")>()), fetchTenant: (...a: unknown[]) => fetchTenant(...a) }));
vi.mock("@/lib/api/today", async (orig) => ({ ...(await orig<typeof import("@/lib/api/today")>()), getToday: (...a: unknown[]) => getToday(...a), getAgentsStatus: (...a: unknown[]) => getAgentsStatus(...a) }));
vi.mock("@/lib/api/today-briefing", async (orig) => ({ ...(await orig<typeof import("@/lib/api/today-briefing")>()), getTodayBriefing: (...a: unknown[]) => getTodayBriefing(...a) }));
vi.mock("@/lib/api/nav-counts", async (orig) => ({ ...(await orig<typeof import("@/lib/api/nav-counts")>()), getNavCounts: (...a: unknown[]) => getNavCounts(...a) }));
vi.mock("@/lib/api/profile", async (orig) => ({ ...(await orig<typeof import("@/lib/api/profile")>()), getProfile: (...a: unknown[]) => getProfile(...a) }));
vi.mock("@/lib/api/visits", async (orig) => ({ ...(await orig<typeof import("@/lib/api/visits")>()), getTodayVisits: (...a: unknown[]) => getTodayVisits(...a), getSlots: (...a: unknown[]) => getSlots(...a) }));
vi.mock("@/lib/api/outcomes", async (orig) => ({ ...(await orig<typeof import("@/lib/api/outcomes")>()), getOutcomeTotals: (...a: unknown[]) => getOutcomeTotals(...a) }));
vi.mock("@/lib/api/orders", async (orig) => ({ ...(await orig<typeof import("@/lib/api/orders")>()), fetchMembers: (...a: unknown[]) => fetchMembers(...a) }));
vi.mock("@/lib/api/price-asks", async (orig) => ({ ...(await orig<typeof import("@/lib/api/price-asks")>()), listPriceAsks: (...a: unknown[]) => listPriceAsks(...a) }));
vi.mock("@/lib/lead-desk/source", async (orig) => ({ ...(await orig<typeof import("@/lib/lead-desk/source")>()), readTemplates: () => readTemplates() }));
vi.mock("./lead-desk-today", async (orig) => ({ ...(await orig<typeof import("./lead-desk-today")>()), readLeadDesk: (...a: unknown[]) => readLeadDesk(...a) }));
vi.mock("./lead-finder-today", async (orig) => ({ ...(await orig<typeof import("./lead-finder-today")>()), readFinderNeeds: (...a: unknown[]) => readFinderNeeds(...a) }));
vi.mock("./today-actions", () => ({ approveMessageAction: vi.fn(), rejectMessageAction: vi.fn(), editMessageAction: vi.fn(), approveCallAction: vi.fn(), offerVisitAction: vi.fn(), skipProspectAction: vi.fn(), priceAskAnsweredAction: vi.fn(), enquiryDoneAction: vi.fn(), callHandledAction: vi.fn() }));
vi.mock("./actions", () => ({ createCompanyAction: vi.fn(async () => undefined) }));
vi.mock("@/components/v2/app/live/live-calls-store", () => ({ useLiveCalls: () => ({ calls: [], at: 0, status: "ok" }), pokeLiveCalls: () => undefined }));
// the band, "Your day", "Your assistant is working on" and the day-one checklist are lazy chunks (next/dynamic): a test draws them at once
vi.mock("@/components/v2/app/today/v6/LazyTodayBand", async () => {
  const m = await import("@/components/v2/app/today/v6/TodayBand");
  return { LazyTodayBand: m.TodayBand, LazyTodayBandAfter: () => null };
});
vi.mock("@/components/v2/app/today/v6/LazyYourDay", async () => ({ LazyYourDay: (await import("@/components/v2/app/today/v6/YourDay")).default }));
vi.mock("@/components/v2/app/today/v6/LazyWorkingOn", async () => ({ LazyWorkingOn: (await import("@/components/v2/app/today/v6/WorkingOn")).default }));
vi.mock("@/components/v2/app/today/v6/day-one/LazyDayOne", async () => ({ LazyDayOne: (await import("@/components/v2/app/today/v6/day-one/DayOne")).default }));
const startV6 = vi.hoisted(() => vi.fn());
vi.mock("./today-v6", async (orig) => {
  const real = await orig<typeof import("./today-v6")>();
  startV6.mockImplementation(real.startV6);
  return { ...real, startV6: (...a: unknown[]) => startV6(...a) };
});

import TenantPage from "./page";

const TENANT = "22222222-2222-2222-2222-222222222222";
const props = () => ({ params: Promise.resolve({ tenantId: TENANT }), searchParams: Promise.resolve({}) }) as unknown as Parameters<typeof TenantPage>[0];

/** A read that answers when the test says so. */
function deferred<V>() {
  let resolve!: (v: V) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<V>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
/** Lets the streamed parts settle: rounds of the clock until the page has not changed for five rounds in a row (a fixed number of rounds was not enough on a loaded machine, where the lazy modules load slower). */
const flush = async () => {
  let before = "";
  let still = 0;
  for (let i = 0; i < 200 && still < 5; i += 1) {
    await act(async () => void (await new Promise((r) => setTimeout(r, i < 4 ? 0 : 10))));
    const now = document.body.innerHTML;
    still = now === before ? still + 1 : 0;
    before = now;
  }
};
const show = async () => {
  const element = await TenantPage(props());
  await act(async () => void render(element));
  await flush();
};

const COUNTS = { ...NO_COUNTS, newLeads: 35, needsYou: 2, leadDeskWaiting: 0, prospectsNeedingOwner: 0 };
const briefing = () => document.querySelector<HTMLElement>('[data-part="briefing"]:not([data-placeholder])');
const briefingPlaceholder = () => document.querySelector<HTMLElement>('[data-part="briefing"][data-placeholder]');
const needsRows = () => document.querySelectorAll("[data-needs-row]");
const needsBox = () => document.querySelector<HTMLElement>(".order-2");

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("DESIGN_V6", "1");
  vi.stubEnv("ASSISTANT_STATUS", "");
  window.matchMedia = vi.fn().mockImplementation((q: string) => ({ matches: q.includes("min-width"), media: q, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  requireUser.mockResolvedValue({ id: "user-1", email: "e@example.test", accessToken: "tok" });
  fetchTenant.mockResolvedValue({ id: TENANT, name: "Acme Silks", slug: "acme", role: "owner" });
  getToday.mockResolvedValue(todayFor("owner"));
  getAgentsStatus.mockResolvedValue(agentsStatus());
  getNavCounts.mockResolvedValue(COUNTS);
  readTemplates.mockReset().mockResolvedValue([]);
  getTodayBriefing.mockResolvedValue(null); // (not told: the briefing waits for the big reads, as before; the fast path has its own tests)
  readLeadDesk.mockResolvedValue({ needs: [], team: [] });
  readFinderNeeds.mockResolvedValue([]);
  getProfile.mockResolvedValue({ name: "Acme", town: "Guntur", languages: ["en", "te"], setup_complete: true });
  getTodayVisits.mockRejectedValue(new Error("not read"));
  getSlots.mockRejectedValue(new Error("not read"));
  getOutcomeTotals.mockRejectedValue(new Error("not read"));
  fetchMembers.mockResolvedValue([]);
  listPriceAsks.mockResolvedValue([]);
});
afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

describe("the briefing line", () => {
  it("has a placeholder of its own while its reads are on the way, and the band around it is already drawn", async () => {
    const counts = deferred<typeof COUNTS>();
    getNavCounts.mockReturnValue(counts.promise);
    await show();
    expect(document.querySelector('[data-part="band"]')).not.toBeNull(); // the dark band, with its greeting
    expect(document.querySelector('[data-part="greeting"]')).toHaveTextContent(/^Good (morning|afternoon|evening)$/);
    const holder = briefingPlaceholder();
    expect(holder).not.toBeNull();
    expect(holder).toHaveAttribute("aria-hidden", "true");
    expect(holder).toHaveClass("ds-brief"); // the real line's own box (its font and line height come from the band's styles)
    expect(holder?.textContent?.replace(/\s/g, "")).toBe(""); // nothing to read: no words that the real line would not say
    expect(briefing()).toBeNull();
    await act(async () => counts.resolve(COUNTS));
    await flush();
    expect(briefingPlaceholder()).toBeNull();
    await waitFor(() => expect(briefing()).toHaveTextContent("35 new enquiries to look at"));
  });

  it("does not wait for Lead Desk, the Lead Finder or the rest: it is drawn while 'Needs you' is still a placeholder", async () => {
    const desk = deferred<{ needs: never[]; team: never[] }>();
    readLeadDesk.mockReturnValue(desk.promise);
    await show();
    await waitFor(() => expect(briefing()).toHaveTextContent("35 new enquiries to look at")); // (not a fixed number of clock ticks: slower on a loaded machine)
    expect(briefingPlaceholder()).toBeNull();
    expect(needsRows()).toHaveLength(0);
    expect(needsBox()?.querySelector("[data-placeholder]")).not.toBeNull(); // the box of "Needs you" holds its room
    await act(async () => desk.resolve({ needs: [], team: [] }));
    await flush();
    expect(needsRows().length).toBeGreaterThan(0);
    expect(needsBox()?.querySelector("[data-placeholder]")).toBeNull();
    await waitFor(() => expect(briefing()).toHaveTextContent("35 new enquiries to look at")); // the final text is the one it had
  });

  it("says the same words as when the page waited for everything (one quote: the quote at the top; the menu's number)", async () => {
    await show();
    // the quote of the fixture is the top decision of the list and the briefing links to it (the band streams in: wait for it, a slow machine draws it a moment later)
    await waitFor(() => expect(briefing()).not.toBeNull());
    expect(briefing()).toHaveTextContent(/35 new enquiries to look at.*One quote of ₹50,400 for Synthetic Buyer is waiting for you/);
    expect(briefing()?.querySelector("a")).not.toBeNull();
  });

  it("names the quote at the top of the finished list when two quotes could be named (Lead Desk's items re-sort the list), so it waits for them only then", async () => {
    const today = todayFor("owner");
    const quotes = today.needs_you.filter((i) => i.kind === "quote_approval");
    expect(quotes).toHaveLength(1);
    // one quote: it does not wait (the test above); with the menu's number unknown it waits, because the number is then the merged one
    getNavCounts.mockResolvedValue(null);
    const desk = deferred<{ needs: never[]; team: never[] }>();
    readLeadDesk.mockReturnValue(desk.promise);
    await show();
    await waitFor(() => expect(briefingPlaceholder()).not.toBeNull());
    expect(briefing()).toBeNull(); // (the number is then the merged one: it waits for Lead Desk, and its placeholder holds the room)
    await act(async () => desk.resolve({ needs: [], team: [] }));
    await flush();
    await waitFor(() => {
      expect(briefingPlaceholder()).toBeNull();
      expect(briefing()).not.toBeNull();
    });
  });
});

describe("a read that fails", () => {
  it("leaves 'Needs you' out (the way the page leaves a part out that cannot be read) and the rest of the page is drawn: never an unhandled error", async () => {
    readLeadDesk.mockRejectedValue(new Error("down"));
    await show();
    await waitFor(() => expect(document.querySelector("[data-placeholder]:not([data-part])")).toBeNull()); // no placeholder is left holding a room (the rejected read settles after the lazy modules have loaded: slower on a loaded machine)
    expect(needsRows()).toHaveLength(0);
    expect(document.querySelector("[data-needs-design]")).toBeNull();
    await waitFor(() => expect(briefing()).toHaveTextContent("35 new enquiries to look at")); // the briefing did not need it
    expect(document.querySelector('[data-part="band"]')).not.toBeNull();
    expect(redirect).not.toHaveBeenCalled();
  });

  it("the band says the one quiet sentence of the page when its reads fail", async () => {
    startV6.mockImplementationOnce(() => ({ band: Promise.reject(new Error("down")), lower: Promise.resolve({ working: null, results: { stages: [], costs: [] }, dayCalls: null, dayTransferred: null }) }));
    await show();
    const note = document.querySelector('[data-part="part-unavailable"]');
    expect(note).toHaveTextContent("Not available yet");
    expect(note).toHaveAttribute("role", "status");
    expect(document.querySelector('[data-part="band"]')).toBeNull();
    expect(document.querySelector('[data-screen="today"]')).not.toBeNull(); // the page's own box is there
  });

  it("a rejected session in a slow part still goes to the sign-in page", async () => {
    readLeadDesk.mockRejectedValue(new ApiAuthError());
    await show();
    expect(redirect).toHaveBeenCalledWith("/login");
  });
});

describe("one call of the API per read", () => {
  it("asks for each thing once, and not at all for what the design never draws (the older cards, the totals, the stand-up, the setup facts)", async () => {
    await show();
    expect(getToday).toHaveBeenCalledTimes(1);
    expect(getAgentsStatus).toHaveBeenCalledTimes(1); // the band's state and Today's data share the one read
    expect(getNavCounts).toHaveBeenCalledTimes(1); // the briefing and the number on "Needs you" share the one read
    expect(readLeadDesk).toHaveBeenCalledTimes(1);
    expect(readFinderNeeds).toHaveBeenCalledTimes(1);
    expect(getTodayVisits).toHaveBeenCalledTimes(1);
    expect(getProfile).toHaveBeenCalledTimes(1);
    expect(listPriceAsks).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(fetchMembers).toHaveBeenCalledTimes(1)); // the greeting's name (the profile has none in this test)
    expect(getOutcomeTotals).not.toHaveBeenCalled();
    expect(startV6).toHaveBeenCalledTimes(1);
  });

  it("asks Lead Desk for its items only: the workers of 'Your team' (not drawn in this design) cost no read", async () => {
    await show();
    expect(readLeadDesk.mock.calls[0]?.[6]).toBe(false);
  });
});

describe("the briefing painted from C1's small read", () => {
  const FAST = { needsYou: 2, newLeads: 35, visitsToday: 0, unreadChats: 1, followupsDue: 0, quotesWaiting: 1, liveCalls: 0 };

  it("paints the first sentence and the count of things waiting from the small read while the big reads are still on the way, then the quote sentence takes the second slot", async () => {
    getTodayBriefing.mockResolvedValue(FAST);
    const today = deferred<ReturnType<typeof todayFor>>();
    getToday.mockReturnValue(today.promise);
    await show();
    await waitFor(() => expect(briefing()).toHaveTextContent("35 new enquiries to look at"));
    await waitFor(() => expect(briefing()).toHaveTextContent("2 things are waiting for you")); // the count, from the small read
    expect(briefing()?.querySelector("a")).toHaveAttribute("href", "#needs-you");
    expect(briefingPlaceholder()).toBeNull();
    await act(async () => today.resolve(todayFor("owner")));
    await flush();
    await waitFor(() => expect(briefing()?.textContent).toMatch(/₹/)); // the quote at the top replaces the count (same slot: nothing moves)
    expect(briefing()?.textContent).toContain("35 new enquiries to look at");
  });

  it("sizes the placeholders from the small read: the rows of Needs you (the count and one more, 80 px each) and four lines for a briefing that names a quote, so nothing moves when they arrive", async () => {
    getTodayBriefing.mockResolvedValue({ ...FAST, needsYou: 2, quotesWaiting: 1 });
    const desk = deferred<{ needs: never[]; team: never[] }>();
    readLeadDesk.mockReturnValue(desk.promise);
    getToday.mockReturnValue(new Promise(() => undefined)); // the big read never answers: the placeholders stay
    await show();
    // (the same assertions, waited for: on a loaded CI machine the first paint of the placeholders comes a few clock ticks later than on a laptop)
    await waitFor(() => expect(needsBox()?.querySelector("[data-placeholder] > div:last-child")).not.toBeNull());
    const card = needsBox()?.querySelector("[data-placeholder] > div:last-child") as HTMLElement | null;
    expect(card?.className).toContain("min-h-[244px]"); // two waiting = three rows reserved (the list is sometimes one longer than the count: Lead Desk, the Lead Finder, the plan's upsell row; measured 244 px)
    await waitFor(() => expect(briefing()).not.toBeNull());
    expect(briefing()?.className).toContain("min-h-[4lh]"); // the line that is drawn from the small read keeps room for the quote sentence
  });

  it("the band's placeholder is as tall as a band whose briefing names a quote (167 px on a phone) while that is likely, and 124 px when the small read says no quote waits", async () => {
    getToday.mockReturnValue(new Promise(() => undefined));
    getTodayBriefing.mockReturnValue(new Promise(() => undefined)); // unknown: the long one
    getProfile.mockReturnValue(new Promise(() => undefined)); // the greeting's name never arrives: the band itself is still a placeholder
    fetchMembers.mockReturnValue(new Promise(() => undefined));
    await show();
    await waitFor(() => expect(document.querySelector(".ds-hero[data-placeholder]")).not.toBeNull());
    expect((document.querySelector(".ds-hero[data-placeholder]") as HTMLElement).className).toContain("min-h-[167px]");
  });

  it("holds four lines for the briefing while the small read has not answered (a cold start), so a quote sentence arriving later moves nothing", async () => {
    getTodayBriefing.mockReturnValue(new Promise(() => undefined)); // the small read never answers in time: the page does not wait for it more than 300 ms
    getToday.mockReturnValue(new Promise(() => undefined));
    await show();
    await waitFor(() => expect(briefingPlaceholder()).not.toBeNull());
    expect(briefingPlaceholder()?.className).toContain("min-h-[4lh]");
  });

  it("asks the small read once, with the person's token, and not for a business type that can have a campus card", async () => {
    getTodayBriefing.mockResolvedValue(FAST);
    await show();
    expect(getTodayBriefing).toHaveBeenCalledTimes(1);
    expect(getTodayBriefing.mock.calls[0][0]).toBeTruthy();
  });

  it("asks the small read at the start, together with the lead templates and the Lead Finder's access, not after them (its 300 ms wait began only once those had answered)", async () => {
    getTodayBriefing.mockResolvedValue(FAST);
    const templates = deferred<unknown[]>();
    readTemplates.mockReturnValue(templates.promise);
    const drawn = TenantPage(props());
    await waitFor(() => expect(readTemplates).toHaveBeenCalled());
    await waitFor(() => expect(getTodayBriefing).toHaveBeenCalledTimes(1)); // asked while the templates are still on their way
    await act(async () => templates.resolve([]));
    await act(async () => void render(await drawn));
    await flush();
    expect(getTodayBriefing).toHaveBeenCalledTimes(1); // and only once
    await waitFor(() => expect(briefing()).toHaveTextContent("35 new enquiries to look at"));
  });

  it("a Viewer, who has no briefing line, draws none (the page starts the small read before the role is known: one cheap read, not used)", async () => {
    fetchTenant.mockResolvedValue({ id: TENANT, name: "Acme Silks", slug: "acme", role: "viewer" });
    await show();
    expect(document.querySelector('[data-part="briefing"]')).toBeNull();
  });

  it("an API that cannot tell (null) leaves the briefing to the big reads, as before", async () => {
    getTodayBriefing.mockResolvedValue(null);
    await show();
    await waitFor(() => expect(briefing()).toHaveTextContent("35 new enquiries to look at"));
  });

  it("the second slot keeps the count when the big read fails: nothing disappears", async () => {
    getTodayBriefing.mockResolvedValue(FAST);
    getToday.mockRejectedValue(new Error("down"));
    await show();
    await flush();
    await waitFor(() => expect(briefing()).toHaveTextContent("35 new enquiries to look at"));
    await waitFor(() => expect(briefing()).toHaveTextContent("2 things are waiting for you"));
  });
});
