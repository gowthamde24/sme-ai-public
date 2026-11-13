import { beforeEach, describe, expect, it, vi } from "vitest";

const jar = vi.hoisted(() => new Map<string, string>());
vi.mock("next/headers", () => ({ cookies: async () => ({ get: (k: string) => (jar.has(k) ? { name: k, value: jar.get(k) } : undefined), set: (k: string, v: string, o?: { maxAge?: number }) => (o?.maxAge === 0 ? jar.delete(k) : jar.set(k, v)) }) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireUser: async () => ({ id: "u", email: "e@example.test", accessToken: "tok" }) }));
const readFacts = vi.fn();
vi.mock("@/lib/packs/activation-facts", () => ({ readFacts: (...a: unknown[]) => readFacts(...a) }));
const listCalls = vi.fn();
vi.mock("@/lib/api/calls", () => ({ listCalls: (...a: unknown[]) => listCalls(...a) }));
const readTasks = vi.fn();
vi.mock("@/lib/tasks/source", () => ({ readTasks: (...a: unknown[]) => readTasks(...a) }));
const readResultsV6 = vi.fn();
vi.mock("./report/v6-data", () => ({ readResultsV6: (...a: unknown[]) => readResultsV6(...a) }));
const request = vi.fn();
vi.mock("@/lib/api/client", async (orig) => ({ ...(await orig<typeof import("@/lib/api/client")>()), apiRequest: (...a: unknown[]) => request(...a), fetchTenant: vi.fn() }));

import { MOCK_NUMBER, PHONE_COOKIE } from "@/lib/assistant-status/go-live";
import { CHOICE_COOKIE } from "@/lib/assistant-status/setup-choice";
import { COOKIE } from "@/lib/assistant-status/source";

import { readV6 } from "./today-v6";

const T = "22222222-2222-4222-8222-222222222222";
const BASE = `/app/tenants/${T}`;
const args = (over: Partial<Parameters<typeof readV6>[0]> = {}): Parameters<typeof readV6>[0] => ({ token: "tok", tenantId: T, role: "owner", lang: "en", shop: "Sri Lakshmi Silks", userName: "Gowtham", modules: [], setup: null, live: null, base: BASE, ...over });

beforeEach(() => {
  vi.clearAllMocks();
  jar.clear();
  vi.unstubAllEnvs();
  vi.stubEnv("DESIGN_V6", "1");
  vi.stubEnv("ASSISTANT_STATUS", "mock");
  readFacts.mockResolvedValue({ catalogue_has_items: true, lead_source_added: false });
  readTasks.mockResolvedValue({ ok: true, value: [] });
  readResultsV6.mockResolvedValue({ counts: { enquiries: null, called: null, visits: null, quotes: null, won: null }, quotesPaise: null, sources: [], costPerVisitPaise: null, mock: false });
});

