import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiAuthError, ApiRequestError } from "@/lib/api/client";
import { notFoundMock, redirectMock } from "@/test/helpers";
import { LEAD_A, SETTINGS, VISIT_1, parseVisitFixture, slotsJson, visitJson } from "@/lib/api/visits-fixtures";

const requireUser = vi.fn();
const fetchTenant = vi.fn();
const listVisits = vi.fn();
const getSlots = vi.fn();
const getVisitSettings = vi.fn();
const apiRequest = vi.fn();
const fetchLead = vi.fn();
const fetchContact = vi.fn();
const fetchCompany = vi.fn();
const fetchLeadContactId = vi.fn();
vi.mock("next/navigation", () => ({ redirect: (to: string) => redirectMock(to), notFound: () => notFoundMock(), useRouter: () => ({ refresh: () => undefined }) }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/auth/session", () => ({ requireUser: () => requireUser() }));
vi.mock("@/i18n/get-lang", () => ({ getLang: async () => "en" }));
vi.mock("@/lib/api/client", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/api/client")>()), fetchTenant: (...a: unknown[]) => fetchTenant(...a), apiRequest: (...a: unknown[]) => apiRequest(...a) }));
vi.mock("@/lib/api/visits", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/api/visits")>()), listVisits: (...a: unknown[]) => listVisits(...a), getSlots: (...a: unknown[]) => getSlots(...a), getVisitSettings: (...a: unknown[]) => getVisitSettings(...a) }));
vi.mock("@/lib/api/crm", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/api/crm")>()), fetchLead: (...a: unknown[]) => fetchLead(...a), fetchContact: (...a: unknown[]) => fetchContact(...a), fetchCompany: (...a: unknown[]) => fetchCompany(...a) }));
vi.mock("@/lib/api/lead-contact", () => ({ fetchLeadContactId: (...a: unknown[]) => fetchLeadContactId(...a) }));

import VisitsPage from "./page";

const TENANT = "22222222-2222-2222-2222-222222222222";
const props = (query: Record<string, string> = {}) => ({ params: Promise.resolve({ tenantId: TENANT }), searchParams: Promise.resolve(query) }) as unknown as Parameters<typeof VisitsPage>[0];
// Wednesday 14 October 2026, 10:00 in India
const NOW = Date.parse("2026-10-14T04:30:00Z");

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  requireUser.mockResolvedValue({ id: "user-1", email: "e@example.test", accessToken: "tok" });
  fetchTenant.mockResolvedValue({ id: TENANT, name: "Acme Silks", slug: "acme", role: "owner" });
  listVisits.mockResolvedValue({ from: "2026-10-14", to: "2026-10-14", items: [parseVisitFixture(visitJson())] });
  getSlots.mockResolvedValue(slotsJson("2026-10-14"));
  getVisitSettings.mockResolvedValue(SETTINGS);
  fetchLead.mockResolvedValue({ id: LEAD_A, company_id: "11111111-1111-4111-8111-111111111111" });
  fetchLeadContactId.mockResolvedValue("22222222-2222-4222-8222-2222222222aa");
  fetchContact.mockResolvedValue({ full_name: "Priya Sharma" });
  fetchCompany.mockResolvedValue({ name: "Sri Lakshmi Silks" });
});
afterEach(() => vi.useRealTimers());

describe("the Visits page", () => {
  it("opens on today in India, reading that day's visits and slots with the person's token", async () => {
    render(await VisitsPage(props()));
    expect(listVisits).toHaveBeenCalledWith("tok", TENANT, { from: "2026-10-14", to: "2026-10-14" });
    expect(getSlots).toHaveBeenCalledWith("tok", TENANT, "2026-10-14");
    expect(screen.getByRole("heading", { name: "Wednesday, 14 October 2026" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 3, name: /Priya S\. \+ 2/ })).toBeInTheDocument();
    expect(getVisitSettings).not.toHaveBeenCalled(); // the hours are only read on their tab
  });
  it("?date= opens another day; a date that is not a date opens today", async () => {
    render(await VisitsPage(props({ date: "2026-10-16" })));
    expect(listVisits).toHaveBeenLastCalledWith("tok", TENANT, { from: "2026-10-16", to: "2026-10-16" });
    document.body.innerHTML = "";
    render(await VisitsPage(props({ date: "2026-02-30" })));
    expect(listVisits).toHaveBeenLastCalledWith("tok", TENANT, { from: "2026-10-14", to: "2026-10-14" });
  });
  it("?view=hours reads the hours and draws them", async () => {
    render(await VisitsPage(props({ view: "hours" })));
    expect(getVisitSettings).toHaveBeenCalledWith("tok", TENANT);
    expect(screen.getByRole("heading", { name: "Opening hours" })).toBeInTheDocument();
    expect(listVisits).not.toHaveBeenCalled();
  });
  it("?visit= opens the day of that visit and points at it", async () => {
    apiRequest.mockResolvedValue(visitJson({ id: VISIT_1, date: "2026-10-18", starts_at: "2026-10-18T05:00:00Z", ends_at: "2026-10-18T05:30:00Z" }));
    render(await VisitsPage(props({ visit: VISIT_1 })));
    expect(apiRequest).toHaveBeenCalledWith(`/v1/tenants/${TENANT}/visits/${VISIT_1}`, "tok");
    expect(listVisits).toHaveBeenLastCalledWith("tok", TENANT, { from: "2026-10-18", to: "2026-10-18" });
  });
  it("a visit that cannot be found opens today", async () => {
    apiRequest.mockRejectedValue(new ApiRequestError(404, "not_found", "x"));
    render(await VisitsPage(props({ visit: VISIT_1 })));
    expect(listVisits).toHaveBeenLastCalledWith("tok", TENANT, { from: "2026-10-14", to: "2026-10-14" });
  });
  it("?lead= opens the booking for that lead, named by its contact", async () => {
    render(await VisitsPage(props({ lead: LEAD_A })));
    expect(screen.getByText("Priya Sharma")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Search" })).toBeNull();
  });
  it("a lead whose name cannot be read falls back to the search", async () => {
    fetchLead.mockRejectedValue(new ApiRequestError(404, "not_found", "x"));
    render(await VisitsPage(props({ lead: LEAD_A })));
    expect(screen.getByRole("button", { name: "Search" })).toBeInTheDocument();
  });
  it("a part that cannot be read says 'Not available yet' in its place and the rest is drawn", async () => {
    listVisits.mockRejectedValue(new ApiRequestError(500, "api_error", "x"));
    render(await VisitsPage(props()));
    expect(screen.getAllByText("Not available yet").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByRole("heading", { name: "Free times" })).toBeInTheDocument();
  });
  it("shows a Viewer the day without the booking", async () => {
    fetchTenant.mockResolvedValue({ id: TENANT, name: "Acme Silks", slug: "acme", role: "viewer" });
    render(await VisitsPage(props()));
    expect(screen.queryByRole("heading", { name: "Book a visit" })).toBeNull();
  });
  it("a workspace id that is not an id is not found; a stranger's workspace too", async () => {
    await expect(VisitsPage({ params: Promise.resolve({ tenantId: "nope" }), searchParams: Promise.resolve({}) } as never)).rejects.toThrow("NEXT_NOT_FOUND");
    fetchTenant.mockRejectedValue(new ApiRequestError(404, "not_found", "x"));
    await expect(VisitsPage(props())).rejects.toThrow("NEXT_NOT_FOUND");
  });
  it("a rejected session goes to sign-in, from any of the reads", async () => {
    fetchTenant.mockRejectedValue(new ApiAuthError("x"));
    await expect(VisitsPage(props())).rejects.toThrow("NEXT_REDIRECT:/login");
    fetchTenant.mockResolvedValue({ id: TENANT, name: "Acme", slug: "acme", role: "owner" });
    listVisits.mockRejectedValue(new ApiAuthError("x"));
    await expect(VisitsPage(props())).rejects.toThrow("NEXT_REDIRECT:/login");
  });
  it("the workspace being down is the page's own error, not a crash", async () => {
    fetchTenant.mockRejectedValue(new ApiRequestError(503, "api_unreachable", "x"));
    render(await VisitsPage(props()));
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });
});
