import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const openAccessAction = vi.fn();
const searchStaffAction = vi.fn();
vi.mock("@/app/staff/actions", () => ({
  openAccessAction: (...a: unknown[]) => openAccessAction(...a),
  searchStaffAction: (...a: unknown[]) => searchStaffAction(...a),
  staffSignOutAction: vi.fn(),
}));

import { overviewJson } from "@/lib/staff/staff-fixtures";
import { type Overview, parseOverview } from "@/lib/staff/types";

import { BusinessesCard, CostsCard, Kpis, PrivacyNote, SupportQueue, SystemHealth } from "./OverviewParts";
import { NoAccessScreen, SignedOutScreen, UnavailableScreen } from "./PlainScreens";
import { StaffSearch } from "./StaffSearch";
import { StaffSidebar, initialsOf } from "./StaffSidebar";

const NOW = new Date("2026-11-13T12:30:00.000Z");
const overview = (role: "owner" | "support" | "finance" = "owner", patch?: (o: Record<string, unknown>) => void): Overview => {
  const json = overviewJson(role, NOW);
  patch?.(json);
  return parseOverview(json);
};
const ME = { name: "Gowtham", role: "owner" as const, secondFactor: true };

afterEach(cleanup);
beforeEach(() => vi.clearAllMocks());

describe("the four figures", () => {
  it("draws MRR, active businesses (added this week, on free start), calls today (connected) and gross margin from the API's own text", () => {
    render(<Kpis kpis={overview().kpis} />);
    const mrr = document.querySelector('[data-kpi="mrr"]') as HTMLElement;
    expect(mrr).toHaveTextContent("MRR");
    expect(mrr).toHaveTextContent("₹2,41,800");
    expect(mrr).toHaveTextContent("▲ 12% this month");
    expect(document.querySelector('[data-kpi="active"]')).toHaveTextContent("128");
    expect(document.querySelector('[data-kpi="active"]')).toHaveTextContent("▲ 9 this week · 14 on free start");
    expect(document.querySelector('[data-kpi="active"]')?.textContent).not.toMatch(/trial/i);
    expect(document.querySelector('[data-kpi="calls"]')).toHaveTextContent("3,412");
    expect(document.querySelector('[data-kpi="calls"]')).toHaveTextContent("98.6% connected");
    const margin = document.querySelector('[data-kpi="margin"]') as HTMLElement;
    expect(margin).toHaveTextContent("41%");
    expect(margin).toHaveTextContent("costs counted since 11 Nov");
  });
  it("hides the MRR change while the API has none, and a falling one points down", () => {
    const hidden = overview("owner", (o) => ((o.kpis as { mrr: { change_percent: number | null } }).mrr.change_percent = null));
    render(<Kpis kpis={hidden.kpis} />);
    expect(document.querySelector('[data-kpi="mrr"] small')).toBeNull();
    expect(screen.queryByText(/this month/)).toBeNull();
    cleanup();
    const down = overview("owner", (o) => ((o.kpis as { mrr: { change_percent: number | null } }).mrr.change_percent = -3.5));
    render(<Kpis kpis={down.kpis} />);
    expect(document.querySelector('[data-kpi="mrr"]')).toHaveTextContent("▼ 3.5% this month");
  });
  it("draws no fake trend lines (the API sends no history)", () => {
    render(<Kpis kpis={overview().kpis} />);
    expect(document.querySelector("svg, polyline")).toBeNull();
  });
  it("does not draw a block the role does not get: support has no MRR and no margin (not zero), finance keeps them", () => {
    render(<Kpis kpis={overview("support").kpis} />);
    expect(document.querySelector('[data-kpi="mrr"]')).toBeNull();
    expect(document.querySelector('[data-kpi="margin"]')).toBeNull();
    expect(screen.queryByText("₹0")).toBeNull();
    expect(document.querySelectorAll(".sc-kp")).toHaveLength(2);
    cleanup();
    render(<Kpis kpis={overview("finance").kpis} />);
    expect(document.querySelectorAll(".sc-kp")).toHaveLength(4);
  });
  it("says so when there are no calls yet instead of a percentage", () => {
    const o = overview("owner", (j) => ((j.kpis as { calls_today: unknown }).calls_today = { count: 0, connected_percent: null }));
    render(<Kpis kpis={o.kpis} />);
    expect(document.querySelector('[data-kpi="calls"]')).toHaveTextContent("No calls yet");
  });
});

