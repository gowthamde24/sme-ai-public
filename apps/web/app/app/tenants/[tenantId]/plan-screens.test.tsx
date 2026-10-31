import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiRequestError } from "@/lib/api/client";
import { parseMembers } from "@/lib/api/orders";
import { MEMBERS_JSON, TENANT } from "@/lib/api/orders-fixtures";
import { notFoundMock, redirectMock } from "@/test/helpers";

const h = vi.hoisted(() => ({ requireUser: vi.fn(), fetchTenant: vi.fn(), api: vi.fn(), jar: new Map<string, string>(), sets: [] as unknown[] }));
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
vi.mock("@/lib/api/client", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/api/client")>()), fetchTenant: (...a: unknown[]) => h.fetchTenant(...a), apiRequest: (...a: unknown[]) => h.api(...a) }));
vi.mock("@/lib/api/orders", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/api/orders")>()), fetchMembers: async () => parseMembers(MEMBERS_JSON) }));
vi.mock("@/lib/api/plan", () => ({ getPlan: async () => ({ plan: "free_trial", workspace_limit: 1, trial_started_at: "2026-10-09T10:00:00Z" }) }));
vi.mock("@/lib/api/ai-usage", () => ({ getAiUsage: async () => ({ today_percent: 7, month_percent: 3, resets_at_today: "2026-10-10T18:30:00Z", resets_at_month: "2026-10-31T18:30:00Z", state: "ok" }) }));
vi.mock("@/lib/api/gstin", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/api/gstin")>()), getBusinessProfile: async () => ({ gstin: null, state: null }) }));

import { CATALOGUE, DRAFT_PLANS } from "@/lib/plan/catalogue";
import { MOCK_COOKIE } from "@/lib/plan/mock";

import PlansPage from "./plans/page";
import { cancelPlanAction, endPlanTrialAction, fixPlanPaymentAction, resumePlanAction, startPlanAction } from "./plan-actions";
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
    expect(tabNames()).not.toContain("Plan & usage");
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
    expect(tabNames()).not.toContain("Plan & usage");
  });
  it("every move refuses with not_available and stores nothing", async () => {
    expect(await resumePlanAction(TENANT, "growth", "test_ok")).toEqual({ ok: false, error: "not_available" });
    expect(await startPlanAction(TENANT, "growth", "test_ok")).toEqual({ ok: false, error: "not_available" });
    expect(await cancelPlanAction(TENANT)).toEqual({ ok: false, error: "not_available" });
    expect(await fixPlanPaymentAction(TENANT)).toEqual({ ok: false, error: "not_available" });
    expect(await endPlanTrialAction(TENANT)).toEqual({ ok: false, error: "not_available" });
    expect(h.jar.size).toBe(0);
  });
});

const meter = (kind: string, used: number, allowance: number | null, over: Record<string, unknown> = {}) => ({ kind, unit: kind === "call_minutes" ? "minutes" : "messages", used, allowance, remaining: null, percent: null, state: "ok", included: true, topup: 0, ...over });
const billingBody = (over: Record<string, unknown> = {}) => ({
  plan: DRAFT_PLANS.plans[0],
  subscription: null,
  period: { start: "2026-10-01", end: "2026-10-30", timezone: "Asia/Kolkata", days_left: 5 },
  usage: { call_minutes: meter("call_minutes", 4.5, 30), whatsapp_messages: meter("whatsapp_messages", 12, 100) },
  notices: [],
  can_start_trial: true,
  access: "full",
  read_only_since: null,
  delete_on: null,
  data_days_left: null,
  ...over,
});
const subscription = (over: Record<string, unknown> = {}) => ({ status: "trialing", plan_id: "growth", provider: "fake", trial_ends_at: "2026-11-12T10:00:00Z", current_period_end: null, cancel_at_period_end: false, grace_until: null, payment_method_on_file: true, ...over });
const apiRoutes = (billing: unknown = billingBody()) =>
  h.api.mockImplementation(async (path: string) => {
    if (path === "/v1/plans") return DRAFT_PLANS;
    if (/\/billing(\/trial|\/cancel|\/resume)?$/.test(path)) return billing;
    throw new ApiRequestError(404, "not_found", "x");
  });

