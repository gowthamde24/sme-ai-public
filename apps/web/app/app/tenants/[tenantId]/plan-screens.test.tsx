import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiRequestError } from "@/lib/api/client";
import { parseMembers } from "@/lib/api/orders";
import { MEMBERS_JSON, TENANT } from "@/lib/api/orders-fixtures";
import { notFoundMock, redirectMock } from "@/test/helpers";

const h = vi.hoisted(() => ({ requireUser: vi.fn(), fetchTenant: vi.fn(), jar: new Map<string, string>(), sets: [] as unknown[] }));
vi.mock("next/navigation", () => ({ redirect: (to: string) => redirectMock(to), notFound: () => notFoundMock(), useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (k: string) => (h.jar.has(k) ? { name: k, value: h.jar.get(k) } : undefined),
    set: (k: string, v: string, o: unknown) => {
      h.jar.set(k, v);
      h.sets.push(o);
    },
  }),
}));
vi.mock("@/lib/auth/session", () => ({ requireUser: () => h.requireUser() }));
vi.mock("@/lib/api/client", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/api/client")>()), fetchTenant: (...a: unknown[]) => h.fetchTenant(...a) }));
vi.mock("@/lib/api/orders", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/api/orders")>()), fetchMembers: async () => parseMembers(MEMBERS_JSON) }));
vi.mock("@/lib/api/plan", () => ({ getPlan: async () => ({ plan: "free_trial", workspace_limit: 1, trial_started_at: "2026-10-09T10:00:00Z" }) }));
vi.mock("@/lib/api/ai-usage", () => ({ getAiUsage: async () => ({ today_percent: 7, month_percent: 3, resets_at_today: "2026-10-10T18:30:00Z", resets_at_month: "2026-10-31T18:30:00Z", state: "ok" }) }));
vi.mock("@/lib/api/gstin", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/api/gstin")>()), getBusinessProfile: async () => ({ gstin: null, state: null }) }));

import { MOCK_COOKIE } from "@/lib/plan/mock";

import PlansPage from "./plans/page";
import { cancelPlanAction, endPlanTrialAction, fixPlanPaymentAction, startPlanAction } from "./plan-actions";
import SettingsPage from "./settings/page";

const settingsProps = (query: Record<string, string> = {}) => ({ params: Promise.resolve({ tenantId: TENANT }), searchParams: Promise.resolve(query) }) as unknown as Parameters<typeof SettingsPage>[0];
const plansProps = () => ({ params: Promise.resolve({ tenantId: TENANT }) }) as unknown as Parameters<typeof PlansPage>[0];
const tenant = (role: string) => ({ id: TENANT, name: "Acme Silks", slug: "acme-silks", role });
const tabNames = () => within(screen.getByRole("navigation", { name: "Parts of Settings" })).getAllByRole("link").map((a) => a.textContent);

beforeEach(() => {
  h.jar.clear();
  h.sets.length = 0;
  h.requireUser.mockResolvedValue({ id: "11111111-1111-4111-8111-111111111111", email: "e@example.test", accessToken: "tok", aal: "aal2", hasSecondFactor: true });
  h.fetchTenant.mockResolvedValue(tenant("owner"));
});
afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

describe("the flag is off by default", () => {
  it("Settings has no Plan part, and ?section=plan falls back to the business part", async () => {
    render(await SettingsPage(settingsProps({ section: "plan" })));
    expect(tabNames()).not.toContain("Plan");
    expect(within(screen.getByRole("navigation", { name: "Parts of Settings" })).getByRole("link", { name: "Business and plan" })).toHaveAttribute("aria-current", "page");
    expect(document.querySelector('[data-settings="plan"]')).toBeNull();
  });
  it("/plans is a 404", async () => {
    await expect(PlansPage(plansProps())).rejects.toThrow();
    expect(notFoundMock).toHaveBeenCalled();
  });
  it.each(["0", "", "yes", "true", "MOCK"])("%j is off too", async (v) => {
    vi.stubEnv("PLAN_SCREENS", v);
    render(await SettingsPage(settingsProps()));
    expect(tabNames()).not.toContain("Plan");
  });
  it("every move refuses with not_available and stores nothing", async () => {
    expect(await startPlanAction(TENANT, "growth", "test_ok")).toEqual({ ok: false, error: "not_available" });
    expect(await cancelPlanAction(TENANT)).toEqual({ ok: false, error: "not_available" });
    expect(await fixPlanPaymentAction(TENANT)).toEqual({ ok: false, error: "not_available" });
    expect(await endPlanTrialAction(TENANT)).toEqual({ ok: false, error: "not_available" });
    expect(h.jar.size).toBe(0);
  });
});

describe("the flag is '1' (on, but the plans API is not built yet)", () => {
  beforeEach(() => vi.stubEnv("PLAN_SCREENS", "1"));
  it("the Plan part says 'Not available yet' and offers nothing to do", async () => {
    render(await SettingsPage(settingsProps({ section: "plan" })));
    expect(tabNames()).toContain("Plan");
    const part = within(screen.getByRole("main"));
    expect(part.getByText("Not available yet")).toBeInTheDocument();
    expect(part.queryByRole("button", { name: /plan|trial|payment|cancel/i })).toBeNull();
  });
  it("the moves still refuse (no fake provider is involved)", async () => {
    expect(await startPlanAction(TENANT, "growth", "test_ok")).toEqual({ ok: false, error: "not_available" });
    expect(h.jar.size).toBe(0);
  });
});

describe("the flag is 'mock' (the fake provider)", () => {
  beforeEach(() => vi.stubEnv("PLAN_SCREENS", "mock"));
  it("shows the Plan part to an Owner and an Admin, not to anyone else", async () => {
    render(await SettingsPage(settingsProps()));
    expect(tabNames()).toContain("Plan");
    cleanup();
    h.fetchTenant.mockResolvedValue(tenant("admin"));
    render(await SettingsPage(settingsProps()));
    expect(tabNames()).toContain("Plan");
    for (const role of ["member", "viewer"]) {
      cleanup();
      h.fetchTenant.mockResolvedValue(tenant(role));
      render(await SettingsPage(settingsProps({ section: "plan" })));
      expect(tabNames()).not.toContain("Plan");
      expect(document.querySelector('[data-settings="plan"]')).toBeNull();
    }
  });
  it("the whole walk: start the trial with a payment method, go to day 30 with a card that fails, update the payment, cancel", async () => {
    expect(await startPlanAction(TENANT, "growth", "")).toEqual({ ok: false, error: "no_payment_method" });
    expect(await startPlanAction(TENANT, "gold", "test_ok")).toEqual({ ok: false, error: "invalid" });
    expect(await startPlanAction(TENANT, "growth", "test_fails")).toEqual({ ok: true });
    expect(await startPlanAction(TENANT, "growth", "test_ok")).toEqual({ ok: false, error: "already" });
    render(await SettingsPage(settingsProps({ section: "plan" })));
    expect(screen.getByText("Plan: Growth")).toBeInTheDocument();
    expect(screen.getByText("30 days left")).toBeInTheDocument();
    cleanup();
    expect(await endPlanTrialAction(TENANT)).toEqual({ ok: true });
    render(await SettingsPage(settingsProps({ section: "plan" })));
    expect(screen.getByText("Your last payment did not go through")).toBeInTheDocument();
    cleanup();
    expect(await fixPlanPaymentAction(TENANT)).toEqual({ ok: true });
    expect(await fixPlanPaymentAction(TENANT)).toEqual({ ok: false, error: "invalid" });
    expect(await cancelPlanAction(TENANT)).toEqual({ ok: true });
    render(await SettingsPage(settingsProps({ section: "plan" })));
    expect(screen.getByText("Your plan was cancelled.")).toBeInTheDocument();
  });
  it("cancelling inside the trial says nothing was charged", async () => {
    await startPlanAction(TENANT, "starter", "test_ok");
    await cancelPlanAction(TENANT);
    render(await SettingsPage(settingsProps({ section: "plan" })));
    expect(screen.getByText("Your trial was cancelled. Nothing was charged.")).toBeInTheDocument();
  });
  it("the cookie is private to the browser: httpOnly, same-site, no card detail", async () => {
    await startPlanAction(TENANT, "growth", "test_ok");
    expect(h.sets[0]).toMatchObject({ httpOnly: true, sameSite: "lax", path: "/" });
    expect(h.jar.get(MOCK_COOKIE)).toMatch(/^trialing;growth;test_ok;1;0;0;0$/);
  });
  it("a hostile cookie is read as a fresh workspace", async () => {
    h.jar.set(MOCK_COOKIE, "active;<img src=x>;test_ok;9999;-5;NaN;1");
    render(await SettingsPage(settingsProps({ section: "plan" })));
    expect(screen.getByText("No plan yet")).toBeInTheDocument();
    expect(document.body.innerHTML).not.toContain("<img src=x>");
  });
  it("a member and a viewer cannot move the plan", async () => {
    for (const role of ["member", "viewer"]) {
      h.fetchTenant.mockResolvedValue(tenant(role));
      expect(await startPlanAction(TENANT, "growth", "test_ok")).toEqual({ ok: false, error: "forbidden" });
    }
    expect(h.jar.size).toBe(0);
  });
  it("a workspace id that is not one is refused before anything is asked", async () => {
    expect(await startPlanAction("x", "growth", "test_ok")).toEqual({ ok: false, error: "invalid" });
    expect(h.fetchTenant).not.toHaveBeenCalled();
  });
  it("a workspace that cannot be read is 'not available', not a guess", async () => {
    h.fetchTenant.mockRejectedValue(new ApiRequestError(503, "api_unreachable", "x"));
    expect(await startPlanAction(TENANT, "growth", "test_ok")).toEqual({ ok: false, error: "not_available" });
  });
  it("/plans: the six plans for an Owner (with the start form), a 404 for a member", async () => {
    render(await PlansPage(plansProps()));
    expect(screen.getAllByRole("heading", { level: 3 }).map((x) => x.textContent)).toEqual(["Starter", "Growth", "Business", "Pay-as-you-go", "Calls 300", "Calls 1,000"]);
    expect(screen.getAllByText("Price coming soon")).toHaveLength(6);
    expect(screen.getByRole("radio", { name: "Test card that fails on renewal" })).toBeInTheDocument();
    cleanup();
    h.fetchTenant.mockResolvedValue(tenant("member"));
    await expect(PlansPage(plansProps())).rejects.toThrow();
  });
  it("/plans for a business that already has a plan: its plan marked, no way to start another", async () => {
    await startPlanAction(TENANT, "business", "test_ok");
    render(await PlansPage(plansProps()));
    expect(within(document.querySelector('[data-plan="business"]') as HTMLElement).getByText("Your plan")).toBeInTheDocument();
    expect(screen.queryByRole("radio")).toBeNull();
  });
});