describe("the support queue", () => {
  it("lists tickets by priority with channel, waiting time, assignee, business and subject, and says how many more are open", () => {
    render(<SupportQueue queue={overview().supportQueue!} />);
    expect(screen.getByRole("heading", { name: "Support queue · 7 open" })).toBeInTheDocument();
    const rows = document.querySelectorAll('[data-part="ticket"]');
    expect(rows).toHaveLength(5);
    expect(rows[0]).toHaveTextContent("Urgent");
    expect(rows[0]).toHaveTextContent("Sri Venkateswara Sarees");
    expect(rows[0]).toHaveTextContent("Calls not reaching assistant since 10:15");
    expect(rows[0]).toHaveTextContent("Phone · 12 min");
    expect(rows[0]).toHaveTextContent("Ravi K.");
    expect(rows[1]).toHaveTextContent("High");
    expect(rows[1]).toHaveTextContent("WhatsApp · 34 min");
    expect(rows[1]).toHaveTextContent("—");
    expect(rows[2]).toHaveTextContent("Chat · 1 h");
    expect(rows[3]).toHaveTextContent("Email · 2 h");
    expect(rows[0].querySelector(".sc-pr")).toHaveAttribute("data-p", "urgent");
    expect(screen.getByText("2 more open")).toBeInTheDocument();
  });
  it("says nothing is waiting for an empty queue", () => {
    const o = overview("owner", (j) => (j.support_queue = { total_open: 0, items: [] }));
    render(<SupportQueue queue={o.supportQueue!} />);
    expect(screen.getByText("Nothing is waiting.")).toBeInTheDocument();
  });
});

describe("system health", () => {
  it("draws 'unknown' grey and says 'Not measured', never healthy", () => {
    render(<SystemHealth components={overview().health.components} />);
    const voice = screen.getByText("Voice (Cartesia)").closest(".sc-hr") as HTMLElement;
    expect(voice).toHaveAttribute("data-state", "unknown");
    expect(voice.querySelector("i")).toHaveAttribute("data-s", "unknown");
    expect(voice.querySelector("em")).toHaveTextContent("Not measured");
    expect(voice.querySelector("em")).toHaveAttribute("data-s", "unknown");
    expect(voice).not.toHaveTextContent("Healthy");
    expect(voice.querySelector('i[data-s="healthy"]')).toBeNull();
  });
  it("healthy parts say Healthy, a degraded part shows the API's note, a down part is red with its note", () => {
    const comps = overview("owner", (j) => {
      (j.health as { components: { state: string; note: string }[] }).components[3] = { key: "voice", label: "Voice", state: "down", note: "No audio since 10:02" } as never;
    }).health.components;
    render(<SystemHealth components={comps} />);
    expect(screen.getByText("API").closest(".sc-hr")?.querySelector("em")).toHaveTextContent("Healthy");
    expect(screen.getByText("WhatsApp webhook").closest(".sc-hr")?.querySelector("em")).toHaveTextContent("2 errors / 1h");
    const down = screen.getByText("Voice").closest(".sc-hr") as HTMLElement;
    expect(down.querySelector("i")).toHaveAttribute("data-s", "down");
    expect(down.querySelector("em")).toHaveTextContent("No audio since 10:02");
  });
});