describe("the flag is '1' (on: the plans and billing API of job DI)", () => {
  beforeEach(() => {
    vi.stubEnv("PLAN_SCREENS", "1");
    h.api.mockReset();
    apiRoutes();
  });
  it("the Plan part reads the billing answer: no plan yet, the trial's allowances, and the way to start the trial", async () => {
    render(await SettingsPage(settingsProps({ section: "plan" })));
    expect(tabNames()).toContain("Plan & usage");
    expect(h.api).toHaveBeenCalledWith(`/v1/tenants/${TENANT}/billing`, "tok");
    const part = within(screen.getByRole("main"));
    expect(part.getByText("No plan yet")).toBeInTheDocument();
    expect(within(document.querySelector('[data-meter="minutes"]') as HTMLElement).getByText("4.5 of 30")).toBeInTheDocument();
    expect(part.getByRole("link", { name: `Start ${CATALOGUE.trial.days}-day trial` })).toBeInTheDocument();
    expect(part.queryByRole("button", { name: /jump to the last day|Update payment/ })).toBeNull();
    expect(document.body.textContent).not.toMatch(/₹|\btokens?\b/i);
  });
  it("a trial at 83 percent: the plan chosen, the days left, the gentle notice", async () => {
    apiRoutes(billingBody({ subscription: subscription(), can_start_trial: false, usage: { call_minutes: meter("call_minutes", 25, 30, { percent: 83, state: "notice" }), whatsapp_messages: meter("whatsapp_messages", 83, 100, { percent: 83, state: "notice" }) } }));
    render(await SettingsPage(settingsProps({ section: "plan" })));
    expect(screen.getByText("Plan: Growth")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("You have used 83%");
    expect(screen.queryByRole("link", { name: `Start ${CATALOGUE.trial.days}-day trial` })).toBeNull();
  });
  it("read-only (the trial ended unpaid): the Plan part says so with the API's dates, the contact is the billing address from lib/site/business, and no move is offered", async () => {
    apiRoutes(billingBody({ subscription: subscription({ status: "cancelled", payment_method_on_file: false }), can_start_trial: false, access: "read_only", read_only_since: "2026-10-14", delete_on: "2027-01-12", data_days_left: 79 }));
    render(await SettingsPage(settingsProps({ section: "plan" })));
    const box = within(document.querySelector("[data-readonly]") as HTMLElement);
    expect(box.getByText("Your workspace is read-only")).toBeInTheDocument();
    expect(box.getByText("Read-only since 14 Oct 2026.")).toBeInTheDocument();
    expect(box.getByText("Your data is kept until 12 Jan 2027 and then deleted. Days left: 79.")).toBeInTheDocument();
    expect(box.getByText("To go on, write to billing@stack19.com.")).toBeInTheDocument();
    expect(within(screen.getByRole("main")).queryByRole("link", { name: new RegExp(`Choose a plan|Change plan|Start ${CATALOGUE.trial.days}-day trial`) })).toBeNull();
    expect(screen.queryByRole("button", { name: /cancel/i })).toBeNull();
  });
  it("the API cannot be reached: the Plan part says 'Not available yet', and /plans too, never a guess", async () => {
    h.api.mockRejectedValue(new ApiRequestError(503, "api_unreachable", "x"));
    render(await SettingsPage(settingsProps({ section: "plan" })));
    expect(within(screen.getByRole("main")).getByText("Not available yet")).toBeInTheDocument();
    cleanup();
    render(await PlansPage(plansProps()));
    expect(screen.getByText("Not available yet")).toBeInTheDocument();
  });
  it("an answer that is not the contracted shape is not drawn", async () => {
    apiRoutes({ nonsense: true });
    render(await SettingsPage(settingsProps({ section: "plan" })));
    expect(within(screen.getByRole("main")).getByText("Not available yet")).toBeInTheDocument();
  });
  it("starting the trial posts the plan and the checkout reference of the fake provider, and nothing else", async () => {
    expect(await startPlanAction(TENANT, "growth", "test_ok")).toEqual({ ok: true });
    expect(h.api).toHaveBeenCalledWith(`/v1/tenants/${TENANT}/billing/trial`, "tok", { method: "POST", body: JSON.stringify({ plan_id: "growth", checkout_ref: "pm_fake_ok" }) });
    expect(await startPlanAction(TENANT, "growth", "test_declined")).toEqual({ ok: true });
    expect(h.api).toHaveBeenLastCalledWith(`/v1/tenants/${TENANT}/billing/trial`, "tok", { method: "POST", body: JSON.stringify({ plan_id: "growth", checkout_ref: "pm_fake_declined" }) });
    expect(await startPlanAction(TENANT, "growth", "")).toEqual({ ok: false, error: "no_payment_method" });
    expect(h.jar.size).toBe(0); // the cookie of the fake provider is not touched
  });
  it.each([
    ["payment_method_declined", 402, "declined"],
    ["trial_already_started", 409, "already"],
    ["plan_unknown", 422, "invalid"],
    ["forbidden", 403, "forbidden"],
    ["workspace_read_only", 403, "read_only"],
    ["api_unreachable", 503, "not_available"],
    ["something_else", 500, "invalid"],
  ])("the API's %s (HTTP %i) is our sentence %s", async (code, status, error) => {
    h.api.mockRejectedValue(new ApiRequestError(status, code, "x"));
    expect(await startPlanAction(TENANT, "growth", "test_ok")).toEqual({ ok: false, error });
  });
  it("a lapsed plan is paid for again (job DP): /plans says there is no new trial and offers the choice, and the move posts to resume with the same references", async () => {
    apiRoutes(billingBody({ subscription: subscription({ status: "cancelled" }), can_start_trial: false, can_resume: true, access: "read_only", read_only_since: "2026-10-14", delete_on: "2027-01-12", data_days_left: 79 }));
    render(await PlansPage(plansProps()));
    expect(screen.getAllByText(/there is no new trial/).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("radio").length).toBeGreaterThan(0);
    expect(screen.queryByText("The free trial can be started only once for a workspace.")).toBeNull();
    expect(await resumePlanAction(TENANT, "growth", "test_ok")).toEqual({ ok: true });
    expect(h.api).toHaveBeenCalledWith(`/v1/tenants/${TENANT}/billing/resume`, "tok", { method: "POST", body: JSON.stringify({ plan_id: "growth", checkout_ref: "pm_fake_ok" }) });
    expect(await resumePlanAction(TENANT, "growth", "")).toEqual({ ok: false, error: "no_payment_method" });
    h.api.mockRejectedValue(new ApiRequestError(409, "not_lapsed", "x"));
    expect(await resumePlanAction(TENANT, "growth", "test_ok")).toEqual({ ok: false, error: "invalid" });
    h.fetchTenant.mockResolvedValue(tenant("admin"));
    expect(await resumePlanAction(TENANT, "growth", "test_ok")).toEqual({ ok: false, error: "forbidden" });
  });
  it("cancelling posts to the API; the two moves the API has no endpoint for refuse", async () => {
    expect(await cancelPlanAction(TENANT)).toEqual({ ok: true });
    expect(h.api).toHaveBeenCalledWith(`/v1/tenants/${TENANT}/billing/cancel`, "tok", { method: "POST", body: JSON.stringify({}) });
    expect(await fixPlanPaymentAction(TENANT)).toEqual({ ok: false, error: "not_available" });
    expect(await endPlanTrialAction(TENANT)).toEqual({ ok: false, error: "not_available" });
  });
  it("an Admin sees the plan and the meters but no move, and the API is not asked to change anything", async () => {
    h.fetchTenant.mockResolvedValue(tenant("admin"));
    render(await SettingsPage(settingsProps({ section: "plan" })));
    expect(screen.getByText("No plan yet")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: `Start ${CATALOGUE.trial.days}-day trial` })).toBeNull();
    h.api.mockClear();
    expect(await startPlanAction(TENANT, "growth", "test_ok")).toEqual({ ok: false, error: "forbidden" });
    expect(h.api).not.toHaveBeenCalled();
  });
  it("/plans: the catalogue from the API, a workspace that has had a trial cannot start another", async () => {
    render(await PlansPage(plansProps()));
    expect(screen.getAllByRole("heading", { level: 3 }).map((x) => x.textContent)).toEqual(["Starter", "Growth", "Business", "Pay as you go", "Lead Desk 300", "Lead Desk 1,000"]);
    cleanup();
    apiRoutes(billingBody({ subscription: subscription({ status: "cancelled" }), can_start_trial: false }));
    render(await PlansPage(plansProps()));
    expect(screen.getByText("The free trial can be started only once for a workspace.")).toBeInTheDocument();
    expect(screen.queryByRole("radio")).toBeNull();
  });
});

