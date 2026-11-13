import { beforeEach, describe, expect, it, vi } from "vitest";

const jar = vi.hoisted(() => new Map<string, string>());
vi.mock("next/headers", () => ({ cookies: async () => ({ get: (k: string) => (jar.has(k) ? { name: k, value: jar.get(k) } : undefined), set: (k: string, v: string, o?: { maxAge?: number }) => (o?.maxAge === 0 ? jar.delete(k) : jar.set(k, v)) }) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireUser: async () => ({ id: "u", email: "e@example.test", accessToken: "tok" }) }));
const readFacts = vi.fn();
vi.mock("@/lib/packs/activation-facts", () => ({ readFacts: (...a: unknown[]) => readFacts(...a) }));
const listCalls = vi.fn();
const getCall = vi.fn();
vi.mock("@/lib/api/calls", () => ({ listCalls: (...a: unknown[]) => listCalls(...a), getCall: (...a: unknown[]) => getCall(...a) }));
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
    expect(v?.number).toBe("+91 ••••• ••421");
    expect(v?.number).not.toContain("90000");
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

  it("CALL_SCREENS=mock: a made-up last conversation; ?live=1 adds a made-up live call", async () => {
    vi.stubEnv("CALL_SCREENS", "mock");
    const v = await readV6(args());
    expect(v?.last?.lines).toHaveLength(2);
    expect(v?.mock).toBeNull();
    const live = await readV6(args({ live: "1" }));
    expect(live?.mock?.caller).toBeTruthy();
    expect(live?.mock?.lines.length).toBeGreaterThan(1);
  });

  it("CALL_SCREENS off: no last conversation and never a made-up live call, whatever the address says", async () => {
    const v = await readV6(args({ live: "1" }));
    expect(v?.last).toBeNull();
    expect(v?.mock).toBeNull();
    expect(listCalls).not.toHaveBeenCalled();
  });

  it("CALL_SCREENS=1: the last finished conversation's last two lines from the calls API; a failure is no conversation", async () => {
    vi.stubEnv("CALL_SCREENS", "1");
    listCalls.mockResolvedValue({ items: [{ id: "c1", live: true, state: "in_progress", sandbox: false, who: "A" }, { id: "c2", live: false, state: "completed", sandbox: false, who: "Ravi Kumar" }] });
    getCall.mockResolvedValue({ transcript: [{ who: "assistant", text: "one", textEn: null }, { who: "caller", text: "two", textEn: "two (en)" }, { who: "assistant", text: "three", textEn: null }] });
    const v = await readV6(args());
    expect(getCall).toHaveBeenCalledWith("tok", T, "c2");
    expect(v?.last).toEqual({ who: "Ravi Kumar", lines: [{ who: "customer", text: "two (en)" }, { who: "assistant", text: "three" }] });
    listCalls.mockRejectedValue(new Error("down"));
    expect((await readV6(args()))?.last).toBeNull();
  });
});
