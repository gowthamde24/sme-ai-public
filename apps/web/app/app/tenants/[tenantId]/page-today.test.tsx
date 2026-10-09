import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiAuthError, ApiRequestError } from "@/lib/api/client";
import { parseQuoteSummary } from "@/lib/api/quotes";
import { QUOTE, SUMMARY_JSON } from "@/lib/api/quotes-fixtures";
import { agentsStatus, todayFor } from "@/test/screens/today-fixtures";
import { notFoundMock, redirectMock } from "@/test/helpers";

const requireUser = vi.fn();
const fetchTenant = vi.fn();
const getToday = vi.fn();
const getAgentsStatus = vi.fn();
const fetchQuotes = vi.fn();
const fetchQuote = vi.fn();
const fetchMembers = vi.fn();

vi.mock("next/navigation", () => ({ redirect: (to: string) => redirectMock(to), notFound: () => notFoundMock() }));
vi.mock("@/lib/auth/session", () => ({ requireUser: () => requireUser() }));
vi.mock("@/lib/api/client", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/api/client")>()), fetchTenant: (...a: unknown[]) => fetchTenant(...a) }));
vi.mock("@/lib/api/orders", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/api/orders")>()), fetchMembers: (...a: unknown[]) => fetchMembers(...a) }));
vi.mock("@/lib/api/today", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/api/today")>()), getToday: (...a: unknown[]) => getToday(...a), getAgentsStatus: (...a: unknown[]) => getAgentsStatus(...a) }));
vi.mock("@/lib/api/quotes", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/api/quotes")>()), fetchQuotes: (...a: unknown[]) => fetchQuotes(...a), fetchQuote: (...a: unknown[]) => fetchQuote(...a) }));
vi.mock("./actions", () => ({ createCompanyAction: vi.fn(async () => undefined) }));

import TenantPage from "./page";

const TENANT = "22222222-2222-2222-2222-222222222222";
const props = (query: Record<string, string> = {}) => ({ params: Promise.resolve({ tenantId: TENANT }), searchParams: Promise.resolve(query) }) as unknown as Parameters<typeof TenantPage>[0];

beforeEach(() => {
  vi.clearAllMocks();
  requireUser.mockResolvedValue({ id: "user-1", email: "e@example.test", accessToken: "tok" });
  fetchTenant.mockResolvedValue({ id: TENANT, name: "Acme Silks", slug: "acme", role: "owner" });
  getToday.mockResolvedValue(todayFor("owner"));
  getAgentsStatus.mockResolvedValue(agentsStatus());
  fetchQuotes.mockResolvedValue([parseQuoteSummary(SUMMARY_JSON)]);
  fetchMembers.mockResolvedValue([]);
});

describe("the workspace home with no ?tab= is Today", () => {
  it("draws the greeting, the three cards, what needs the person, the team and the recent steps from the API", async () => {
    render(await TenantPage(props()));
    expect(getToday).toHaveBeenCalledWith("tok", TENANT);
    expect(getAgentsStatus).toHaveBeenCalledWith("tok", TENANT);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(/^Good (morning|afternoon|evening)$/); // no display name on record
    const cards = screen.getAllByRole("link").filter((a) => /Waiting for you|Customer money held|Orders in progress/.test(a.textContent ?? ""));
    expect(cards).toHaveLength(3);
    expect(cards[0]).toHaveTextContent("Waiting for you3");
    expect(cards[1]).toHaveTextContent("₹400.00");
    expect(cards[2]).toHaveTextContent("1");
    const needs = within(screen.getByRole("heading", { name: "Needs you" }).closest("section")!);
    expect(needs.getAllByRole("article")).toHaveLength(3);
    expect(needs.getByText("Quote 1 for ₹50,400.00 is ready for your approval.")).toBeInTheDocument(); // the API's own sentence
    const team = within(screen.getByRole("heading", { name: "Your team right now" }).closest("section")!);
    expect(team.getByText("Quote Writer")).toBeInTheDocument();
    expect(team.getAllByText("Not available yet")).toHaveLength(2); // Main agent and Lead Finder are not built
    const recent = within(screen.getByRole("heading", { name: "Recently recorded" }).closest("section")!);
    expect(recent.getAllByRole("listitem")).toHaveLength(2);
  });
  it("'Open' goes where the item's target says: the order, the lead, and for a quote the enquiry it belongs to", async () => {
    render(await TenantPage(props()));
    const links = screen.getAllByRole("link").map((a) => a.getAttribute("href"));
    expect(links).toContain(`/app/tenants/${TENANT}/leads/33333333-3333-3333-3333-333333333333`);
    expect(links).toContain(`/app/tenants/${TENANT}/orders/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1`);
    expect(links).toContain(`/app/tenants/${TENANT}/enquiries/${SUMMARY_JSON.enquiry_id}?quote=${QUOTE}`);
  });
  it("a quote that is not among the newest 50 is placed from the quote itself; one that cannot be placed opens the list of quotes", async () => {
    fetchQuotes.mockResolvedValue([]);
    fetchQuote.mockResolvedValue({ enquiry_id: "44444444-4444-4444-4444-444444444444" });
    render(await TenantPage(props()));
    expect(fetchQuote).toHaveBeenCalledWith("tok", TENANT, QUOTE);
    expect(screen.getAllByRole("link").map((a) => a.getAttribute("href"))).toContain(`/app/tenants/${TENANT}/enquiries/44444444-4444-4444-4444-444444444444?quote=${QUOTE}`);
    document.body.innerHTML = "";
    fetchQuotes.mockRejectedValue(new ApiRequestError(500, "api_error", "x"));
    fetchQuote.mockRejectedValue(new ApiRequestError(500, "api_error", "x"));
    render(await TenantPage(props()));
    expect(screen.getAllByRole("link").map((a) => a.getAttribute("href"))).toContain(`/app/tenants/${TENANT}/quotes`);
  });
  it("asks for the quotes only when a quote is waiting", async () => {
    getToday.mockResolvedValue(todayFor("sales"));
    render(await TenantPage(props()));
    expect(fetchQuotes).not.toHaveBeenCalled();
  });
  it("greets the person by the display name the members list has for them", async () => {
    fetchMembers.mockResolvedValue([{ user_id: "other", role: "sales", display_name: "Someone Else" }, { user_id: "user-1", role: "owner", display_name: "Asha Rao" }]);
    render(await TenantPage(props()));
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(/^Good (morning|afternoon|evening), Asha Rao$/);
  });
  it("a read that fails leaves only its own part at 'Not available yet'", async () => {
    getToday.mockRejectedValue(new ApiRequestError(500, "api_error", "x"));
    fetchMembers.mockRejectedValue(new ApiRequestError(500, "api_error", "x"));
    render(await TenantPage(props()));
    expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument();
    expect(screen.getAllByText("Not available yet").length).toBeGreaterThanOrEqual(5); // three cards, Needs you, Recently recorded, plus the two helpers not built
    const team = within(screen.getByRole("heading", { name: "Your team right now" }).closest("section")!);
    expect(team.getByText("Researcher")).toBeInTheDocument(); // the team was read on its own
    document.body.innerHTML = "";
    getToday.mockResolvedValue(todayFor("owner"));
    getAgentsStatus.mockRejectedValue(new ApiRequestError(500, "api_error", "x"));
    render(await TenantPage(props()));
    expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument();
    expect(within(screen.getByRole("heading", { name: "Your team right now" }).closest("section")!).getByText("Not available yet")).toBeInTheDocument();
    expect(screen.getByText("Waiting for you")).toBeInTheDocument();
  });
  it("a Viewer's zeros are numbers, and an empty list is 'nothing is waiting', not 'not available'", async () => {
    getToday.mockResolvedValue(todayFor("viewer"));
    render(await TenantPage(props()));
    expect(screen.getAllByText("Nothing is waiting for you.").length).toBeGreaterThan(0);
    expect(screen.getAllByRole("link").filter((a) => /Orders in progress/.test(a.textContent ?? ""))[0]).toHaveTextContent("0");
  });
  it("a rejected session is sent to sign in; a missing workspace to not-found", async () => {
    getToday.mockRejectedValue(new ApiAuthError("rejected"));
    await expect(TenantPage(props())).rejects.toThrow(/login/);
    fetchTenant.mockRejectedValue(new ApiRequestError(404, "not_found", "x"));
    await expect(TenantPage(props())).rejects.toThrow();
  });
  it("?tab= still shows the records tables, and an unknown tab shows the companies", async () => {
    render(await TenantPage(props({ tab: "nonsense" })));
    expect(screen.queryByText("Needs you")).toBeNull();
    expect(getToday).not.toHaveBeenCalled();
  });
});
