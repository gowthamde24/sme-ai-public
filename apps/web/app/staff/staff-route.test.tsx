import { cleanup, render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiAuthError, ApiContractError, ApiRequestError } from "@/lib/api/client";
import { NotFoundSignal, RedirectError, notFoundMock, redirectMock } from "@/test/helpers";

let path = "/staff";
const requireUser = vi.fn();
vi.mock("next/navigation", () => ({ redirect: (to: string) => redirectMock(to), notFound: () => notFoundMock(), useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("next/headers", () => ({ headers: async () => ({ get: (k: string) => (k === "x-sme-path" ? path : null) }) }));
vi.mock("@/lib/auth/session", () => ({ requireUser: () => requireUser() }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => ({ auth: { signOut: vi.fn() } }) }));
vi.mock("react", async (importOriginal) => ({ ...(await importOriginal<typeof import("react")>()), cache: <T,>(fn: T) => fn })); // one read per call in a test (the real cache is per request)
const apiMe = vi.fn();
const apiOverview = vi.fn();
const apiBusinessView = vi.fn();
const apiAccess = vi.fn();
const apiSearch = vi.fn();
vi.mock("@/lib/staff/api", () => ({ apiMe: (...a: unknown[]) => apiMe(...a), apiOverview: (...a: unknown[]) => apiOverview(...a), apiBusinessView: (...a: unknown[]) => apiBusinessView(...a), apiAccess: (...a: unknown[]) => apiAccess(...a), apiSearch: (...a: unknown[]) => apiSearch(...a) }));

import { openAccessAction, searchStaffAction } from "./actions";
import ConsoleLayout from "./(console)/layout";
import OverviewPage from "./(console)/page";
import SupportViewPage from "./(console)/businesses/[tenantId]/page";
import StaffLayout from "./layout";
import { overviewJson } from "@/lib/staff/staff-fixtures";
import { parseOverview } from "@/lib/staff/types";
import StaffSignedOutPage from "./signed-out/page";

const ID = "00000000-0000-4000-8000-000000000003";
const USER = { id: "u1", email: "staff@example.test", accessToken: "tok" };
const keep = { ...process.env };

/** The page the way Next draws it: the console's layout around the page. */
async function draw(page: () => Promise<ReactElement | null>) {
  const body = await page();
  render(await ConsoleLayout({ children: body }));
}
const props = (access?: string) => ({ params: Promise.resolve({ tenantId: ID }), searchParams: Promise.resolve(access ? { access } : {}) }) as never;

beforeEach(() => {
  vi.clearAllMocks();
  path = "/staff";
  requireUser.mockResolvedValue(USER);
  process.env.STAFF_CONSOLE = "mock";
});
afterEach(() => {
  cleanup();
  process.env = { ...keep };
});

describe("the flag", () => {
  it("off (unset or anything but 1 or mock) = the area is a plain 404, and nothing is read", async () => {
    for (const v of [undefined, "", "0", "true", "MOCK"]) {
      if (v === undefined) delete process.env.STAFF_CONSOLE;
      else process.env.STAFF_CONSOLE = v;
      expect(() => StaffLayout({ children: null })).toThrow(NotFoundSignal);
      await expect(OverviewPage()).rejects.toThrow(NotFoundSignal);
    }
    expect(requireUser).not.toHaveBeenCalled();
    expect(apiOverview).not.toHaveBeenCalled();
  });
  it("on = a wrapper scoped to the staff console, English, with the fonts; no shop menu", () => {
    const { container } = render(StaffLayout({ children: <p>x</p> }));
    const wrapper = container.querySelector("[data-staff]") as HTMLElement;
    expect(wrapper).toHaveAttribute("lang", "en");
    expect(wrapper).toHaveTextContent("x");
  });
});

describe("Overview, mock source", () => {
  it("draws the approved Overview: menu with Staff console, the four figures, queue, health, six businesses, costs and the privacy note", async () => {
    await draw(OverviewPage);
    expect(screen.getByRole("heading", { level: 1, name: "Overview" })).toBeInTheDocument();
    expect(screen.getByText("Staging · test data")).toBeInTheDocument();
    expect(screen.getByText("Staff console")).toBeInTheDocument();
    expect(screen.getByText("OWNER")).toBeInTheDocument();
    expect(screen.getByText("₹2,41,800", { selector: "b" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Support queue · 7 open" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "System health" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Our costs this month" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /^View / })).toHaveLength(6);
    expect(screen.getByText(/Every view of a business is logged with a reason/)).toBeInTheDocument();
    expect(screen.getByRole("searchbox")).toBeInTheDocument();
    expect(requireUser).toHaveBeenCalled();
    expect(apiOverview).not.toHaveBeenCalled(); // the sample, not the API
  });
  it("?role=support draws no MRR, margin or costs (absent, not zero); ?role=finance no queue", async () => {
    path = "/staff?role=support";
    await draw(OverviewPage);
    expect(screen.getByText("SUPPORT")).toBeInTheDocument();
    expect(screen.queryByText("MRR")).toBeNull();
    expect(screen.queryByText("Gross margin")).toBeNull();
    expect(screen.queryByRole("heading", { name: "Our costs this month" })).toBeNull();
    expect(screen.getByRole("heading", { name: /Support queue/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Overview" })).toHaveAttribute("href", "/staff?role=support");
    cleanup();
    path = "/staff?role=finance";
    await draw(OverviewPage);
    expect(screen.getByText("FINANCE")).toBeInTheDocument();
    expect(screen.getByText("MRR")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /Support queue/ })).toBeNull();
    expect(screen.getByRole("heading", { name: "Our costs this month" })).toBeInTheDocument();
  });
  it("a ?role= in the real-API mode is ignored (the API decides the role)", async () => {
    process.env.STAFF_CONSOLE = "1";
    path = "/staff?role=support";
    const { meJson, overviewJson } = await import("@/lib/staff/staff-fixtures");
    apiMe.mockResolvedValue((await import("@/lib/staff/types")).parseMe(meJson("finance")));
    apiOverview.mockResolvedValue((await import("@/lib/staff/types")).parseOverview(overviewJson("finance")));
    await draw(OverviewPage);
    expect(screen.getByText("FINANCE")).toBeInTheDocument();
    expect(apiMe).toHaveBeenCalledWith("tok");
  });
});

describe("Overview, real API source: what each refusal draws", () => {
  beforeEach(() => {
    process.env.STAFF_CONSOLE = "1";
    apiMe.mockResolvedValue({ name: "X", role: "owner", secondFactor: true });
  });
  const refuse = (status: number, code: string) => apiOverview.mockRejectedValue(new ApiRequestError(status, code, "Some detail the screen must not show."));
  it("401 session_ended sends to the staff 'session ended' page", async () => {
    apiOverview.mockRejectedValue(new ApiAuthError("The API rejected the session."));
    await expect(draw(OverviewPage)).rejects.toMatchObject({ to: "/staff/signed-out" });
    expect(RedirectError).toBeDefined();
  });
  it.each([
    [403, "not_staff"],
    [403, "second_factor_required"],
    [403, "forbidden"],
  ])("%s %s is one plain 'staff access is required' screen that leaks nothing", async (status, code) => {
    refuse(status, code);
    await draw(OverviewPage);
    expect(screen.getByRole("heading", { name: "Staff access is required" })).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/Some detail|not_staff|second_factor|forbidden|Overview|MRR/);
    expect(screen.queryByText("Staff console")).toBeNull(); // no menu either
  });
  it("any other failure is 'could not load', plain", async () => {
    refuse(500, "boom");
    await draw(OverviewPage);
    expect(screen.getByRole("heading", { name: "The staff console could not load" })).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/Some detail|boom/);
  });
  it("could not load shows a reference for support, the same one the server log carries with the reason (never the API's words on screen)", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    refuse(500, "boom");
    await draw(OverviewPage);
    const ref = document.querySelector('[data-part="reference"] code')?.textContent ?? "";
    expect(ref).toMatch(/^[0-9a-f]{8}$/);
    const lines = log.mock.calls.map((c) => JSON.parse(String(c[0])) as { ref: string; kind: string; status?: number });
    expect(lines.some((l) => l.ref === ref && l.kind === "api" && l.status === 500)).toBe(true);
    expect(document.body.textContent).not.toMatch(/boom/);
    log.mockRestore();
  });
  it("the first sign-in: me and overview are read one after the other and a failed read is tried once more (the first-login 409)", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const order: string[] = [];
    apiMe.mockImplementationOnce(async () => {
      order.push("me-1");
      throw new ApiRequestError(409, "conflict", "Conflict");
    });
    apiMe.mockImplementation(async () => {
      order.push("me-2");
      return { name: "X", role: "owner", secondFactor: true };
    });
    apiOverview.mockImplementation(async () => {
      order.push("overview");
      return parseOverview(overviewJson("owner", new Date()));
    });
    await draw(OverviewPage);
    expect(order.slice(0, 3)).toEqual(["me-1", "me-2", "overview"]);
    expect(screen.queryByRole("heading", { name: "The staff console could not load" })).toBeNull();
    log.mockRestore();
  });
  it("an answer that does not match the contract is 'could not load', never drawn", async () => {
    apiOverview.mockRejectedValue(new ApiContractError("Unexpected overview in a staff console response."));
    await draw(OverviewPage);
    expect(screen.getByRole("heading", { name: "The staff console could not load" })).toBeInTheDocument();
  });
  it("the staff 'session ended' page is outside the console's menu and has the sign-in button", () => {
    render(<StaffSignedOutPage />);
    expect(screen.getByRole("button", { name: "Sign in again" })).toBeInTheDocument();
    expect(screen.queryByRole("navigation")).toBeNull();
  });
});

