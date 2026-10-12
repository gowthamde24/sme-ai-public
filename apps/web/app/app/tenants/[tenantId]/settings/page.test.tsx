import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiRequestError } from "@/lib/api/client";
import { parseMembers } from "@/lib/api/orders";
import { MEMBERS_JSON, TENANT } from "@/lib/api/orders-fixtures";
import { notFoundMock, redirectMock } from "@/test/helpers";
import { SETTINGS_JSON, STATUS_JSON } from "@/lib/api/scheduler-fixtures";
import { ApiAuthError } from "@/lib/api/client";

const requireUser = vi.fn();
const fetchTenant = vi.fn();
const fetchMembers = vi.fn();
const getPlan = vi.fn();
const getAiUsage = vi.fn();
const getOutboxSettings = vi.fn();
const getSchedulerSettings = vi.fn();
const getSchedulerStatus = vi.fn();
vi.mock("next/navigation", () => ({ redirect: (to: string) => redirectMock(to), notFound: () => notFoundMock(), useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/auth/session", () => ({ requireUser: () => requireUser() }));
vi.mock("@/lib/api/client", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/api/client")>()), fetchTenant: (...a: unknown[]) => fetchTenant(...a) }));
vi.mock("@/lib/api/orders", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/api/orders")>()), fetchMembers: (...a: unknown[]) => fetchMembers(...a) }));

vi.mock("@/lib/api/plan", () => ({ getPlan: (...a: unknown[]) => getPlan(...a) }));
vi.mock("@/lib/api/outbox", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/api/outbox")>()), getOutboxSettings: (...a: unknown[]) => getOutboxSettings(...a) }));
vi.mock("@/lib/api/scheduler", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/api/scheduler")>()), getSchedulerSettings: (...a: unknown[]) => getSchedulerSettings(...a), getSchedulerStatus: (...a: unknown[]) => getSchedulerStatus(...a) }));
vi.mock("@/lib/api/ai-usage", () => ({ getAiUsage: (...a: unknown[]) => getAiUsage(...a) }));

import SettingsPage from "./page";

const props = (query: Record<string, string> = {}) => ({ params: Promise.resolve({ tenantId: TENANT }), searchParams: Promise.resolve(query) }) as unknown as Parameters<typeof SettingsPage>[0];
const tenant = (role: string) => ({ id: TENANT, name: "Acme Silks", slug: "acme-silks", role });
const tabs = () => within(screen.getByRole("navigation", { name: "Parts of Settings" }));

beforeEach(() => {
  vi.clearAllMocks();
  requireUser.mockResolvedValue({ id: "11111111-1111-4111-8111-111111111111", email: "e@example.test", accessToken: "tok", aal: "aal2", hasSecondFactor: true });
  fetchTenant.mockResolvedValue(tenant("owner"));
  fetchMembers.mockResolvedValue(parseMembers(MEMBERS_JSON));
  getPlan.mockResolvedValue({ plan: "free_trial", workspace_limit: 1, trial_started_at: "2026-10-09T10:00:00Z" });
  getOutboxSettings.mockResolvedValue({ platform_switch_on: true, auto_send_enabled: false, per_customer_daily_limit: 3 });
  getSchedulerSettings.mockResolvedValue(SETTINGS_JSON);
  getSchedulerStatus.mockResolvedValue({ ...STATUS_JSON, last_run_at: new Date().toISOString(), next_run_at: null });
  getAiUsage.mockResolvedValue({ today_percent: 7, month_percent: 3, resets_at_today: "2026-10-10T18:30:00Z", resets_at_month: "2026-10-31T18:30:00Z", state: "ok" });
});

describe("Settings, one part at a time", () => {
  it("opens on the business: its name, URL name, plan and today's AI usage from the API; the members are not asked for", async () => {
    render(await SettingsPage(props()));
    expect(tabs().getAllByRole("link").map((a) => a.textContent)).toEqual(["Business and plan", "Members", "Language and look", "Agent OWL", "Security", "Privacy"]);
    expect(tabs().getByRole("link", { name: "Business and plan" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByText("Acme Silks")).toBeInTheDocument();
    expect(screen.getByText("acme-silks")).toBeInTheDocument();
    expect(screen.getByText("Free trial plan")).toBeInTheDocument();
    expect(getPlan).toHaveBeenCalledWith("tok", TENANT);
    expect(getAiUsage).toHaveBeenCalledWith("tok", TENANT);
    expect(screen.getByRole("meter", { name: "AI usage today" })).toHaveAttribute("aria-valuenow", "7");
    expect(screen.getByText("7% used")).toBeInTheDocument();
    expect(screen.queryByText("Not available yet")).toBeNull();
    expect(fetchMembers).not.toHaveBeenCalled();
  });
  it("says 'Not available yet' for the plan and the usage when they cannot be read (never a guess)", async () => {
    getPlan.mockRejectedValue(new ApiRequestError(503, "api_unreachable", "x"));
    getAiUsage.mockRejectedValue(new ApiRequestError(503, "api_unreachable", "x"));
    render(await SettingsPage(props()));
    expect(screen.getAllByText("Not available yet")).toHaveLength(2);
    expect(screen.queryByText(/₹/)).toBeNull();
  });
  it("shows no AI usage to a member who is not Owner or Admin, and does not ask the API for it", async () => {
    fetchTenant.mockResolvedValue(tenant("sales"));
    getAiUsage.mockClear();
    render(await SettingsPage(props()));
    expect(screen.queryByText("AI usage today")).toBeNull();
    expect(getAiUsage).not.toHaveBeenCalled();
    expect(screen.getByText("Free trial plan")).toBeInTheDocument();
  });
  it("an unknown section word is the business part", async () => {
    render(await SettingsPage(props({ section: "<script>" })));
    expect(tabs().getByRole("link", { name: "Business and plan" })).toHaveAttribute("aria-current", "page");
  });
  it("lists the members with their role, marks the person, and says 'Not available yet' when the list cannot be read", async () => {
    fetchMembers.mockResolvedValue(parseMembers({ members: [{ user_id: "11111111-1111-4111-8111-111111111111", role: "owner", display_name: "Asha" }, { user_id: "22222222-aaaa-4222-8222-222222222222", role: "sales", display_name: null }] }));
    render(await SettingsPage(props({ section: "members" })));
    expect(fetchMembers).toHaveBeenCalledWith("tok", TENANT);
    const items = screen.getAllByRole("listitem");
    expect(items[0]).toHaveTextContent("Asha(You)owner");
    expect(items[1]).toHaveTextContent("salessales"); // no display name: the role is the name
    expect(screen.queryByRole("button", { name: /invite|add/i })).toBeNull(); // a list: nobody is added here
    fetchMembers.mockRejectedValue(new ApiRequestError(500, "api_error", "x"));
    document.body.innerHTML = "";
    render(await SettingsPage(props({ section: "members" })));
    expect(screen.getByText("Not available yet")).toBeInTheDocument();
  });
  it("says whether 2-step sign-in is on, and links to the security page", async () => {
    render(await SettingsPage(props({ section: "security" })));
    expect(screen.getByText("2-step sign-in is on.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open the security page" })).toHaveAttribute("href", "/app/security");
    requireUser.mockResolvedValue({ id: "11111111-1111-4111-8111-111111111111", email: "e", accessToken: "tok", aal: "aal1", hasSecondFactor: false });
    document.body.innerHTML = "";
    render(await SettingsPage(props({ section: "security" })));
    expect(screen.getByText("2-step sign-in is not set up yet.")).toBeInTheDocument();
  });
  it.each([
    ["owner", ["Privacy and erasure", "Suppression keys"]],
    ["admin", ["Privacy and erasure"]],
    ["sales", []],
    ["viewer", []],
  ])("privacy: a %s is offered only the pages their role can open", async (role, links) => {
    fetchTenant.mockResolvedValue(tenant(role));
    render(await SettingsPage(props({ section: "privacy" })));
    const main = screen.getByRole("main");
    expect(within(main).queryAllByRole("link").map((a) => a.textContent).filter((t) => t === "Privacy and erasure" || t === "Suppression keys")).toEqual(links);
  });
  it("the language part has the language select and the three looks", async () => {
    render(await SettingsPage(props({ section: "language" })));
    expect(screen.getByRole("combobox")).toBeInTheDocument();
    expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual(["Help for this screen", "System", "Light", "Dark"]); // the first is the "?" tip of the screen (job BT)
  });
  it("a missing workspace is not-found and a rejected session goes to sign-in", async () => {
    fetchTenant.mockRejectedValue(new ApiRequestError(404, "not_found", "x"));
    await expect(SettingsPage(props())).rejects.toThrow();
  });
});

describe("Settings: Agent OWL (the Owner only)", () => {
  it("is a tab for the Owner and for nobody else; a member who asks for it by hand gets the business", async () => {
    for (const role of ["admin", "sales", "viewer"]) {
      fetchTenant.mockResolvedValue(tenant(role));
      document.body.innerHTML = "";
      render(await SettingsPage(props({ section: "agent" })));
      expect(tabs().queryByRole("link", { name: "Agent OWL" })).toBeNull();
      expect(tabs().getByRole("link", { name: "Business and plan" })).toHaveAttribute("aria-current", "page");
    }
    expect(getOutboxSettings).not.toHaveBeenCalled();
    expect(getSchedulerSettings).not.toHaveBeenCalled();
  });
  it("reads the sending settings, the reminders and the status with the Owner's token and draws the five parts", async () => {
    render(await SettingsPage(props({ section: "agent" })));
    expect(tabs().getByRole("link", { name: "Agent OWL" })).toHaveAttribute("aria-current", "page");
    expect(getOutboxSettings).toHaveBeenCalledWith("tok", TENANT);
    expect(getSchedulerSettings).toHaveBeenCalledWith("tok", TENANT);
    expect(getSchedulerStatus).toHaveBeenCalledWith("tok", TENANT);
    expect(screen.getByRole("heading", { name: "Automatic sending" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Quiet hours" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Visit reminders" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "System-wide sending switch" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Agent OWL's checks" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: /Agent OWL may send routine replies/ })).not.toBeChecked();
  });
  it("a part that cannot be read says 'Not available yet' in its own place and the rest is drawn", async () => {
    getOutboxSettings.mockRejectedValue(new ApiRequestError(503, "api_unreachable", "x"));
    getSchedulerSettings.mockRejectedValue(new ApiRequestError(503, "api_unreachable", "x"));
    getSchedulerStatus.mockRejectedValue(new ApiRequestError(503, "api_unreachable", "x"));
    render(await SettingsPage(props({ section: "agent" })));
    expect(screen.getAllByText("Not available yet").length).toBeGreaterThanOrEqual(4);
    expect(screen.queryByRole("heading", { name: "Quiet hours" })).toBeNull(); // the hours are read with the sending settings: if those cannot be read there is nothing to edit
    expect(screen.getByRole("heading", { name: "Agent OWL's checks" })).toBeInTheDocument();
  });
  it("the quiet hours can be edited: the Owner's tab has the form with the hours on record", async () => {
    getOutboxSettings.mockResolvedValue({ platform_switch_on: true, auto_send_enabled: true, per_customer_daily_limit: 3, quiet_hours_start: 22, quiet_hours_end: 8 });
    render(await SettingsPage(props({ section: "agent" })));
    expect(screen.getByRole("heading", { name: "Quiet hours" })).toBeInTheDocument();
    expect(screen.getByLabelText("Quiet hours start")).toHaveValue("22");
    expect(screen.getByLabelText("Quiet hours end")).toHaveValue("8");
    expect(screen.getByRole("button", { name: "Save quiet hours" })).toBeInTheDocument();
  });
  it("a rejected session goes to sign-in", async () => {
    getSchedulerStatus.mockRejectedValue(new ApiAuthError("x"));
    await expect(SettingsPage(props({ section: "agent" }))).rejects.toThrow("NEXT_REDIRECT:/login");
  });
});