describe("the businesses table", () => {
  const draw = () => render(<BusinessesCard rows={overview().businesses} total={128} nowIso={overview().generatedAt} />);
  it("has six rows: name and town, plan, status chip, balance, last activity and a View button", () => {
    draw();
    const rows = within(screen.getByRole("table")).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(6);
    expect(rows[0]).toHaveTextContent("Sri Lakshmi Silks");
    expect(rows[0]).toHaveTextContent("Dharmavaram");
    expect(rows[0]).toHaveTextContent("Sales Assistant");
    expect(rows[0]).toHaveTextContent("Live");
    expect(rows[0]).toHaveTextContent("₹1,550");
    expect(rows[0]).toHaveTextContent("2 min ago");
    expect(rows[3]).toHaveTextContent("In training");
    expect(rows[3]).toHaveTextContent("Yesterday");
    expect(rows[2]).toHaveTextContent("Paused");
    expect(rows[5]).toHaveTextContent("Not live");
    expect(rows[5]).toHaveTextContent("2 days ago");
    expect(screen.getAllByRole("button", { name: /^View / })).toHaveLength(6);
    expect(screen.getByText("128 in all")).toBeInTheDocument();
  });
  it("View never opens anything by itself: it asks for a reason first", () => {
    draw();
    fireEvent.click(screen.getByRole("button", { name: "View Lakshmi Textiles" }));
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("Why are you opening Lakshmi Textiles?");
    expect(within(dialog).getAllByRole("radio")).toHaveLength(6);
    expect(within(dialog).getAllByRole("radio").every((r) => !(r as HTMLInputElement).checked)).toBe(true);
    expect(openAccessAction).not.toHaveBeenCalled();
  });
  it("a reason is required: submitting without one shows an inline error and sends nothing", () => {
    draw();
    fireEvent.click(screen.getByRole("button", { name: "View Lakshmi Textiles" }));
    fireEvent.click(screen.getByRole("button", { name: "Open read-only view" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Choose a reason before you continue.");
    expect(openAccessAction).not.toHaveBeenCalled();
  });
  it("'something else' must say what", () => {
    draw();
    fireEvent.click(screen.getByRole("button", { name: "View Lakshmi Textiles" }));
    fireEvent.click(screen.getByRole("radio", { name: /Something else/ }));
    fireEvent.click(screen.getByRole("button", { name: "Open read-only view" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Say what for");
    expect(openAccessAction).not.toHaveBeenCalled();
  });
  it("with a reason it asks for the access, then opens the read-only support view", async () => {
    const assign = vi.fn();
    vi.stubGlobal("location", { ...window.location, assign });
    openAccessAction.mockResolvedValue({ ok: true, href: "/staff/businesses/00000000-0000-4000-8000-000000000003?access=a1" });
    draw();
    fireEvent.click(screen.getByRole("button", { name: "View Lakshmi Textiles" }));
    fireEvent.click(screen.getByRole("radio", { name: "A support ticket" }));
    fireEvent.click(screen.getByRole("button", { name: "Open read-only view" }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith("/staff/businesses/00000000-0000-4000-8000-000000000003?access=a1"));
    expect(openAccessAction).toHaveBeenCalledWith("00000000-0000-4000-8000-000000000003", "support_ticket", "");
    vi.unstubAllGlobals();
  });
  it.each([
    ["owner_ok_required", "The business owner must approve support access first."],
    ["reason_required", "Choose a reason before you continue."],
    ["no_access", "You do not have access to open this business."],
    ["unavailable", "Could not open the business. Try again."],
  ])("says %s inline, in plain words", async (failure, words) => {
    openAccessAction.mockResolvedValue({ ok: false, failure });
    draw();
    fireEvent.click(screen.getByRole("button", { name: "View Meenakshi Silks" }));
    fireEvent.click(screen.getByRole("radio", { name: "A privacy request" }));
    fireEvent.click(screen.getByRole("button", { name: "Open read-only view" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(words);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
  it("an ended staff session goes to its own page", async () => {
    const assign = vi.fn();
    vi.stubGlobal("location", { ...window.location, assign });
    openAccessAction.mockResolvedValue({ ok: false, failure: "signed_out" });
    draw();
    fireEvent.click(screen.getByRole("button", { name: "View Meenakshi Silks" }));
    fireEvent.click(screen.getByRole("radio", { name: "An incident or outage" }));
    fireEvent.click(screen.getByRole("button", { name: "Open read-only view" }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith("/staff/signed-out"));
    vi.unstubAllGlobals();
  });
  it("Escape and Cancel close the box", () => {
    draw();
    fireEvent.click(screen.getByRole("button", { name: "View Meenakshi Silks" }));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "View Meenakshi Silks" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("our costs this month", () => {
  it("names each provider with its role and cost, then revenue, costs and margin, and says since when costs are counted", () => {
    const o = overview();
    render(<CostsCard costs={o.costs!} since={o.kpis.margin!.costsRecordedSince} />);
    const rows = document.querySelectorAll(".sc-pv");
    expect(rows).toHaveLength(6);
    expect(rows[0]).toHaveTextContent("Voice (TTS)");
    expect(rows[0]).toHaveTextContent("Cartesia");
    expect(rows[0]).toHaveTextContent("₹38,900");
    expect(rows[3]).toHaveTextContent("Anthropic");
    expect(rows[5]).toHaveTextContent("Google");
    expect(rows[5]).toHaveTextContent("Lead search");
    expect(screen.getByText(/Revenue ₹2,41,800 · costs ₹83,900/)).toBeInTheDocument();
    expect(screen.getByText("₹1,57,900")).toBeInTheDocument();
    expect(screen.getByText(/Costs counted since 11 Nov/)).toHaveTextContent("This month's margin is partial.");
    // the longest bar is the biggest cost
    expect((rows[0].querySelector(".sc-pb i") as HTMLElement).style.width).toBe("100%");
    expect((rows[5].querySelector(".sc-pb i") as HTMLElement).style.width).toBe("0%");
  });
});

describe("the privacy note", () => {
  it("is the mock's sentence", () => {
    render(<PrivacyNote />);
    expect(screen.getByText(/Every view of a business is logged with a reason\./)).toHaveTextContent("The business can see each support view in its own activity log.");
  });
});

describe("the side menu", () => {
  it("has the Staff console tag, the eight areas, the badge counts, the role and 2FA", () => {
    render(<StaffSidebar me={ME} overview={overview()} keep="" active="overview" />);
    expect(screen.getByText("Staff console")).toBeInTheDocument();
    const nav = within(screen.getByRole("navigation", { name: "Staff areas" }));
    for (const label of ["Overview", "Businesses", "Support", "Money", "Usage & cost", "Health", "Compliance", "Audit log"]) expect(nav.getByText(label)).toBeInTheDocument();
    expect(nav.getByText("Support").closest(".sc-item")).toHaveTextContent("7");
    expect(nav.getByText("Health").closest(".sc-item")).toHaveTextContent("1");
    expect(nav.getByText("Compliance").closest(".sc-item")).toHaveTextContent("3");
    expect(nav.getByText("Businesses").closest(".sc-item")).toHaveTextContent("128");
    expect(nav.getByRole("link", { name: "Overview" })).toHaveAttribute("aria-current", "page");
    expect(nav.getAllByRole("link")).toHaveLength(1); // only the area that exists is a link
    expect(screen.getByText("OWNER")).toBeInTheDocument();
    expect(screen.getByText("2FA on")).toBeInTheDocument();
    expect(screen.getByText("Gowtham")).toBeInTheDocument();
  });
  it("shows SUPPORT and FINANCE, and keeps a mock ?role= on the link", () => {
    const { rerender } = render(<StaffSidebar me={{ ...ME, name: "Anu S." }} overview={overview("support")} keep="?role=support" active="overview" />);
    expect(screen.getByText("SUPPORT")).toBeInTheDocument();
    expect(screen.getByText("AS")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Overview" })).toHaveAttribute("href", "/staff?role=support");
    rerender(<StaffSidebar me={ME} overview={overview("finance")} keep="" active="overview" />);
    expect(screen.getByText("FINANCE")).toBeInTheDocument();
  });
  it("does not draw a badge that is zero", () => {
    const o = overview("owner", (j) => (j.badges = { businesses: 0, support_open: 0, health_issues: 0, compliance_open: 0 }));
    render(<StaffSidebar me={ME} overview={o} keep="" active="overview" />);
    expect(document.querySelectorAll(".sc-nav em")).toHaveLength(0);
  });
  it("initials", () => {
    expect([initialsOf("Gowtham"), initialsOf("Anu S."), initialsOf("  ")]).toEqual(["G", "AS", "?"]);
  });
});

describe("the plain screens", () => {
  it("a staff session that ended says so and offers to sign in again", () => {
    render(<SignedOutScreen />);
    expect(screen.getByRole("heading", { name: "Your staff session ended" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign in again" })).toBeInTheDocument();
  });
  it("no staff access never says why", () => {
    const { container } = render(<NoAccessScreen />);
    expect(screen.getByRole("heading", { name: "Staff access is required" })).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/not_staff|second_factor|forbidden|403|2FA|authenticator/i);
  });
  it("could not load is plain and offers to try again", () => {
    render(<UnavailableScreen />);
    expect(screen.getByRole("heading", { name: "The staff console could not load" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Try again" })).toHaveAttribute("href", "/staff");
  });
});

describe("the Cmd+K search", () => {
  beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
  afterEach(() => vi.useRealTimers());
  const type = async (text: string) => {
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: text } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
  };
  it("Cmd+K and Ctrl+K focus the box", () => {
    render(<StaffSearch />);
    fireEvent.keyDown(document, { key: "k", metaKey: true });
    expect(screen.getByRole("searchbox")).toHaveFocus();
    (document.activeElement as HTMLElement).blur();
    fireEvent.keyDown(document, { key: "K", ctrlKey: true });
    expect(screen.getByRole("searchbox")).toHaveFocus();
  });
  it("asks only for two or more characters, then lists businesses, invoices and tickets as returned (masked data stays masked)", async () => {
    searchStaffAction.mockResolvedValue({
      ok: true,
      results: {
        businesses: [{ tenantId: "00000000-0000-4000-8000-000000000001", name: "Sri Lakshmi Silks", town: "Dharmavaram", planName: "", status: "live", balanceText: "₹1,550", lastActivityAt: null }],
        invoices: [{ number: "S19-2026-0011", kind: "plan", businessName: "Sri Lakshmi Silks", totalText: "₹1,499", issuedAt: null }],
        tickets: [{ subject: "Quote amount wrong on WhatsApp", businessName: "Lakshmi Textiles", priority: "high", channel: "whatsapp" }],
      },
    });
    render(<StaffSearch />);
    await type("s");
    expect(searchStaffAction).not.toHaveBeenCalled();
    await type("lakshmi");
    expect(searchStaffAction).toHaveBeenCalledTimes(1);
    expect(searchStaffAction).toHaveBeenCalledWith("lakshmi");
    const results = within(await screen.findByText("Businesses").then((h) => h.parentElement as HTMLElement));
    expect(results.getByText("Sri Lakshmi Silks")).toBeInTheDocument();
    expect(screen.getByText("S19-2026-0011")).toBeInTheDocument();
    expect(screen.getByText("₹1,499")).toBeInTheDocument();
    expect(screen.getByText("Quote amount wrong on WhatsApp")).toBeInTheDocument();
    expect(screen.getByText("Lakshmi Textiles · WhatsApp · High")).toBeInTheDocument();
    // a business hit has the same View with a reason
    fireEvent.click(screen.getByRole("button", { name: "View Sri Lakshmi Silks" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
  it("says nothing was found, and says plainly when search fails", async () => {
    searchStaffAction.mockResolvedValueOnce({ ok: true, results: { businesses: [], invoices: [], tickets: [] } });
    render(<StaffSearch />);
    await type("zzz");
    expect(await screen.findByText("Nothing found")).toBeInTheDocument();
    searchStaffAction.mockResolvedValueOnce({ ok: false, failure: "unavailable" });
    await type("zzzz");
    expect(await screen.findByText("Search is not available right now")).toBeInTheDocument();
  });
});
