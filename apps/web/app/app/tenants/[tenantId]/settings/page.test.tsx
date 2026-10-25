import { cleanup, render, screen, within } from "@testing-library/react";
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
const getCalendarFeed = vi.fn();
const getExportFormats = vi.fn();
const listImportJobs = vi.fn();
const listMyExports = vi.fn();
const listMyDeletions = vi.fn();
const listWorkspaceDeletions = vi.fn();
const readConsentList = vi.fn();
const getBusinessProfile = vi.fn();
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
vi.mock("@/lib/api/data", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/api/data")>()), getCalendarFeed: (...a: unknown[]) => getCalendarFeed(...a), getExportFormats: (...a: unknown[]) => getExportFormats(...a), listImportJobs: (...a: unknown[]) => listImportJobs(...a) }));

vi.mock("@/lib/api/privacy", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/api/privacy")>()), listMyExports: (...a: unknown[]) => listMyExports(...a), listMyDeletions: (...a: unknown[]) => listMyDeletions(...a), listWorkspaceDeletions: (...a: unknown[]) => listWorkspaceDeletions(...a) }));
vi.mock("@/lib/api/consent-list", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/api/consent-list")>()), readConsentList: (...a: unknown[]) => readConsentList(...a) }));

vi.mock("@/lib/api/gstin", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/api/gstin")>()), getBusinessProfile: (...a: unknown[]) => getBusinessProfile(...a) }));

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
  getCalendarFeed.mockResolvedValue({ active: false, created_at: null, last_used_at: null });
  getExportFormats.mockResolvedValue(["tally_zip", "csv"]);
  listImportJobs.mockResolvedValue([]);
  getBusinessProfile.mockResolvedValue({ gstin: "27AAPFU0939F1ZV", state: "Maharashtra" });
  listMyExports.mockResolvedValue([]);
  listMyDeletions.mockResolvedValue([]);
  listWorkspaceDeletions.mockResolvedValue([]);
  readConsentList.mockResolvedValue({ checked: 0, truncated: false, stopped: [], counts: { whatsapp: { unknown: 0, granted: 0, withdrawn: 0 }, phone: { unknown: 0, granted: 0, withdrawn: 0 }, email: { unknown: 0, granted: 0, withdrawn: 0 } } });
  getAiUsage.mockResolvedValue({ today_percent: 7, month_percent: 3, resets_at_today: "2026-10-10T18:30:00Z", resets_at_month: "2026-10-31T18:30:00Z", state: "ok" });
});

describe("Settings, one part at a time", () => {
  it("opens on the business: its name, URL name, plan and today's AI usage from the API; the members are not asked for", async () => {
    render(await SettingsPage(props()));
    expect(tabs().getAllByRole("link").map((a) => a.textContent)).toEqual(["Business and plan", "Members", "Data", "Language and look", "Automation", "Security", "Privacy"]);
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

describe("Settings: Automation (the Owner only)", () => {
  it("is a tab for the Owner and for nobody else; a member who asks for it by hand gets the business", async () => {
    for (const role of ["admin", "sales", "viewer"]) {
      fetchTenant.mockResolvedValue(tenant(role));
      document.body.innerHTML = "";
      render(await SettingsPage(props({ section: "agent" })));
      expect(tabs().queryByRole("link", { name: "Automation" })).toBeNull();
      expect(tabs().getByRole("link", { name: "Business and plan" })).toHaveAttribute("aria-current", "page");
    }
    expect(getOutboxSettings).not.toHaveBeenCalled();
    expect(getSchedulerSettings).not.toHaveBeenCalled();
  });
  it("reads the sending settings, the reminders and the status with the Owner's token and draws the five parts", async () => {
    render(await SettingsPage(props({ section: "agent" })));
    expect(tabs().getByRole("link", { name: "Automation" })).toHaveAttribute("aria-current", "page");
    expect(getOutboxSettings).toHaveBeenCalledWith("tok", TENANT);
    expect(getSchedulerSettings).toHaveBeenCalledWith("tok", TENANT);
    expect(getSchedulerStatus).toHaveBeenCalledWith("tok", TENANT);
    expect(screen.getByRole("heading", { name: "Automatic sending" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Quiet hours" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Visit reminders" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "System-wide sending switch" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Vijaya's checks" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: /Vijaya may send routine replies/ })).not.toBeChecked();
  });
  it("a part that cannot be read says 'Not available yet' in its own place and the rest is drawn", async () => {
    getOutboxSettings.mockRejectedValue(new ApiRequestError(503, "api_unreachable", "x"));
    getSchedulerSettings.mockRejectedValue(new ApiRequestError(503, "api_unreachable", "x"));
    getSchedulerStatus.mockRejectedValue(new ApiRequestError(503, "api_unreachable", "x"));
    render(await SettingsPage(props({ section: "agent" })));
    expect(screen.getAllByText("Not available yet").length).toBeGreaterThanOrEqual(4);
    expect(screen.queryByRole("heading", { name: "Quiet hours" })).toBeNull(); // the hours are read with the sending settings: if those cannot be read there is nothing to edit
    expect(screen.getByRole("heading", { name: "Vijaya's checks" })).toBeInTheDocument();
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

describe("Settings > Data (job CC)", () => {
  it("an owner sees the import, the export and the calendar, each read on its own with the person's token", async () => {
    render(await SettingsPage(props({ section: "data" })));
    expect(tabs().getByRole("link", { name: "Data" })).toHaveAttribute("aria-current", "page");
    for (const name of ["Bring in a spreadsheet", "Send your books to your accountant", "Visits in your phone's calendar"]) expect(screen.getByRole("heading", { name })).toBeInTheDocument();
    expect(getExportFormats).toHaveBeenCalledWith("tok", TENANT);
    expect(listImportJobs).toHaveBeenCalledWith("tok", TENANT);
    expect(getCalendarFeed).toHaveBeenCalledWith("tok", TENANT);
  });
  it("a salesperson gets the calendar only, and the API is not asked for the admin parts", async () => {
    fetchTenant.mockResolvedValue(tenant("sales"));
    render(await SettingsPage(props({ section: "data" })));
    expect(screen.queryByRole("heading", { name: "Bring in a spreadsheet" })).toBeNull();
    expect(screen.getByRole("heading", { name: "Visits in your phone's calendar" })).toBeInTheDocument();
    expect(getExportFormats).not.toHaveBeenCalled();
    expect(listImportJobs).not.toHaveBeenCalled();
  });
  it("a read that is refused (403) or limited (429) says so in its place; the others still show", async () => {
    getExportFormats.mockRejectedValue(new ApiRequestError(403, "forbidden", "x"));
    listImportJobs.mockRejectedValue(new ApiRequestError(429, "rate_limited", "x", undefined, undefined, 30));
    getCalendarFeed.mockRejectedValue(new ApiRequestError(503, "api_unreachable", "x"));
    render(await SettingsPage(props({ section: "data" })));
    expect(screen.getByText("Your role does not include this page. Ask the owner if you need it.")).toBeInTheDocument();
    expect(screen.getByText(/Wait 30 seconds/)).toBeInTheDocument();
    expect(screen.getByText("This part could not be loaded. The rest of the page is fine.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Bring in a spreadsheet" })).toBeInTheDocument();
  });
  it("a rejected session on a read goes to sign-in", async () => {
    getCalendarFeed.mockRejectedValue(new ApiAuthError("x"));
    await expect(SettingsPage(props({ section: "data" }))).rejects.toThrow("/login");
  });
});

describe("Settings > Privacy (job CC)", () => {
  it("an owner gets every part, each read on its own with the person's token", async () => {
    render(await SettingsPage(props({ section: "privacy" })));
    for (const name of ["Download my data", "Delete my account", "Delete this workspace", "Consent and opt-out list"]) expect(screen.getByRole("heading", { name })).toBeInTheDocument();
    expect(listMyExports).toHaveBeenCalledWith("tok");
    expect(listMyDeletions).toHaveBeenCalledWith("tok");
    expect(listWorkspaceDeletions).toHaveBeenCalledWith("tok", TENANT);
    expect(readConsentList).toHaveBeenCalledWith("tok", TENANT);
    expect(screen.getByLabelText("Type your e-mail address (e@example.test) to confirm.")).toBeInTheDocument();
  });
  it("an admin has no workspace deletion; a viewer has no consent list, and the API is not asked for them", async () => {
    fetchTenant.mockResolvedValue(tenant("admin"));
    render(await SettingsPage(props({ section: "privacy" })));
    expect(screen.queryByRole("heading", { name: "Delete this workspace" })).toBeNull();
    expect(listWorkspaceDeletions).not.toHaveBeenCalled();
    cleanup();
    fetchTenant.mockResolvedValue(tenant("viewer"));
    readConsentList.mockClear();
    render(await SettingsPage(props({ section: "privacy" })));
    expect(readConsentList).not.toHaveBeenCalled();
    expect(screen.queryByRole("heading", { name: "Consent and opt-out list" })).toBeNull();
  });
  it("a read that is refused (403) or limited (429) says so in its place; the others still show", async () => {
    listMyExports.mockRejectedValue(new ApiRequestError(403, "forbidden", "x"));
    readConsentList.mockRejectedValue(new ApiRequestError(429, "rate_limited", "x", undefined, undefined, 25));
    render(await SettingsPage(props({ section: "privacy" })));
    expect(screen.getByText("Your role does not include this page. Ask the owner if you need it.")).toBeInTheDocument();
    expect(screen.getByText(/Wait 25 seconds/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Delete my account" })).toBeInTheDocument();
  });
  it("a rejected session on a read goes to sign-in", async () => {
    listMyDeletions.mockRejectedValue(new ApiAuthError("x"));
    await expect(SettingsPage(props({ section: "privacy" }))).rejects.toThrow("/login");
  });
});

describe("Settings > Business: the shop's GSTIN (job CC)", () => {
  it("shows the number and its state; the Owner and Admin can change it, a salesperson only reads", async () => {
    render(await SettingsPage(props()));
    expect(screen.getByRole("heading", { name: "Our GSTIN" })).toBeInTheDocument();
    expect(screen.getByText("27AAPFU0939F1ZV")).toBeInTheDocument();
    expect(screen.getByText("State: Maharashtra")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove the GSTIN" })).toBeInTheDocument();
    expect(getBusinessProfile).toHaveBeenCalledWith("tok", TENANT);
    cleanup();
    fetchTenant.mockResolvedValue(tenant("sales"));
    render(await SettingsPage(props()));
    expect(screen.getByText("27AAPFU0939F1ZV")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save GSTIN" })).toBeNull();
    expect(screen.getByText("Only an owner or an admin can change the shop's GSTIN.")).toBeInTheDocument();
  });
  it("a number that cannot be read says so in its place and the rest of the business tab stays", async () => {
    getBusinessProfile.mockRejectedValue(new ApiRequestError(429, "rate_limited", "x", undefined, undefined, 12));
    render(await SettingsPage(props()));
    expect(screen.getByText(/Wait 12 seconds/)).toBeInTheDocument();
    expect(screen.getByText("Acme Silks")).toBeInTheDocument();
  });
});