describe("the flag is 'mock' (the fake provider)", () => {
  beforeEach(() => vi.stubEnv("PLAN_SCREENS", "mock"));
  it("shows the Plan part to an Owner and an Admin, not to anyone else", async () => {
    render(await SettingsPage(settingsProps()));
    expect(tabNames()).toContain("Plan & usage");
    cleanup();
    h.fetchTenant.mockResolvedValue(tenant("admin"));
    render(await SettingsPage(settingsProps()));
    expect(tabNames()).toContain("Plan & usage");
    for (const role of ["member", "viewer"]) {
      cleanup();
      h.fetchTenant.mockResolvedValue(tenant(role));
      render(await SettingsPage(settingsProps({ section: "plan" })));
      expect(tabNames()).not.toContain("Plan & usage");
      expect(document.querySelector('[data-settings="plan"]')).toBeNull();
    }
  });
  it("the whole walk: start the trial with a payment method, go to the last day with a card that fails, update the payment, cancel", async () => {
    expect(await startPlanAction(TENANT, "growth", "")).toEqual({ ok: false, error: "no_payment_method" });
    expect(await startPlanAction(TENANT, "gold", "test_ok")).toEqual({ ok: false, error: "invalid" });
    expect(await startPlanAction(TENANT, "growth", "test_fails")).toEqual({ ok: true });
    expect(await startPlanAction(TENANT, "growth", "test_ok")).toEqual({ ok: false, error: "already" });
    render(await SettingsPage(settingsProps({ section: "plan" })));
    expect(screen.getByText("Plan: Growth")).toBeInTheDocument();
    expect(screen.getByText(`${CATALOGUE.trial.days} days left`)).toBeInTheDocument();
    cleanup();
    expect(await endPlanTrialAction(TENANT)).toEqual({ ok: true });
    render(await SettingsPage(settingsProps({ section: "plan" })));
    expect(screen.getByText("Your last payment did not go through")).toBeInTheDocument();
    cleanup();
    expect(await fixPlanPaymentAction(TENANT)).toEqual({ ok: true });
    expect(await fixPlanPaymentAction(TENANT)).toEqual({ ok: false, error: "invalid" });
    expect(await cancelPlanAction(TENANT)).toEqual({ ok: true });
    render(await SettingsPage(settingsProps({ section: "plan" })));
    expect(screen.getByText(/Your plan ends on .*\. It will not renew\./)).toBeInTheDocument(); // a paid plan runs to the end of its period
    cleanup();
    expect(await cancelPlanAction(TENANT)).toEqual({ ok: false, error: "invalid" });
    expect(await startPlanAction(TENANT, "growth", "test_ok")).toEqual({ ok: false, error: "already" });
  });
  it("a card refused at once starts no trial and leaves no plan", async () => {
    expect(await startPlanAction(TENANT, "growth", "test_declined")).toEqual({ ok: false, error: "declined" });
    expect(h.jar.size).toBe(0);
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
    expect(h.jar.get(MOCK_COOKIE)).toMatch(/^trialing;growth;test_ok;1;0;0;0;0$/);
  });
  it("a hostile cookie is read as a fresh workspace", async () => {
    h.jar.set(MOCK_COOKIE, "active;<img src=x>;test_ok;9999;-5;NaN;1");
    render(await SettingsPage(settingsProps({ section: "plan" })));
    expect(screen.getByText("No plan yet")).toBeInTheDocument();
    expect(document.body.innerHTML).not.toContain("<img src=x>");
  });
  it("an Admin, a member and a viewer cannot move the plan (the plan is the Owner's)", async () => {
    for (const role of ["admin", "member", "viewer"]) {
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
    expect(screen.getAllByRole("heading", { level: 3 }).map((x) => x.textContent)).toEqual(["Starter", "Growth", "Business", "Pay as you go", "Lead Desk 300", "Lead Desk 1,000"]);
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
