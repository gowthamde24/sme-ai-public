import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TENANT, MEMBERS_JSON } from "@/lib/api/orders-fixtures";
import { parseMembers } from "@/lib/api/orders";
import { notFoundMock, redirectMock } from "@/test/helpers";

const h = vi.hoisted(() => ({ requireUser: vi.fn(), fetchTenant: vi.fn(), jar: new Map<string, string>() }));
vi.mock("next/navigation", () => ({ redirect: (to: string) => redirectMock(to), notFound: () => notFoundMock(), useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: (k: string) => (h.jar.has(k) ? { name: k, value: h.jar.get(k) } : undefined), set: (k: string, v: string) => void h.jar.set(k, v) }) }));
vi.mock("@/lib/auth/session", () => ({ requireUser: () => h.requireUser() }));
vi.mock("@/lib/api/client", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/api/client")>()), fetchTenant: (...a: unknown[]) => h.fetchTenant(...a) }));
vi.mock("@/lib/api/orders", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/api/orders")>()), fetchMembers: async () => parseMembers(MEMBERS_JSON) }));
vi.mock("@/lib/api/plan", () => ({ getPlan: async () => ({ plan: "free_trial", workspace_limit: 1, trial_started_at: "2026-10-09T10:00:00Z" }) }));
vi.mock("@/lib/api/ai-usage", () => ({ getAiUsage: async () => ({ today_percent: 7, month_percent: 3, resets_at_today: "2026-10-10T18:30:00Z", resets_at_month: "2026-10-31T18:30:00Z", state: "ok" }) }));
vi.mock("@/lib/api/gstin", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/api/gstin")>()), getBusinessProfile: async () => ({ gstin: null, state: null }) }));
vi.mock("@/lib/api/billing-access", () => ({ getBillingAccess: async () => ({ readOnly: false }) }));
vi.mock("@/components/v2/app/topups/LazyTopups", async () => ({ TopupControls: (await import("@/components/v2/app/topups/TopupControls")).TopupControls }));

import { MOCK_COOKIE } from "@/lib/topups/mock";

import { topupLayoutBanner } from "./topup-banner";
import { topupsToday } from "./topups-today";
import PlansPage from "./plans/page";
import SettingsPage from "./settings/page";

const settingsProps = (query: Record<string, string> = {}) => ({ params: Promise.resolve({ tenantId: TENANT }), searchParams: Promise.resolve(query) }) as unknown as Parameters<typeof SettingsPage>[0];
const plansProps = () => ({ params: Promise.resolve({ tenantId: TENANT }) }) as unknown as Parameters<typeof PlansPage>[0];
const tenant = (role: string) => ({ id: TENANT, name: "Acme Silks", slug: "acme-silks", role });
const tabNames = () => within(screen.getByRole("navigation", { name: "Parts of Settings" })).getAllByRole("link").map((a) => a.textContent);

beforeEach(() => {
  h.jar.clear();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-06T10:00:00+05:30"));
  h.requireUser.mockResolvedValue({ id: "11111111-1111-4111-8111-111111111111", email: "e@example.test", accessToken: "tok", aal: "aal2", hasSecondFactor: true });
  h.fetchTenant.mockResolvedValue(tenant("owner"));
});
afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("TOPUP_SCREENS off: nothing is there and nothing is read", () => {
  it("no Usage and top-ups part in Settings, no banner, no Today cards", async () => {
    vi.stubEnv("PLAN_SCREENS", "mock");
    render(await SettingsPage(settingsProps({ section: "plan" })));
    expect(document.querySelector('[data-settings="topups"]')).toBeNull();
    expect(document.querySelector('[data-meter="minutes"]')).not.toBeNull(); // the old bars stay
    expect(await topupLayoutBanner({ token: "tok", tenantId: TENANT, lang: "en" })).toBeNull();
    expect(await topupsToday({ token: "tok", tenantId: TENANT, lang: "en", owner: true })).toBeNull();
    expect(h.fetchTenant).toHaveBeenCalledTimes(1); // only Settings asked: the banner did not even look the person up
  });
});

describe("TOPUP_SCREENS=mock", () => {
  beforeEach(() => {
    vi.stubEnv("TOPUP_SCREENS", "mock");
    vi.stubEnv("PLAN_SCREENS", "mock");
  });
  it("Settings > Plan shows the new part and not the old bars twice", async () => {
    render(await SettingsPage(settingsProps({ section: "plan" })));
    expect(tabNames()).toContain("Plan & usage");
    expect(document.querySelector('[data-settings="topups"]')).not.toBeNull();
    expect(document.querySelector('[data-meter="minutes"]')).toBeNull();
    expect(document.querySelector('[data-meter="tu-minutes"]')).not.toBeNull();
    expect(screen.getByRole("button", { name: /^\+100 minutes/ })).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: /Top up by itself/ })).not.toBeChecked();
    expect(screen.getByText(/Test mode: no money is taken/)).toBeInTheDocument();
  });
  it("an Admin sees the numbers and the record but no buttons", async () => {
    h.fetchTenant.mockResolvedValue(tenant("admin"));
    render(await SettingsPage(settingsProps({ section: "plan" })));
    expect(document.querySelector('[data-meter="tu-minutes"]')).not.toBeNull();
    expect(screen.getByText("Only the owner can buy top-ups or change these settings.")).toBeInTheDocument();
    expect(document.querySelector("[data-pack]")).toBeNull();
  });
  it("with only TOPUP_SCREENS on (no plan screens) Settings still has the Plan part with just the usage", async () => {
    vi.stubEnv("PLAN_SCREENS", "");
    render(await SettingsPage(settingsProps({ section: "plan" })));
    expect(tabNames()).toContain("Plan & usage");
    expect(document.querySelector('[data-settings="topups"]')).not.toBeNull();
    expect(document.querySelector('[data-settings="plan"]')).toBeNull();
  });
  it("a member does not get the Plan part at all", async () => {
    h.fetchTenant.mockResolvedValue(tenant("sales"));
    render(await SettingsPage(settingsProps({ section: "plan" })));
    expect(tabNames()).not.toContain("Plan & usage");
    expect(document.querySelector('[data-settings="topups"]')).toBeNull();
  });
  it("the layout's banner: at 80 percent a status line for the Owner and the Admin, nothing for a member, nothing below 80 percent", async () => {
    render(<>{await topupLayoutBanner({ token: "tok", tenantId: TENANT, lang: "en" })}</>);
    expect(screen.getByRole("status")).toHaveTextContent("Your calls are at 80% of this month's minutes. At this pace they run out on 7 Oct.");
    cleanup();
    h.fetchTenant.mockResolvedValue(tenant("admin"));
    render(<>{await topupLayoutBanner({ token: "tok", tenantId: TENANT, lang: "en" })}</>);
    expect(screen.getByRole("link", { name: "See usage" })).toBeInTheDocument();
    cleanup();
    h.fetchTenant.mockResolvedValue(tenant("sales"));
    expect(await topupLayoutBanner({ token: "tok", tenantId: TENANT, lang: "en" })).toBeNull();
    h.fetchTenant.mockResolvedValue(tenant("owner"));
    h.jar.set(MOCK_COOKIE, JSON.stringify({ v: 1, ps: "2026-10-01", um: 100, ug: 10 }));
    expect(await topupLayoutBanner({ token: "tok", tenantId: TENANT, lang: "en" })).toBeNull();
    h.fetchTenant.mockRejectedValue(new Error("down"));
    expect(await topupLayoutBanner({ token: "tok", tenantId: TENANT, lang: "en" })).toBeNull();
  });
  it("Today: the 'Needs you' card at 80 percent, and at 100 percent the card and '12 leads waiting for calls · Top up'", async () => {
    render(<>{await topupsToday({ token: "tok", tenantId: TENANT, lang: "en", owner: true })}</>);
    expect(document.querySelector("[data-topup-needs='80']")).not.toBeNull();
    expect(document.querySelector("[data-topup-waiting]")).toBeNull();
    cleanup();
    h.jar.set(MOCK_COOKIE, JSON.stringify({ v: 1, ps: "2026-10-01", um: 300, ug: 10 }));
    render(<>{await topupsToday({ token: "tok", tenantId: TENANT, lang: "en", owner: true })}</>);
    expect(document.querySelector("[data-topup-needs='100']")).not.toBeNull();
    expect(screen.getByRole("heading", { name: "12 leads waiting for calls · Top up" })).toBeInTheDocument();
  });
  it("/plans: the waiting card above the plans, and the plans are the Lead Desk plans (workforce plans first)", async () => {
    h.jar.set(MOCK_COOKIE, JSON.stringify({ v: 1, ps: "2026-10-01", um: 300, ug: 10 }));
    render(await PlansPage(plansProps()));
    expect(screen.getByRole("heading", { name: "12 leads waiting for calls · Top up" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Lead Desk plans" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Workforce plans" })).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { level: 3 }).map((x) => x.textContent)).toEqual(["Starter", "Growth", "Business", "Pay as you go", "Lead Desk 300", "Lead Desk 1,000"]);
  });
});