describe("the support view", () => {
  it("without an access it says to open the business from the Overview (and has no data)", async () => {
    await draw(() => SupportViewPage(props()));
    expect(screen.getByRole("heading", { name: "Open this business from the Overview first" })).toBeInTheDocument();
    expect(screen.queryByText("Support view")).toBeNull();
  });
  it("with the access it draws the 'Support view' banner, the masked figures and only the owner's own actions (pause, goodwill credit, unmask)", async () => {
    await draw(() => SupportViewPage(props(`mock-access-${ID}`)));
    expect(screen.getByRole("heading", { level: 1, name: "Lakshmi Textiles" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Support view");
    expect(screen.getByRole("status")).toHaveTextContent("masked");
    expect(screen.getAllByText("P•••••• N••••").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/\+•• ••••• ••210/).length).toBeGreaterThan(0);
    expect(screen.getByRole("heading", { name: "Recent calls" })).toBeInTheDocument();
    const main = document.querySelector("main") as HTMLElement;
    for (const control of main.querySelectorAll("button, input:not([type=search]), select, textarea, form")) expect(control.closest('[data-part="support-banner"]')).toBeNull();
    expect(main.querySelectorAll("form, textarea, select")).toHaveLength(0);
    expect(screen.getByRole("link", { name: /Back to Overview/ })).toHaveAttribute("href", "/staff");
  });
  it("the real API: 409 owner_ok_required says the owner must approve first; 403 access_required says to open it first; 401 goes to sign in", async () => {
    process.env.STAFF_CONSOLE = "1";
    apiMe.mockResolvedValue({ name: "X", role: "owner", secondFactor: true });
    const { overviewJson } = await import("@/lib/staff/staff-fixtures");
    apiOverview.mockResolvedValue((await import("@/lib/staff/types")).parseOverview(overviewJson("owner")));
    apiBusinessView.mockRejectedValueOnce(new ApiRequestError(409, "owner_ok_required", "x"));
    await draw(() => SupportViewPage(props("a1")));
    expect(screen.getByRole("heading", { name: "The business owner must approve support access first" })).toBeInTheDocument();
    cleanup();
    apiBusinessView.mockRejectedValueOnce(new ApiRequestError(403, "access_required", "x"));
    await draw(() => SupportViewPage(props("a1")));
    expect(screen.getByRole("heading", { name: "Open this business from the Overview first" })).toBeInTheDocument();
    cleanup();
    apiBusinessView.mockRejectedValueOnce(new ApiAuthError("x"));
    await expect(draw(() => SupportViewPage(props("a1")))).rejects.toMatchObject({ to: "/staff/signed-out" });
    expect(apiBusinessView).toHaveBeenCalledWith("tok", ID, "a1");
  });
});

describe("the actions", () => {
  it("search needs 2 to 80 characters and returns the sample's hits", async () => {
    expect(await searchStaffAction("a")).toEqual({ ok: true, results: { businesses: [], invoices: [], tickets: [] } });
    expect(await searchStaffAction("x".repeat(81))).toMatchObject({ ok: true, results: { businesses: [] } });
    const found = await searchStaffAction("venkat");
    expect(found.ok && found.results.businesses.map((b) => b.name)).toEqual(["Sri Venkateswara Sarees"]);
  });
  it("opening a business: a reason from the list; the answer is the link of the support view, with the access", async () => {
    expect(await openAccessAction("not-an-id", "support_ticket", "")).toEqual({ ok: false, failure: "unavailable" });
    expect(await openAccessAction(ID, "whim", "")).toEqual({ ok: false, failure: "reason_required" });
    expect(await openAccessAction(ID, "other", "ab")).toEqual({ ok: false, failure: "reason_required" });
    const done = await openAccessAction(ID, "customer_asked", " they rang ");
    expect(done).toEqual({ ok: true, href: `/staff/businesses/${ID}?access=mock-access-${ID}` });
    path = "/staff?role=support";
    expect(await openAccessAction(ID, "incident", "")).toEqual({ ok: true, href: `/staff/businesses/${ID}?access=mock-access-${ID}&role=support` });
  });
  it("the real API gets the reason code and text, and a refusal comes back as a closed word", async () => {
    process.env.STAFF_CONSOLE = "1";
    apiAccess.mockResolvedValueOnce({ accessId: "acc 1", tenantId: ID, expiresAt: null });
    expect(await openAccessAction(ID, "other", "  a customer rang  ")).toEqual({ ok: true, href: `/staff/businesses/${ID}?access=acc+1` });
    expect(apiAccess).toHaveBeenCalledWith("tok", ID, "other", "a customer rang");
    apiAccess.mockRejectedValueOnce(new ApiRequestError(409, "owner_ok_required", "detail"));
    expect(await openAccessAction(ID, "support_ticket", "")).toEqual({ ok: false, failure: "owner_ok_required" });
    apiAccess.mockRejectedValueOnce(new ApiRequestError(422, "reason_required", "detail"));
    expect(await openAccessAction(ID, "support_ticket", "")).toEqual({ ok: false, failure: "reason_required" });
    apiAccess.mockRejectedValueOnce(new ApiAuthError("x"));
    expect(await openAccessAction(ID, "support_ticket", "")).toEqual({ ok: false, failure: "signed_out" });
  });
});
