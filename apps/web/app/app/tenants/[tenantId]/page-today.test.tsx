import { act, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiAuthError, ApiRequestError } from "@/lib/api/client";
import { parseCallRequestPage, parseOutboxPage } from "@/lib/api/outbox";
import { parseQuoteSummary } from "@/lib/api/quotes";
import { QUOTE, SUMMARY_JSON } from "@/lib/api/quotes-fixtures";
import { agentsStatus, todayFor } from "@/test/screens/today-fixtures";
import { CALL_JSON, PRICE_JSON, SENT_JSON, page } from "@/lib/api/outbox-fixtures";
import { notFoundMock, redirectMock } from "@/test/helpers";

const requireUser = vi.fn();
const fetchTenant = vi.fn();
const getToday = vi.fn();
const getAgentsStatus = vi.fn();
const fetchQuotes = vi.fn();
const fetchQuote = vi.fn();
const fetchMembers = vi.fn();
const listOutboxMessages = vi.fn();
const listOutboxApprovals = vi.fn();
const listCallRequests = vi.fn();
const getVisitSettings = vi.fn();
const listCatalogueItems = vi.fn();
const getOutboxSettings = vi.fn();

vi.mock("next/navigation", () => ({ redirect: (to: string) => redirectMock(to), notFound: () => notFoundMock(), useRouter: () => ({ refresh: () => undefined, push: () => undefined }), usePathname: () => "/", useSearchParams: () => new URLSearchParams() }));
vi.mock("./today-actions", () => ({ approveMessageAction: vi.fn(), rejectMessageAction: vi.fn(), editMessageAction: vi.fn(), approveCallAction: vi.fn(), offerVisitAction: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireUser: () => requireUser() }));
vi.mock("@/lib/api/client", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/api/client")>()), fetchTenant: (...a: unknown[]) => fetchTenant(...a) }));
vi.mock("@/lib/api/orders", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/api/orders")>()), fetchMembers: (...a: unknown[]) => fetchMembers(...a) }));
vi.mock("@/lib/api/today", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/api/today")>()), getToday: (...a: unknown[]) => getToday(...a), getAgentsStatus: (...a: unknown[]) => getAgentsStatus(...a) }));
vi.mock("@/lib/api/quotes", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/api/quotes")>()), fetchQuotes: (...a: unknown[]) => fetchQuotes(...a), fetchQuote: (...a: unknown[]) => fetchQuote(...a) }));
vi.mock("@/lib/api/outbox", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/outbox")>()),
  listOutboxMessages: (...a: unknown[]) => listOutboxMessages(...a),
  listOutboxApprovals: (...a: unknown[]) => listOutboxApprovals(...a),
  listCallRequests: (...a: unknown[]) => listCallRequests(...a),
  getOutboxSettings: (...a: unknown[]) => getOutboxSettings(...a),
}));
vi.mock("@/lib/api/visits", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/api/visits")>()), getVisitSettings: (...a: unknown[]) => getVisitSettings(...a) }));
vi.mock("@/lib/api/catalogue", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/api/catalogue")>()), listCatalogueItems: (...a: unknown[]) => listCatalogueItems(...a) }));
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
  listOutboxMessages.mockResolvedValue(parseOutboxPage(page([{ ...SENT_JSON, sent_at: new Date(Date.now() - 3600_000).toISOString() }])));
  listOutboxApprovals.mockResolvedValue(parseOutboxPage(page([PRICE_JSON])));
  listCallRequests.mockResolvedValue(parseCallRequestPage(page([CALL_JSON])));
  getVisitSettings.mockRejectedValue(new Error("not read")); // the setup facts are unknown unless a test gives them: Today is then shown as it is
  listCatalogueItems.mockRejectedValue(new Error("not read"));
  getOutboxSettings.mockRejectedValue(new Error("not read"));
});

const settle = async () => {
  for (let i = 0; i < 4; i += 1) await act(async () => void (await Promise.resolve()));
};
const show = async (props_: ReturnType<typeof props> = props()) => {
  const element = await TenantPage(props_);
  await act(async () => void render(element));
  await settle();
};

describe("the workspace home with no ?tab= is Today", () => {
  it("draws the greeting, the Agent OWL card, what needs the person (a message, a call and the older kinds), the done list and the team from the API", async () => {
    await show();
    expect(getToday).toHaveBeenCalledWith("tok", TENANT);
    expect(getAgentsStatus).toHaveBeenCalledWith("tok", TENANT);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(/^Good (morning|afternoon|evening)$/); // no display name on record
    expect(screen.getByRole("heading", { level: 2, name: "5 things need you. The rest is handled." })).toBeInTheDocument();
    const needs = within(screen.getByRole("heading", { name: "Needs you" }).closest("section")!);
    expect(needs.getAllByRole("article")).toHaveLength(5); // the count is the cards
    expect(needs.getByText(/ఈ చీర ధర 500/)).toBeInTheDocument(); // the exact words of the message, read from the outbox
    expect(needs.getByText("The customer asked for a call about a large wedding order.")).toBeInTheDocument();
    expect(needs.getByText("Quote 1 for ₹50,400.00 is ready for your approval.")).toBeInTheDocument(); // the API's own sentence
    expect(listOutboxApprovals).toHaveBeenCalledTimes(1);
    expect(listCallRequests).toHaveBeenCalledWith("tok", TENANT, { status: "requested", limit: 100 });
    expect(screen.getByRole("heading", { name: "Done while you slept" })).toBeInTheDocument();
    const team = within(screen.getByRole("heading", { name: "Your team" }).closest("section")!);
    expect(team.getByText("Quote Writer")).toBeInTheDocument();
    expect(team.getByText("Lead Finder")).toBeInTheDocument();
  });
  it("'Open' goes where the item's target says: the order, the lead, and for a quote the enquiry it belongs to", async () => {
    await show();
    const links = screen.getAllByRole("link").map((a) => a.getAttribute("href"));
    expect(links).toContain(`/app/tenants/${TENANT}/leads/33333333-3333-3333-3333-333333333333`);
    expect(links).toContain(`/app/tenants/${TENANT}/orders/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1`);
    expect(links).toContain(`/app/tenants/${TENANT}/enquiries/${SUMMARY_JSON.enquiry_id}?quote=${QUOTE}`);
  });
  it("a quote that is not among the newest 50 is placed from the quote itself; one that cannot be placed opens the list of quotes", async () => {
    fetchQuotes.mockResolvedValue([]);
    fetchQuote.mockResolvedValue({ enquiry_id: "44444444-4444-4444-4444-444444444444" });
    await show();
    expect(fetchQuote).toHaveBeenCalledWith("tok", TENANT, QUOTE);
    expect(screen.getAllByRole("link").map((a) => a.getAttribute("href"))).toContain(`/app/tenants/${TENANT}/enquiries/44444444-4444-4444-4444-444444444444?quote=${QUOTE}`);
    document.body.innerHTML = "";
    fetchQuotes.mockRejectedValue(new ApiRequestError(500, "api_error", "x"));
    fetchQuote.mockRejectedValue(new ApiRequestError(500, "api_error", "x"));
    await show();
    expect(screen.getAllByRole("link").map((a) => a.getAttribute("href"))).toContain(`/app/tenants/${TENANT}/quotes`);
  });
  it("asks for the quotes only when a quote is waiting", async () => {
    getToday.mockResolvedValue(todayFor("sales"));
    await show();
    expect(fetchQuotes).not.toHaveBeenCalled();
  });
  it("asks for the words of a message only when one is held, and for the calls only when one is asked for", async () => {
    getToday.mockResolvedValue(todayFor("sales"));
    await show();
    expect(listOutboxApprovals).not.toHaveBeenCalled();
    expect(listCallRequests).not.toHaveBeenCalled();
    document.body.innerHTML = "";
    getToday.mockResolvedValue(todayFor("admin"));
    await show();
    expect(listOutboxApprovals).toHaveBeenCalledTimes(1);
    expect(listCallRequests).not.toHaveBeenCalled(); // an Admin is not given calls
  });
  it("greets the person by the display name the members list has for them", async () => {
    fetchMembers.mockResolvedValue([{ user_id: "other", role: "sales", display_name: "Someone Else" }, { user_id: "user-1", role: "owner", display_name: "Asha Rao" }]);
    await show();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(/^Good (morning|afternoon|evening), Asha Rao$/);
  });
  it("a read that fails leaves only its own part at 'Not available yet'", async () => {
    getToday.mockRejectedValue(new ApiRequestError(500, "api_error", "x"));
    fetchMembers.mockRejectedValue(new ApiRequestError(500, "api_error", "x"));
    await show();
    expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument();
    const needs = within(screen.getByRole("heading", { name: "Needs you" }).closest("section")!);
    expect(needs.getByText("Not available yet")).toBeInTheDocument();
    expect(needs.queryByRole("article")).toBeNull();
    const team = within(screen.getByRole("heading", { name: "Your team" }).closest("section")!);
    expect(team.getByText("Researcher")).toBeInTheDocument(); // the team was read on its own
    document.body.innerHTML = "";
    getToday.mockResolvedValue(todayFor("owner"));
    getAgentsStatus.mockRejectedValue(new ApiRequestError(500, "api_error", "x"));
    await show();
    expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument();
    expect(within(screen.getByRole("heading", { name: "Your team" }).closest("section")!).getByText("Not available yet")).toBeInTheDocument();
    expect(within(screen.getByRole("heading", { name: "Needs you" }).closest("section")!).getAllByRole("article")).toHaveLength(5);
  });
  it("a message whose words cannot be read is shown without buttons, never approved blind", async () => {
    listOutboxApprovals.mockRejectedValue(new ApiRequestError(500, "api_error", "x"));
    await show();
    const needs = within(screen.getByRole("heading", { name: "Needs you" }).closest("section")!);
    expect(needs.getByText(/could not be loaded, so it cannot be approved here/)).toBeInTheDocument();
    expect(needs.queryByRole("button", { name: "Approve and send" })).toBeNull();
    expect(needs.getByRole("button", { name: "Approve call" })).toBeInTheDocument();
  });
  it("the outbox log failing leaves the rest of Today alone, with its own two places saying so", async () => {
    listOutboxMessages.mockRejectedValue(new ApiRequestError(500, "api_error", "x"));
    await show();
    expect(screen.getByText("The overnight summary is not available yet.")).toBeInTheDocument();
    expect(within(document.querySelector('[data-part="done"]') as HTMLElement).getByText("Not available yet")).toBeInTheDocument();
    expect(within(screen.getByRole("heading", { name: "Needs you" }).closest("section")!).getAllByRole("article")).toHaveLength(5);
  });
  it("a Viewer's zeros are numbers; nothing needs them, the log is not asked for and its places are not drawn", async () => {
    fetchTenant.mockResolvedValue({ id: TENANT, name: "Acme Silks", slug: "acme", role: "viewer" });
    getToday.mockResolvedValue(todayFor("viewer"));
    await show(props());
    expect(screen.getByRole("heading", { level: 2, name: "Nothing needs you right now." })).toBeInTheDocument();
    expect(screen.getByText("All clear. I will tell you the moment something needs you.")).toBeInTheDocument();
    expect(listOutboxMessages).not.toHaveBeenCalled();
    expect(document.querySelector('[data-part="done"]')).toBeNull();
    expect(document.querySelector('[data-part="overnight"]')).toBeNull();
  });
  it("'See everything in the outbox' opens the Outbox for the people who may read it (Owner, Admin, Sales)", async () => {
    await show(props());
    expect(screen.getByRole("link", { name: "See everything in the outbox" })).toHaveAttribute("href", `/app/tenants/${TENANT}/outbox?tab=sent`);
    document.body.innerHTML = "";
    fetchTenant.mockResolvedValue({ id: TENANT, name: "Acme Silks", slug: "acme", role: "sales" });
    getToday.mockResolvedValue(todayFor("sales"));
    await show(props());
    expect(screen.getByRole("link", { name: "See everything in the outbox" })).toBeInTheDocument();
  });
  it("a Viewer is not given the link (the API would refuse the page)", async () => {
    fetchTenant.mockResolvedValue({ id: TENANT, name: "Acme Silks", slug: "acme", role: "viewer" });
    getToday.mockResolvedValue(todayFor("viewer"));
    await show(props());
    expect(screen.queryByRole("link", { name: "See everything in the outbox" })).toBeNull();
  });
  it("the buttons follow the role: an Admin decides a message but not a call", async () => {
    fetchTenant.mockResolvedValue({ id: TENANT, name: "Acme Silks", slug: "acme", role: "admin" });
    getToday.mockResolvedValue(todayFor("admin"));
    await show();
    expect(screen.getByRole("button", { name: "Approve and send" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Approve call" })).toBeNull();
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

describe("the first-run setup on Today (job BJ)", () => {
  const settings = { weekly_hours: Object.fromEntries(["mon", "tue", "wed", "thu", "fri", "sat", "sun"].map((d) => [d, { open: "10:00", close: "20:30" }])), closed_dates: [], slot_minutes: 30, max_parallel: 2, is_default: true };
  const brandNew = () => {
    getVisitSettings.mockResolvedValue(settings);
    listCatalogueItems.mockResolvedValue({ items: [], next_cursor: null });
    getOutboxSettings.mockResolvedValue({ platform_switch_on: true, auto_send_enabled: false, per_customer_daily_limit: 3, quiet_hours_start: 21, quiet_hours_end: 9 });
  };
  beforeEach(() => window.localStorage.clear());
  it("the Owner of a brand-new workspace sees the wizard, greeting the shop by name, instead of Today", async () => {
    brandNew();
    await show();
    // the wizard is its own chunk (job CF): it arrives a moment after the first paint, which shows the waiting line
    expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent("Welcome to Acme Silks");
    expect(screen.queryByText("Needs you")).toBeNull();
    expect(getVisitSettings).toHaveBeenCalledWith("tok", TENANT);
    expect(listCatalogueItems).toHaveBeenCalledWith("tok", TENANT, { limit: 1, includeInactive: true });
    expect(getOutboxSettings).toHaveBeenCalledWith("tok", TENANT);
  });
  it("an Admin and a Sales person see Today: only the Owner is asked to set the shop up (and no setup call is made for them)", async () => {
    brandNew();
    for (const role of ["admin", "sales", "viewer"]) {
      fetchTenant.mockResolvedValue({ id: TENANT, name: "Acme Silks", slug: "acme", role });
      getToday.mockResolvedValue(todayFor(role === "viewer" ? "viewer" : (role as "admin")));
      getVisitSettings.mockClear();
      document.body.innerHTML = "";
      await show();
      expect(screen.queryByText("Welcome to Acme Silks"), role).toBeNull();
      expect(getVisitSettings, role).not.toHaveBeenCalled();
    }
  });
  it("an Owner whose setup facts cannot be read sees Today, never a wizard on a guess", async () => {
    await show();
    expect(screen.getByRole("heading", { name: "Needs you" })).toBeInTheDocument();
    expect(screen.queryByText("Welcome to Acme Silks")).toBeNull();
  });
  it("an established workspace (hours saved) shows Today with the checklist card above it", async () => {
    brandNew();
    getVisitSettings.mockResolvedValue({ ...settings, is_default: false });
    await show();
    expect(screen.getByRole("heading", { name: "Needs you" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Finish setting up" })).toBeInTheDocument();
  });
});