describe("what the page gives Today for the design system v6", () => {
  it("is nothing where DESIGN_V6 is off", async () => {
    vi.stubEnv("DESIGN_V6", "");
    expect(await readV6(args())).toBeNull();
  });

  it("day one: until the assistant is live, the checklist with the facts it can read; Go live is not offered without a phone number", async () => {
    const v = await readV6(args());
    expect(v?.dayOne).not.toBeNull();
    expect(v?.dayOne?.name).toBe("Gowtham");
    expect(Object.fromEntries((v?.dayOne?.steps ?? []).map((s) => [s.id, s.done]))).toEqual({ shop: true, catalogue: true, speaks: false, rules: false, practise: false, phone: false, sources: false });
    expect(v?.dayOne?.steps.find((s) => s.current)?.id).toBe("speaks");
    expect(v?.dayOne?.canGoLive).toBe(false);
    expect(v?.dayOne?.missing).toEqual(["phone_number"]);
    expect(v?.dayOne?.helpHref).toBe("/app/support/whatsapp?page=today");
    expect(v?.dayOne?.actions.testNumber).not.toBeNull(); // staging (mock) only
    expect(v?.chip).toBeNull();
  });

  it("with a connected phone number and a business name the assistant can go live with defaults; the number is masked", async () => {
    jar.set(PHONE_COOKIE, MOCK_NUMBER);
    const v = await readV6(args());
    expect(v?.dayOne?.canGoLive).toBe(true);
    expect(v?.dayOne?.missing).toEqual([]);
  });

  it("the placeholder name 'My business' is missing too", async () => {
    jar.set(PHONE_COOKIE, MOCK_NUMBER);
    const v = await readV6(args({ shop: "My business" }));
    expect(v?.dayOne?.missing).toEqual(["business_name"]);
    expect(v?.dayOne?.steps[0].done).toBe(false);
  });

  it("a fact that cannot be read is 'not done'", async () => {
    readFacts.mockRejectedValue(new Error("down"));
    const v = await readV6(args());
    expect(v?.dayOne?.steps.find((s) => s.id === "catalogue")?.done).toBe(false);
  });

  it("'Skip for now': the normal Today with the 'Finish setup' chip; dismissed: nothing", async () => {
    jar.set(CHOICE_COOKIE, JSON.stringify({ [T]: "skipped" }));
    const skipped = await readV6(args());
    expect(skipped?.dayOne).toBeNull();
    expect(skipped?.chip).not.toBeNull();
    jar.set(CHOICE_COOKIE, JSON.stringify({ [T]: "dismissed" }));
    const gone = await readV6(args());
    expect(gone?.dayOne).toBeNull();
    expect(gone?.chip).toBeNull();
  });

  it("live: the normal Today (the chip stays while steps are left); the chip's link (?setup=1) reopens the checklist", async () => {
    jar.set(COOKIE, "live");
    const live = await readV6(args());
    expect(live?.dayOne).toBeNull();
    expect(live?.chip).not.toBeNull();
    const again = await readV6(args({ setup: "1" }));
    expect(again?.dayOne).not.toBeNull();
  });

  it("the chip stays while steps are left, even live with everything readable done (practise has no fact yet)", async () => {
    jar.set(COOKIE, "live");
    jar.set(PHONE_COOKIE, MOCK_NUMBER);
    readFacts.mockResolvedValue({ catalogue_has_items: true, lead_source_added: true });
    expect((await readV6(args()))?.chip).not.toBeNull();
  });

  it("an Admin sets up too; Sales and the rest see no checklist and no chip", async () => {
    expect((await readV6(args({ role: "admin" })))?.dayOne).not.toBeNull();
    const sales = await readV6(args({ role: "sales" }));
    expect(sales?.dayOne).toBeNull();
    expect(sales?.chip).toBeNull();
    expect(readFacts).toHaveBeenCalledTimes(1); // only the Admin's page read the facts
  });

  it("an assistant whose status cannot be known (the flag is off) is taken as live: no checklist on a guess", async () => {
    vi.stubEnv("ASSISTANT_STATUS", "");
    const v = await readV6(args());
    expect(v?.dayOne).toBeNull();
    expect(v?.chip).toBeNull();
    expect(readFacts).not.toHaveBeenCalled();
  });

  it("CALL_SCREENS=mock: made-up calls for the timeline; ?live=1 adds a made-up live call", async () => {
    vi.stubEnv("CALL_SCREENS", "mock");
    const v = await readV6(args());
    expect(v?.dayCalls).toHaveLength(13);
    expect(v?.mockLive).toBeNull();
    const live = await readV6(args({ live: "1" }));
    expect(live?.mockLive?.caller).toBeTruthy();
  });

  it("CALL_SCREENS off: no calls read and never a made-up live call, whatever the address says", async () => {
    const v = await readV6(args({ live: "1" }));
    expect(v?.dayCalls).toBeNull();
    expect(v?.mockLive).toBeNull();
    expect(listCalls).not.toHaveBeenCalled();
  });

  it("CALL_SCREENS=1: today's calls (their start times) and the calls that are LIVE now, from the calls list the Calls page's strip reads; the sandbox's calls are left out of the dots; a failure is 'not known'", async () => {
    vi.stubEnv("CALL_SCREENS", "1");
    listCalls.mockResolvedValue({ items: [{ id: "c0", createdAt: "2026-11-13T15:50:00Z", sandbox: false, live: true, who: "Padmaja Naidu", elapsedS: 84 }, { id: "c1", createdAt: "2026-11-13T04:00:00Z", sandbox: false, live: false, who: "A", elapsedS: 0 }, { id: "c2", createdAt: "2026-11-13T04:10:00Z", sandbox: true, live: false, who: "B", elapsedS: 0 }, { id: "c3", createdAt: "2026-11-13T04:20:00Z", sandbox: false, live: false, who: "C", elapsedS: 0 }] });
    const v = await readV6(args());
    expect(v?.dayCalls).toEqual(["2026-11-13T15:50:00Z", "2026-11-13T04:00:00Z", "2026-11-13T04:20:00Z"]);
    expect(v?.liveCalls).toEqual([{ id: "c0", who: "Padmaja Naidu", elapsedS: 84 }]);
    listCalls.mockRejectedValue(new Error("down"));
    const none = await readV6(args());
    expect(none?.dayCalls).toBeNull();
    expect(none?.liveCalls).toEqual([]);
    expect((await readV6(args({ role: "viewer" })))?.dayCalls).toBeNull(); // a Viewer has no calls
  });

  it("'Your assistant is working on': the approved job from the tasks API (TASK_SCREENS); none when the flag is off or nothing runs", async () => {
    expect((await readV6(args()))?.working).toBeNull();
    expect(readTasks).not.toHaveBeenCalled();
    vi.stubEnv("TASK_SCREENS", "1");
    expect((await readV6(args()))?.working).toBeNull();
    readTasks.mockResolvedValue({ ok: true, value: [{ id: "t1", status: "running", instruction: "Call my enquiries", plan: { contacts_total: 9, window: { to_minute: 1200 } }, progress: { total: 9, waiting: 4, in_progress: 0, done: 5, positive: 2 }, approved_at: "2026-11-13T03:35:00Z", created_at: "2026-11-13T03:00:00Z" }] });
    const v = await readV6(args());
    expect(v?.working).toMatchObject({ title: "Call my enquiries", total: 9, done: 5, waiting: 4, toMinute: 1200 });
    readTasks.mockResolvedValue({ ok: false, error: "down" });
    expect((await readV6(args()))?.working).toBeNull();
    expect((await readV6(args({ role: "sales" })))?.working).toBeNull(); // the plan is the Owner's and Admin's to see
  });

  it("'This week's results': the funnel and the cost per visit by source, from the same reads as Reports (OUTREACH_SCREENS)", async () => {
    expect((await readV6(args()))?.results).toEqual({ stages: [], costs: [] });
    expect(readResultsV6).not.toHaveBeenCalled();
    vi.stubEnv("OUTREACH_SCREENS", "1");
    readResultsV6.mockResolvedValue({ counts: { enquiries: 58, called: 56, visits: 18, quotes: 11, won: 7 }, quotesPaise: null, sources: [{ source: "instagram_ads", enquiries: 30, visits: 10, costPerVisitPaise: 18000 }], costPerVisitPaise: null, mock: false });
    const v = await readV6(args());
    expect(v?.results.stages.map((s) => [s.id, s.value])).toEqual([["enquiries", 58], ["called", 56], ["visits", 18], ["quotes", 11], ["won", 7]]);
    expect(v?.results.costs).toEqual([{ name: "instagram ads", amountText: "₹180", width: 100 }]);
    readResultsV6.mockRejectedValue(new Error("down"));
    expect((await readV6(args()))?.results).toEqual({ stages: [], costs: [] });
  });

  it("the business name and language are handed on for the eyebrow and the language dropdown", async () => {
    const v = await readV6(args());
    expect(v?.shop).toBe("Sri Lakshmi Silks");
  });
});

import { businessLanguage } from "./today-v6";
describe("the composer's language starts on the business's own (owner, 13 Nov 2026)", () => {
  it("the first language that is not English; English only when it is all there is; none = none", () => {
    expect(businessLanguage(["en", "te"])).toBe("te");
    expect(businessLanguage(["te", "en"])).toBe("te");
    expect(businessLanguage(["en"])).toBe("en");
    expect(businessLanguage([])).toBeNull();
  });
});
