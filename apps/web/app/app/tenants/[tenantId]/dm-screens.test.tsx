import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { parseMembers } from "@/lib/api/orders";
import { MEMBERS_JSON, TENANT } from "@/lib/api/orders-fixtures";
import { notFoundMock, redirectMock } from "@/test/helpers";

const h = vi.hoisted(() => ({ requireUser: vi.fn(), fetchTenant: vi.fn(), jar: new Map<string, string>(), pack: null as { modules: string[] } | null }));
vi.mock("next/navigation", () => ({ redirect: (to: string) => redirectMock(to), notFound: () => notFoundMock(), useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: (k: string) => (h.jar.has(k) ? { name: k, value: h.jar.get(k) } : undefined), set: (k: string, v: string) => void h.jar.set(k, v) }) }));
vi.mock("@/lib/auth/session", () => ({ requireUser: () => h.requireUser() }));
vi.mock("@/lib/api/client", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/api/client")>()), fetchTenant: (...a: unknown[]) => h.fetchTenant(...a), apiRequest: async () => { throw new Error("no api in this test"); } }));
vi.mock("@/lib/api/orders", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/api/orders")>()), fetchMembers: async () => parseMembers(MEMBERS_JSON) }));
vi.mock("@/lib/api/plan", () => ({ getPlan: async () => ({ plan: "free_trial", workspace_limit: 1, trial_started_at: "2026-10-09T10:00:00Z" }) }));
vi.mock("@/lib/api/ai-usage", () => ({ getAiUsage: async () => ({ today_percent: 7, month_percent: 3, resets_at_today: "2026-10-10T18:30:00Z", resets_at_month: "2026-10-31T18:30:00Z", state: "ok" }) }));
vi.mock("@/lib/api/gstin", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/api/gstin")>()), getBusinessProfile: async () => ({ gstin: null, state: null }) }));
// next/dynamic loads a chunk on the client; a test renders the real component at once
vi.mock("@/components/v2/app/assistant/LazyAssistantSettings", async () => ({ AssistantSettings: (await import("@/components/v2/app/assistant/AssistantSettings")).AssistantSettings }));
vi.mock("@/lib/packs/read", () => ({ readPackCached: async () => (h.pack ? { id: "x", modules: h.pack.modules, labels: {}, names: {} } : null) }));

import { MOCK_COOKIE as ASSISTANT_COOKIE } from "@/lib/assistant/source";
import { MOCK_COOKIE as OUTCOME_COOKIE } from "@/lib/outcomes/mock";

import { saveAssistantAction } from "./assistant-actions";
import LiveCallPage from "./office/live/page";
import { correctOutcomeAction } from "./outcome-actions";
import SettingsPage from "./settings/page";

const settingsProps = (query: Record<string, string> = {}) => ({ params: Promise.resolve({ tenantId: TENANT }), searchParams: Promise.resolve(query) }) as unknown as Parameters<typeof SettingsPage>[0];
const liveProps = () => ({ params: Promise.resolve({ tenantId: TENANT }) }) as unknown as Parameters<typeof LiveCallPage>[0];
const tenant = (role: string) => ({ id: TENANT, name: "Acme Silks", slug: "acme-silks", role });
const tabNames = () => within(screen.getByRole("navigation", { name: "Parts of Settings" })).getAllByRole("link").map((a) => a.textContent);

beforeEach(() => {
  h.jar.clear();
  h.pack = null;
  h.requireUser.mockResolvedValue({ id: "11111111-1111-4111-8111-111111111111", email: "e@example.test", accessToken: "tok", aal: "aal2", hasSecondFactor: true });
  h.fetchTenant.mockResolvedValue(tenant("owner"));
});
afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

describe("the live call screen (CALL_SCREENS)", () => {
  it("is a 404 while the flag is off, and for a Viewer", async () => {
    await expect(LiveCallPage(liveProps())).rejects.toThrow(/not.?found/i);
    vi.stubEnv("CALL_SCREENS", "mock");
    h.fetchTenant.mockResolvedValue(tenant("viewer"));
    await expect(LiveCallPage(liveProps())).rejects.toThrow(/not.?found/i);
  });
  it("mock: shows the pretend call and says so; 1: says 'Not available yet' (there is no call feed yet)", async () => {
    vi.stubEnv("CALL_SCREENS", "mock");
    render(await LiveCallPage(liveProps()));
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Ravi Kumar");
    expect(screen.getByRole("note")).toHaveTextContent("pretend call");
    expect(screen.getByRole("link", { name: "Back" })).toHaveAttribute("href", `/app/tenants/${TENANT}`);
    cleanup();
    vi.stubEnv("CALL_SCREENS", "1");
    render(await LiveCallPage(liveProps()));
    expect(screen.getByText("Not available yet")).toBeInTheDocument();
    expect(document.querySelector('[data-screen="live-call"]')).toBeNull();
  });
});

describe("Settings > AI assistant (ASSISTANT_SCREENS)", () => {
  it("is not there while the flag is off: no tab, and ?section=assistant falls back to the business part", async () => {
    render(await SettingsPage(settingsProps({ section: "assistant" })));
    expect(tabNames()).not.toContain("AI assistant");
    expect(document.querySelector('[data-settings="assistant"]')).toBeNull();
  });
  it("mock: the Owner has the tab and the screen, with the defaults and the shop's name; an Admin has neither", async () => {
    vi.stubEnv("ASSISTANT_SCREENS", "mock");
    render(await SettingsPage(settingsProps({ section: "assistant" })));
    expect(tabNames()).toContain("AI assistant");
    expect(document.querySelector('[data-settings="assistant"]')).not.toBeNull();
    expect(screen.getByLabelText("Assistant name")).toHaveValue("your assistant");
    expect(screen.getByText(/the assistant of Acme Silks/)).toBeInTheDocument();
    cleanup();
    h.fetchTenant.mockResolvedValue(tenant("admin"));
    render(await SettingsPage(settingsProps({ section: "assistant" })));
    expect(tabNames()).not.toContain("AI assistant");
    expect(document.querySelector('[data-settings="assistant"]')).toBeNull();
  });
  it("1: the Owner has the tab and the part says 'Not available yet' (no API yet)", async () => {
    vi.stubEnv("ASSISTANT_SCREENS", "1");
    render(await SettingsPage(settingsProps({ section: "assistant" })));
    expect(tabNames()).toContain("AI assistant");
    expect(screen.getByLabelText("AI assistant", { selector: "section" })).toHaveTextContent("Not available yet");
  });
  it("a school's screen has no dues, no discount and no order limit", async () => {
    vi.stubEnv("ASSISTANT_SCREENS", "mock");
    h.pack = { modules: ["programmes", "fees"] };
    render(await SettingsPage(settingsProps({ section: "assistant" })));
    expect(screen.queryByRole("switch", { name: "Talk about dues" })).toBeNull();
    expect(screen.queryByLabelText("Highest discount it may offer")).toBeNull();
    expect(screen.getByRole("switch", { name: "Book campus visits", hidden: true })).toBeInTheDocument(); // (it is in the Behaviour tab, which is hidden until chosen)
  });
});

describe("saving the assistant (the Owner only)", () => {
  const ok = { name: "Meera", voice: "female_clear", lang: "hi", autoSwitch: true, mixEnglish: false, style: "resp", speed: 0.95, may: { prices: true, visits: true, whatsapp: false, dues: true }, maxDiscount: 3, handover: { owner: true, upset: false, orderAbove: 20000 }, hours: { from: "10:00", to: "18:30", days: ["mon", "tue", "wed"] } };
  it("is refused with the flag off and for anyone who is not the Owner; nothing is stored", async () => {
    expect(await saveAssistantAction(TENANT, ok)).toEqual({ ok: false, error: "not_available" });
    vi.stubEnv("ASSISTANT_SCREENS", "mock");
    h.fetchTenant.mockResolvedValue(tenant("admin"));
    expect(await saveAssistantAction(TENANT, ok)).toEqual({ ok: false, error: "not_available" });
    expect(await saveAssistantAction("not-a-uuid", ok)).toEqual({ ok: false, error: "invalid" });
    expect(h.jar.size).toBe(0);
  });
  it("mock: the Owner saves a checked value; a value that is not in its shape is refused", async () => {
    vi.stubEnv("ASSISTANT_SCREENS", "mock");
    expect(await saveAssistantAction(TENANT, { ...ok, name: "<script>" })).toEqual({ ok: false, error: "invalid" });
    expect(h.jar.size).toBe(0);
    expect(await saveAssistantAction(TENANT, ok)).toEqual({ ok: true });
    expect(JSON.parse(h.jar.get(ASSISTANT_COOKIE)!)).toMatchObject({ name: "Meera", maxDiscount: 3 });
  });
  it("for a school it never keeps dues, a discount or an order limit", async () => {
    vi.stubEnv("ASSISTANT_SCREENS", "mock");
    h.pack = { modules: ["programmes"] };
    expect(await saveAssistantAction(TENANT, ok)).toEqual({ ok: true });
    const stored = JSON.parse(h.jar.get(ASSISTANT_COOKIE)!);
    expect([stored.may.dues, stored.maxDiscount, stored.handover.orderAbove]).toEqual([false, 0, null]);
  });
});

describe("correcting an outcome (the Owner or an Admin)", () => {
  it("is refused with the flag off; a Sales person or a Viewer cannot; the Owner can in mock mode", async () => {
    expect(await correctOutcomeAction(TENANT, "m1-0", "negative", "too_costly")).toEqual({ ok: false, error: "not_available" });
    vi.stubEnv("OUTCOME_SCREENS", "mock");
    for (const role of ["sales", "viewer"]) {
      h.fetchTenant.mockResolvedValue(tenant(role));
      expect(await correctOutcomeAction(TENANT, "m1-0", "negative", "too_costly"), role).toEqual({ ok: false, error: "not_available" });
    }
    expect(h.jar.size).toBe(0);
    h.fetchTenant.mockResolvedValue(tenant("owner"));
    expect(await correctOutcomeAction(TENANT, "m1-0", "negative", "too_costly")).toEqual({ ok: true });
    h.fetchTenant.mockResolvedValue(tenant("admin"));
    expect(await correctOutcomeAction(TENANT, "m2-1", "unclear", "call_back_later")).toEqual({ ok: true });
    expect(Object.keys(JSON.parse(h.jar.get(OUTCOME_COOKIE)!)).sort()).toEqual(["m1-0", "m2-1"]);
  });
  it("a correction that does not make sense is refused", async () => {
    vi.stubEnv("OUTCOME_SCREENS", "mock");
    expect(await correctOutcomeAction(TENANT, "m1-0", "positive", "wrong_number")).toEqual({ ok: false, error: "invalid" });
  });
});
