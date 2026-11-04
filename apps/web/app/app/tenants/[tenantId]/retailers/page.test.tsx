import { render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiAuthError, ApiRequestError } from "@/lib/api/client";
import { parseAvailability, parseProspect, parseStats } from "@/lib/api/lead-finder";
import { AVAILABLE, AVAILABLE_PLACES, L1, P1, PROSPECT, PROSPECT_LOW, PROSPECT_QUALIFIED, PROSPECT_READY, SCHOOL, T } from "@/lib/api/lead-finder-fixtures";
import { notFoundMock, redirectMock } from "@/test/helpers";

const langNow = vi.hoisted(() => ({ v: "en" as "en" | "te" }));
vi.mock("@/i18n/get-lang", () => ({ getLang: async () => langNow.v }));
const requireUser = vi.fn();
const fetchTenant = vi.fn();
const lf = { readAvailability: vi.fn(), redecideProspects: vi.fn(), listProspects: vi.fn(), getProspectStats: vi.fn(), getProspect: vi.fn() };
vi.mock("next/navigation", () => ({ redirect: (to: string) => redirectMock(to), notFound: () => notFoundMock(), useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/auth/session", () => ({ requireUser: () => requireUser() }));
vi.mock("@/lib/api/client", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/api/client")>()), fetchTenant: (...a: unknown[]) => fetchTenant(...a) }));
vi.mock("@/lib/api/lead-finder", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/lead-finder")>()),
  readAvailability: (...a: unknown[]) => lf.readAvailability(...a),
  redecideProspects: (...a: unknown[]) => lf.redecideProspects(...a),
  listProspects: (...a: unknown[]) => lf.listProspects(...a),
  getProspectStats: (...a: unknown[]) => lf.getProspectStats(...a),
  getProspect: (...a: unknown[]) => lf.getProspect(...a),
}));
vi.mock("./actions", () => ({ planSearchAction: vi.fn(), approveSearchAction: vi.fn(), cancelSearchAction: vi.fn(), prospectActionsAction: vi.fn(), practiceCallAction: vi.fn(), quoteDraftAction: vi.fn(), makeQuoteDraftAction: vi.fn() }));

import ProspectsPage from "./page";

const props = (q: Record<string, string> = {}) => ({ params: Promise.resolve({ tenantId: T }), searchParams: Promise.resolve(q) }) as unknown as Parameters<typeof ProspectsPage>[0];
const tenant = (role: string) => ({ id: T, name: "Acme Silks", slug: "acme-silks", role });
const page = (...rows: unknown[]) => ({ items: rows.map(parseProspect), nextCursor: null });

beforeEach(() => {
  vi.clearAllMocks();
  requireUser.mockResolvedValue({ id: "u", email: "e@example.test", accessToken: "tok" });
  fetchTenant.mockResolvedValue(tenant("owner"));
  lf.readAvailability.mockResolvedValue(parseAvailability(AVAILABLE));
  lf.redecideProspects.mockResolvedValue(0);
  lf.listProspects.mockResolvedValue(page(PROSPECT, PROSPECT_READY, PROSPECT_LOW, PROSPECT_QUALIFIED));
  lf.getProspectStats.mockResolvedValue(parseStats({ total: 18, by_status: { needs_owner: 11, skipped: 7 } }));
});

describe("/retailers: the Prospects tab", () => {
  it("an owner sees the box, the list best fit first with the badge, the why and the source, and the demo label; the screen decides again first", async () => {
    render(await ProspectsPage(props()));
    expect(screen.getByRole("heading", { level: 1, name: "Prospects" })).toBeInTheDocument();
    expect(screen.getByText("Made-up businesses for the demo")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Find new retailers in …" })).toBeInTheDocument();
    expect(lf.redecideProspects).toHaveBeenCalledWith("tok", T);
    expect(lf.listProspects).toHaveBeenCalledWith("tok", T, { status: null, cursor: null, limit: 50 });
    const row = within(document.querySelector(`[data-prospect="${P1}"]`) as HTMLElement);
    expect(row.getByRole("heading", { name: "Sri Lakshmi Sarees" })).toBeInTheDocument();
    expect(row.getByText("Needs you")).toBeInTheDocument();
    expect(row.getByText("fit 82 · 1 of the first 10 calls — needs your OK")).toBeInTheDocument();
    // the stock is said ONCE above the list (owner, 4 Nov), each card has its own facts instead
    expect(row.queryByText(/we have Kanchi Pattu Bridal/)).toBeNull();
    expect(document.querySelector('[data-part="in-stock"]')).toHaveTextContent(/^In stock: .*Kanchi Pattu Bridal/);
    expect(row.getByText(/★ 4\.5 · 312 reviews/)).toBeInTheDocument();
    expect(row.getByText(/Example search \(made-up businesses\)/)).toBeInTheDocument();
    expect(screen.getByText("fit 64 · low stock")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open the lead" })).toHaveAttribute("href", `/app/tenants/${T}/leads/${L1}`);
    expect(screen.getByRole("link", { name: "Needs you (11)" })).toHaveAttribute("href", `/app/tenants/${T}/retailers?status=needs_owner`);
    expect(screen.getByText("Practice call")).toBeInTheDocument();
    expect(screen.queryByText("Google Maps")).toBeNull();
    for (const b of ["Call", "Ask me later", "Skip", "Not interested", "Do not call"]) expect(screen.getByRole("button", { name: b })).toBeInTheDocument();
  });
  it("Google Maps data says Google Maps, on every row that carries it", async () => {
    lf.readAvailability.mockResolvedValue(parseAvailability(AVAILABLE_PLACES));
    lf.listProspects.mockResolvedValue(page({ ...PROSPECT, source: "google_maps", attribution: "Google Maps", source_label: "Google Maps search 'saree shops Jayanagar', 2 Nov" }, PROSPECT_LOW));
    render(await ProspectsPage(props()));
    expect(screen.getAllByText("Google Maps")).toHaveLength(1);
    // a made-up row in a workspace that searches Google says what it is on the row itself
    expect(within(document.querySelector('[data-prospect="b1b1b1b1-0000-4000-8000-000000000002"]') as HTMLElement).getByText("Made-up businesses for the demo")).toBeInTheDocument();
  });
  it("a salesperson gets the list and the box, and no practice call", async () => {
    fetchTenant.mockResolvedValue(tenant("sales"));
    render(await ProspectsPage(props()));
    expect(screen.getByRole("heading", { name: "Padmavathi Silks" })).toBeInTheDocument();
    expect(screen.queryByText("Practice call")).toBeNull();
    expect(screen.getByRole("button", { name: "Plan the search" })).toBeEnabled();
  });
  it("a viewer is told this is not theirs, and nothing of the Lead Finder is asked", async () => {
    fetchTenant.mockResolvedValue(tenant("viewer"));
    render(await ProspectsPage(props()));
    expect(screen.getByText("Prospects are for the owner, admins and sales.")).toBeInTheDocument();
    expect(lf.readAvailability).not.toHaveBeenCalled();
    expect(lf.listProspects).not.toHaveBeenCalled();
  });
  it.each([["a school", SCHOOL], ["switched off", { available: false, source: null, reason: "switched_off" }]])("%s: the page is not there", async (_, body) => {
    lf.readAvailability.mockResolvedValue(parseAvailability(body));
    await expect(ProspectsPage(props())).rejects.toThrow("NEXT_NOT_FOUND");
    expect(lf.listProspects).not.toHaveBeenCalled();
    expect(lf.redecideProspects).not.toHaveBeenCalled();
  });
  it("availability that cannot be told says the prospects could not load (never an error page)", async () => {
    lf.readAvailability.mockResolvedValue(null);
    render(await ProspectsPage(props()));
    expect(screen.getByRole("alert")).toHaveTextContent("The prospects could not be loaded.");
    expect(screen.queryByRole("textbox", { name: "Find new retailers in …" })).toBeNull();
  });
  it("filters by a closed status and pages with the cursor; an unknown status is no filter", async () => {
    lf.listProspects.mockResolvedValue({ ...page(PROSPECT_LOW), nextCursor: "c-2" });
    render(await ProspectsPage(props({ status: "needs_owner", cursor: "c-1" })));
    expect(lf.listProspects).toHaveBeenCalledWith("tok", T, { status: "needs_owner", cursor: "c-1", limit: 50 });
    expect(screen.getByRole("link", { name: "Show more" })).toHaveAttribute("href", `/app/tenants/${T}/retailers?status=needs_owner&cursor=c-2`);
    expect(screen.getByRole("link", { name: "Needs you (11)" })).toHaveAttribute("aria-current", "page");
    lf.listProspects.mockClear();
    render(await ProspectsPage(props({ status: "everything" })));
    expect(lf.listProspects).toHaveBeenCalledWith("tok", T, { status: null, cursor: null, limit: 50 });
  });
  it("opens one prospect (from a Needs-you row on Today), and says so when it is gone", async () => {
    lf.getProspect.mockResolvedValue(parseProspect(PROSPECT_LOW));
    render(await ProspectsPage(props({ id: PROSPECT_LOW.id })));
    expect(lf.getProspect).toHaveBeenCalledWith("tok", T, PROSPECT_LOW.id);
    expect(lf.listProspects).not.toHaveBeenCalled();
    expect(screen.getByText("Showing one prospect.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Show all prospects" })).toHaveAttribute("href", `/app/tenants/${T}/retailers`);
    lf.getProspect.mockRejectedValue(new ApiRequestError(404, "not_found", "x"));
    render(await ProspectsPage(props({ id: PROSPECT_LOW.id })));
    expect(screen.getByText("That prospect is not there any more.")).toBeInTheDocument();
  });
  it("an empty list says how to start; a list that cannot be read says so; a redecide that fails does not stop the list", async () => {
    lf.redecideProspects.mockRejectedValue(new ApiRequestError(503, "api_unreachable", "x"));
    lf.listProspects.mockResolvedValue(page());
    render(await ProspectsPage(props()));
    expect(screen.getByText("No prospects yet. Find new retailers above.")).toBeInTheDocument();
    lf.listProspects.mockRejectedValue(new ApiRequestError(503, "api_unreachable", "x"));
    render(await ProspectsPage(props()));
    expect(screen.getByRole("alert")).toHaveTextContent("The prospects could not be loaded.");
  });
  it("a rejected session goes to sign-in, an unknown workspace is not found, an unreachable API says so", async () => {
    lf.readAvailability.mockRejectedValue(new ApiAuthError("x"));
    await expect(ProspectsPage(props())).rejects.toThrow("/login");
    lf.readAvailability.mockResolvedValue(parseAvailability(AVAILABLE));
    lf.listProspects.mockRejectedValue(new ApiAuthError("x"));
    await expect(ProspectsPage(props())).rejects.toThrow("/login");
    fetchTenant.mockRejectedValue(new ApiRequestError(404, "not_found", "x"));
    await expect(ProspectsPage(props())).rejects.toThrow("NEXT_NOT_FOUND");
    fetchTenant.mockRejectedValue(new ApiRequestError(503, "api_unreachable", "x"));
    render(await ProspectsPage(props()));
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });
  it.each([[403, "/app/problem/403"], [429, "/app/problem/429"]])("the workspace read answering %i goes to %s", async (status, to) => {
    fetchTenant.mockRejectedValue(new ApiRequestError(status, status === 429 ? "rate_limited" : "forbidden", "x"));
    await expect(ProspectsPage(props())).rejects.toThrow(`NEXT_REDIRECT:${to}`);
  });
});

describe("/retailers on a Lead Desk plan (owner decision 4 Nov: the Lead Finder is part of AI Workforce)", () => {
  afterEach(() => vi.unstubAllEnvs());
  const leadDesk = () => {
    vi.stubEnv("PLAN_TIER_SCREENS", "mock");
    vi.stubEnv("PLAN_TIER_MOCK", "lead_desk");
  };
  it("the friendly card in place of the tab's work, with the link to Settings -> Plan; nothing of the Lead Finder is read or decided", async () => {
    leadDesk();
    render(await ProspectsPage(props()));
    expect(screen.getByRole("heading", { name: "Finding new customers is part of AI Workforce" })).toBeInTheDocument();
    expect(screen.getByText(/finds new businesses near you that may buy/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "See what's in each plan" })).toHaveAttribute("href", `/app/tenants/${T}/settings?section=plan`);
    expect(screen.queryByRole("textbox", { name: "Find new retailers in …" })).toBeNull();
    expect(lf.redecideProspects).not.toHaveBeenCalled();
    expect(lf.listProspects).not.toHaveBeenCalled();
    expect(lf.getProspectStats).not.toHaveBeenCalled();
  });
  it("the API's own `not_in_plan` shows the same card, even with the tier flag off", async () => {
    lf.readAvailability.mockResolvedValue(parseAvailability({ available: false, source: null, reason: "not_in_plan", upgrade_to: "ai_workforce" }));
    render(await ProspectsPage(props()));
    expect(screen.getByRole("heading", { name: "Finding new customers is part of AI Workforce" })).toBeInTheDocument();
    expect(lf.listProspects).not.toHaveBeenCalled();
  });
  it("a salesperson gets no upgrade link: the card says who can change the plan", async () => {
    leadDesk();
    fetchTenant.mockResolvedValue(tenant("sales"));
    render(await ProspectsPage(props()));
    expect(screen.queryByRole("link", { name: "See what's in each plan" })).toBeNull();
    expect(screen.getByText("Only the owner can change the plan. Ask them if you need it.")).toBeInTheDocument();
  });
  it("a school on Lead Desk (not for this business at all) still has no page", async () => {
    leadDesk();
    lf.readAvailability.mockResolvedValue(parseAvailability(SCHOOL));
    await expect(ProspectsPage(props())).rejects.toThrow("NEXT_NOT_FOUND");
  });
  it("in Telugu the card is in Telugu", async () => {
    leadDesk();
    langNow.v = "te";
    render(await ProspectsPage(props()));
    langNow.v = "en";
    expect(screen.getByRole("heading", { name: "కొత్త కస్టమర్లను వెతకడం AI Workforce లో భాగం" })).toBeInTheDocument();
    expect(screen.queryByText(/finds new businesses/)).toBeNull();
  });
});
