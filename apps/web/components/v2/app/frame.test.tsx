import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/design/fonts", () => ({ v2FontClassName: () => "font-vars" }));
const nav = { pathname: "/app/tenants/22222222-2222-2222-2222-222222222222/orders", search: "" };
vi.mock("next/navigation", () => ({
  usePathname: () => nav.pathname,
  useSearchParams: () => new URLSearchParams(nav.search),
  useRouter: () => ({ refresh: vi.fn() }),
}));

// the lazy chunks of the menu (the More sheet, the foot's meters) are the real ones in a test
vi.mock("./LazyMoreSheet", async () => ({ MoreSheet: (await import("./MoreSheet")).MoreSheet }));
vi.mock("./LazyNavMeters", async () => ({ NavMeters: (await import("./NavMeters")).NavMeters }));

import { defaultWorkspacePack, otherPackIds, workspacePack } from "@/lib/packs/pack-test-kit";
import { packFrame } from "@/lib/packs/resolve";

import { AccountMenu } from "./AccountMenu";
import { NO_FRAME_DATA, FRAME_LOADING, type FrameData } from "./contract";
import { AppFrame } from "./AppFrame";
import { useLabels } from "./robust/labels-context";
import { FrameDataSlot } from "./frame-store";
import { SideNav } from "./SideNav";
import { TabBar } from "./TabBar";
import type { Membership } from "./use-workspace";
import { WorkspaceSwitcher } from "./WorkspaceSwitcher";
import { resetNavCountsForTests } from "./use-nav-counts";

/** The round mark the layout draws on the server (its letters here): a slot of the menu parts. */
const MARK = <span aria-hidden="true">OW</span>;

const A = "22222222-2222-2222-2222-222222222222";
const B = "33333333-3333-3333-3333-333333333333";
const owner: Membership[] = [{ id: A, name: "Acme Silks", role: "owner" }, { id: B, name: "Second Shop", role: "viewer" }];
const only = (role: Membership["role"]): Membership[] => [{ id: A, name: "Acme Silks", role }];

beforeEach(() => {
  nav.pathname = `/app/tenants/${A}/orders`;
  nav.search = "";
  window.matchMedia = vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() });
  resetNavCountsForTests();
  // the menu's numbers (C1's nav-counts) are not known unless a test says so
  vi.stubGlobal("fetch", vi.fn(async () => new Response("no", { status: 503 })));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
/** The nav-counts answer of the contract's example (docs/contracts/nav-counts.md). */
const COUNTS = { needs_you: 3, prospects_needing_owner: 2, new_leads: 12, live_calls: 1, unread_chats: 2, followups_due: 5, visits_today: 2, quotes_waiting: 1, ai_team_working: 4, call_minutes: { used: 412, total: 600 }, ai_usage: { used_paise: 6800, allowance_paise: 30000, period: "month" }, plan: "ai_workforce", as_of: "2026-11-05T11:42:07Z" };
const withCounts = (body: unknown = COUNTS) => vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ counts: (await import("@/lib/nav-counts")).parseNavCounts(body) }), { status: 200 })));

const none: FrameData = NO_FRAME_DATA;
const loaded: FrameData = { plan: { plan: "free_trial", workspace_limit: 1, trial_started_at: "2026-10-09T10:00:00Z" }, usage: { today_percent: 38, month_percent: 12, resets_at_today: "2026-10-10T18:30:00Z", resets_at_month: "2026-10-31T18:30:00Z", state: "ok" }, waiting: 5, ready: true, showUsage: true, live: false, logoUrl: null, pack: null };
const noSignOut = async () => undefined;
const side = (memberships: Membership[], frame = none, email: string | null = "o@example.test") => render(<SideNav memberships={memberships} frame={frame} email={email} signOut={noSignOut} mark={MARK} />);
const bar = (memberships: Membership[], frame = none) => render(<TabBar memberships={memberships} frame={frame} email="o@example.test" signOut={noSignOut} mark={MARK} />);

describe("SideNav", () => {
  it("lists the five groups for the role (sidebar v2), marks the current page, and links inside the workspace", () => {
    side(owner);
    const menu = screen.getByRole("navigation", { name: "Workspace menu" });
    expect(within(menu).getByRole("link", { name: "Orders" })).toHaveAttribute("aria-current", "page");
    expect(within(menu).getByRole("link", { name: "Orders" })).toHaveAttribute("href", `/app/tenants/${A}/orders`);
    expect(within(menu).getAllByRole("group").map((g) => g.getAttribute("aria-label"))).toEqual(["Overview", "Sell", "Business", "AI team", "Setup"]);
    expect(within(menu).getAllByRole("link").map((a) => a.textContent)).toEqual(["Today", "Reports", "Talk to assistant", "Leads", "Find customers", "Calls", "Chats", "Follow-ups", "Store visits", "Catalogue & stock", "Quotes", "Orders", "My AI team", "Train how it talks", "Phone number", "Settings"]);
  });
  it("the foot holds Top up · Plan & usage · Help, the user card and Collapse menu; no meter until the numbers are known; Today shows the frame's count meanwhile", () => {
    side(owner, loaded);
    expect(screen.queryByText("AI usage today")).toBeNull();
    expect(screen.queryByRole("meter")).toBeNull();
    expect(screen.getByRole("link", { name: "Settings" })).toHaveAttribute("href", `/app/tenants/${A}/settings`);
    expect(screen.getByRole("link", { name: "Help" })).toHaveAttribute("href", `/app/tenants/${A}/help`);
    expect(screen.getByRole("link", { name: "Top up" })).toHaveAttribute("href", `/app/tenants/${A}/settings?section=plan`);
    expect(screen.getByRole("link", { name: "Plan & usage" })).toBeInTheDocument();
    expect(screen.getAllByText("o@example.test").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Collapse menu" })).toBeInTheDocument();
    expect(document.querySelector('[data-nav-badge="m-today"]')).toHaveTextContent("5");
  });
  it("asks for the menu's numbers after the first paint and fills the badges and the two meters (Owner)", async () => {
    withCounts();
    const { act } = await import("@testing-library/react");
    side(only("owner"), loaded);
    expect(document.querySelector('[data-nav-badge="m-leads"]')).toBeNull(); // not before the answer
    await act(async () => {
      await new Promise((r) => setTimeout(r, 5));
    });
    expect(fetch).toHaveBeenCalledWith(`/app/tenants/${A}/nav-counts`, expect.objectContaining({ cache: "no-store" }));
    expect(document.querySelector('[data-nav-badge="m-today"]')).toHaveTextContent("5"); // 3 customers' things + 2 businesses
    expect(document.querySelector('[data-nav-badge="m-leads"]')).toHaveTextContent("12 new");
    expect(document.querySelector('[data-nav-badge="m-calls"]')).toHaveTextContent("1 live");
    expect(document.querySelector('[data-nav-badge="m-aiteam"]')).toHaveTextContent("4 working");
    expect(screen.getByRole("meter", { name: "Call minutes" })).toHaveAttribute("aria-valuetext", "412 / 600");
    expect(screen.getByRole("meter", { name: "AI usage" })).toHaveAttribute("aria-valuetext", "₹68 / ₹300");
  });
  it("a role the API gives no minutes or rupees to sees no meter, and no Top up", async () => {
    withCounts({ ...COUNTS, call_minutes: null, ai_usage: null });
    const { act } = await import("@testing-library/react");
    side(only("sales"), loaded);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 5));
    });
    expect(screen.queryByRole("meter")).toBeNull();
    expect(screen.queryByRole("link", { name: "Top up" })).toBeNull();
    expect(screen.getByRole("link", { name: "Help" })).toBeInTheDocument();
  });
  it("says 'Not available yet' for the plan and the count while they cannot be read, and invents nothing", () => {
    side(owner);
    expect(screen.getAllByText("Not available yet").length).toBeGreaterThanOrEqual(1); // the plan (the usage card is gone from the menu, Help is a link)
    expect(screen.queryByText(/₹/)).toBeNull();
    expect(screen.queryByText(/Waiting for you/)).toBeNull();
    expect(screen.queryByRole("meter")).toBeNull();
  });
  it("while the numbers are still being read it leaves the places empty instead of saying 'Not available yet'", () => {
    side(only("owner"), FRAME_LOADING);
    // the plan line is empty (Help is a link, it says nothing of the kind)
    expect(screen.queryAllByText("Not available yet")).toHaveLength(0);
  });
  it("draws no AI usage card anywhere in the menu or the More sheet, whatever the role", () => {
    side(only("sales"), { ...loaded, showUsage: false });
    expect(screen.queryByText("AI usage today")).toBeNull();
    cleanup();
    bar(only("owner"), loaded);
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    expect(screen.queryByText("AI usage today")).toBeNull();
  });
  it("shows what the workspace's layout brought in (the slot) over what the frame was given, and goes back when the slot goes", () => {
    side(only("owner"), FRAME_LOADING);
    const slot = render(<FrameDataSlot data={loaded} />);
    expect(screen.getByText("Free trial plan")).toBeInTheDocument();
    slot.unmount();
    expect(screen.queryByText("Free trial plan")).toBeNull();
  });
  it("shows the business's own logo (or its letters) instead of the product's mark, and 'Powered by' at the bottom", () => {
    side(only("owner"), { ...loaded, logoUrl: "https://s.example/logo.png?sig=1" });
    expect(document.querySelector('aside [data-business-logo="image"]')).toHaveAttribute("src", "https://s.example/logo.png?sig=1");
    expect(document.querySelector('aside [data-frame="powered-by"]')).toHaveTextContent("Powered by Stack19");
    cleanup();
    side(only("owner"), { ...loaded, logoUrl: null });
    expect(document.querySelector('aside [data-business-logo="letters"]')).toHaveTextContent("AS"); // Acme Silks
    expect(document.querySelector('aside [data-business-logo="image"]')).toBeNull();
  });
  it("shows the business and its plan on top, and no list of workspaces for one business", () => {
    side(only("owner"), loaded);
    expect(screen.getByText("Acme Silks")).toBeInTheDocument();
    expect(screen.getByText("Free trial plan")).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Your workspaces" })).toBeNull();
    expect(screen.queryByText("Switch workspace")).toBeNull();
  });
  it("a viewer is not offered what the plan hides from them, and a workspace not in the list gets no menu", () => {
    side(only("viewer"));
    for (const hidden of ["Chats", "Reports", "Calls", "Quotes"]) expect(screen.queryByRole("link", { name: hidden })).toBeNull();
    expect(screen.getByRole("link", { name: "Leads" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Settings" })).toBeInTheDocument();
    cleanup();
    nav.pathname = `/app/tenants/${B}`;
    side(only("owner"));
    // outside a workspace of the person's: only the two account pages, no workspace menu
    expect(within(screen.getByRole("navigation", { name: "Workspace menu" })).getAllByRole("link").map((a) => a.textContent)).toEqual(["All workspaces", "Security"]);
  });
  it("on the workspace home with a records tab, 'Leads' is current, not 'Today'", () => {
    nav.pathname = `/app/tenants/${A}`;
    nav.search = "tab=contacts";
    side(owner);
    expect(screen.getByRole("link", { name: "Leads" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Today" })).not.toHaveAttribute("aria-current");
  });
  it("collapses to a narrow rail and back, and remembers the choice in this browser", () => {
    window.localStorage.clear();
    side(owner);
    fireEvent.click(screen.getByRole("button", { name: "Collapse menu" }));
    expect(screen.getByRole("button", { name: "Expand menu" })).toBeInTheDocument();
    expect(window.localStorage.getItem("sme_menu_collapsed")).toBe("1");
    fireEvent.click(screen.getByRole("button", { name: "Expand menu" }));
    expect(screen.getByRole("button", { name: "Collapse menu" })).toBeInTheDocument();
    expect(window.localStorage.getItem("sme_menu_collapsed")).toBe("0");
  });
});

describe("TabBar", () => {
  it("shows Today, Leads, Chats and Calls with their badges, and More: the other rows in their groups, the meters' links, in a sheet that closes with Escape", () => {
    bar(owner, loaded);
    const quick = screen.getByRole("navigation", { name: "Quick menu" });
    expect(within(quick).getAllByRole("link").map((a) => a.textContent)).toEqual(["Today: 5Today", "Leads", "Chats", "Calls"]);
    expect(within(quick).getByRole("link", { name: "Calls" })).toHaveAttribute("href", `/app/tenants/${A}/office/live`);
    expect(within(quick).getByRole("button", { name: "More" }).className).toContain("text-brand-text"); // Orders (the page we are on) is in More
    fireEvent.click(within(quick).getByRole("button", { name: "More" }));
    const dialog = screen.getByRole("dialog", { name: "All of the menu" });
    expect(within(dialog).getAllByRole("group").map((g) => g.getAttribute("aria-label"))).toEqual(["Overview", "Sell", "Business", "AI team", "Setup"]);
    expect(within(dialog).getByRole("link", { name: "Orders" })).toHaveAttribute("aria-current", "page");
    expect(within(dialog).getByRole("link", { name: "Settings" })).toHaveAttribute("href", `/app/tenants/${A}/settings`);
    expect(within(dialog).queryByRole("link", { name: "Leads" })).toBeNull(); // a tab of the bar, not in the sheet
    expect(within(dialog).getByRole("link", { name: "Top up" })).toBeInTheDocument();
    expect(within(dialog).getByText("Powered by Stack19")).toBeInTheDocument(); // the small credit at the foot of the sheet (owner 31 Oct)
    expect(within(dialog).getByRole("link", { name: "Help" })).toHaveAttribute("href", `/app/tenants/${A}/help`);
    expect(within(dialog).getByRole("button", { name: "Sign out" })).toHaveAttribute("type", "submit");
    expect(within(dialog).getByRole("link", { name: /Second Shop/ })).toHaveAttribute("href", `/app/tenants/${B}`); // two businesses: the list is here
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });
  it("a viewer has only the tabs their role is offered, and one business has no list in the sheet", () => {
    bar(only("viewer"));
    const quick = screen.getByRole("navigation", { name: "Quick menu" });
    expect(within(quick).getAllByRole("link").map((a) => a.textContent)).toEqual(["Today", "Leads"]);
    fireEvent.click(within(quick).getByRole("button", { name: "More" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getAllByRole("link").map((a) => a.textContent)).toEqual(["Talk to assistant", "Follow-ups", "Store visits", "Catalogue & stock", "My AI team", "Settings", "Help"]);
    expect(within(dialog).queryByText("Your workspaces")).toBeNull();
  });
  it("draws nothing outside a workspace", () => {
    nav.pathname = "/app";
    const { container } = bar(owner);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("WorkspaceSwitcher", () => {
  it("one business: its name and plan, a plain link home, no switcher and no list", () => {
    render(<WorkspaceSwitcher memberships={only("owner")} plan={loaded.plan} />);
    expect(screen.getByRole("link")).toHaveAttribute("href", `/app/tenants/${A}`);
    expect(screen.getByRole("link")).toHaveTextContent("Acme SilksFree trial plan");
    expect(screen.queryByText("Switch workspace")).toBeNull();
  });
  it("two or more: the name opens the list, with each role, and goes to a workspace's HOME, never the same sub-page", () => {
    render(<WorkspaceSwitcher memberships={owner} plan={null} />);
    const list = screen.getByRole("list", { name: "Your workspaces" });
    expect(within(list).getByRole("link", { name: /Second Shop/ })).toHaveAttribute("href", `/app/tenants/${B}`);
    expect(within(list).getByRole("link", { name: /Second Shop/ })).toHaveTextContent("viewer");
    expect(screen.getByRole("link", { name: "All workspaces" })).toHaveAttribute("href", "/app");
  });
  it("in the demo video (still) it names the business alone: no plan line on camera", () => {
    render(<WorkspaceSwitcher memberships={only("owner")} plan={loaded.plan} still />);
    expect(screen.getByRole("link")).toHaveTextContent(/Acme Silks$/);
    expect(screen.queryByText("Free trial plan")).toBeNull();
  });
  it("outside a workspace it names the product and has no plan line", () => {
    nav.pathname = "/app";
    render(<WorkspaceSwitcher memberships={only("owner")} plan={loaded.plan} />);
    expect(screen.getByRole("link")).toHaveAttribute("href", "/app");
    expect(screen.queryByText("Free trial plan")).toBeNull();
  });
});

describe("AccountMenu", () => {
  it("is the user card: the mark, who is signed in and the role; it links to Security and signs out with the server action", () => {
    const signOut = vi.fn(async () => undefined);
    render(<AccountMenu email="owner@example.test" role="owner" signOut={signOut} several mark={MARK} />);
    expect(screen.getAllByText("owner@example.test").length).toBeGreaterThan(0);
    expect(screen.getByText("OW")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Security" })).toHaveAttribute("href", "/app/security");
    expect(screen.getByRole("link", { name: "All workspaces" })).toHaveAttribute("href", "/app");
    expect(screen.getByRole("button", { name: "Sign out" })).toHaveAttribute("type", "submit");
  });
  it("offers 'All workspaces' only to someone who belongs to two or more", () => {
    render(<AccountMenu email="owner@example.test" signOut={async () => undefined} mark={MARK} />);
    expect(screen.queryByRole("link", { name: "All workspaces" })).toBeNull();
  });
});

function ShowsLabel() {
  const labels = useLabels();
  return <p data-testid="label">{labels?.["problem.retry"] ? "Try again|" : "missing"}</p>;
}

describe("AppFrame", () => {
  const frame = (memberships: Membership[] | null) =>
    render(
      <AppFrame lang="en" theme="dark" email="o@example.test" memberships={memberships} signOut={noSignOut}>
        <main id="page">The page</main>
      </AppFrame>,
    );
  it("has a footer with the Privacy notice, the Terms and Cookie settings, after the page and above the phone's bottom bar (job BH)", () => {
    const { container } = frame(owner);
    const footer = container.querySelector('[data-frame="legal"]') as HTMLElement;
    expect(footer.tagName).toBe("FOOTER");
    expect(within(footer).getByRole("link", { name: "Privacy notice" })).toHaveAttribute("href", "/privacy");
    expect(within(footer).getByRole("link", { name: "Terms of Use" })).toHaveAttribute("href", "/terms");
    expect(within(footer).getByRole("button", { name: "Cookie settings" })).toBeInTheDocument();
    expect(container.querySelector("#main-content")!.compareDocumentPosition(footer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(footer.className).toContain("pb-[calc(5rem+72px)]"); // clear of the fixed bottom bar on a phone (4rem) and of the floating orb (56px + 16px)
    expect(container.querySelector("#main-content")!.contains(footer)).toBe(false);
  });
  it("holds the page in the one v2 wrapper: a skip link, one wrapper, one language and one theme control", () => {
    const { container } = frame(owner);
    expect(screen.getByRole("link", { name: /skip/i })).toHaveAttribute("href", "#main-content");
    expect(container.querySelector("#main-content")).toContainElement(container.querySelector("#page"));
    expect(container.querySelectorAll('[data-ui="v2"]')).toHaveLength(1); // one wrapper for the frame and the page
    expect(container.querySelector("#main-content")?.closest('[data-ui="v2"]')?.getAttribute("data-theme")).toBe("dark");
    expect(screen.getAllByRole("combobox")).toHaveLength(1); // the language select
    expect(screen.getByRole("button", { name: /light/i })).toBeInTheDocument();
    expect(container.querySelector("[data-frame='app']")).not.toBeNull();
  });
  it("keeps the page working when the world does not (job BW): the guard sits under the top bar, before the page, and the page gets the frame's words", () => {
    const { container } = render(
      <AppFrame lang="te" theme="dark" email="o@example.test" memberships={owner} signOut={noSignOut}>
        <ShowsLabel />
      </AppFrame>,
    );
    const shell = container.querySelector('[data-robust="shell"]') as HTMLElement;
    expect(shell).not.toBeNull();
    expect(shell.compareDocumentPosition(container.querySelector("#main-content")!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByTestId("label")).toHaveTextContent("Try again|"); // English dictionary key from the Telugu frame: present (a machine draft), not empty
  });
  it("with no memberships (the API could not be read) it draws the account part only and still shows the page", () => {
    nav.pathname = "/app";
    frame(null);
    expect(screen.queryByRole("link", { name: "Orders" })).toBeNull(); // no workspace menu: the two account pages only
    expect(within(screen.getByRole("navigation", { name: "Workspace menu" })).getAllByRole("link").map((a) => a.textContent)).toEqual(["All workspaces", "Security"]);
    expect(screen.getByText("The page")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Sign out" }).length).toBeGreaterThan(0);
  });
});

describe("the menu of a business type (job CL)", () => {
  // a business type that sells products and delivers them (its core tab is Orders & deliveries), built from the real pack file through the API's shapes
  const kind = otherPackIds().find((i) => workspacePack(i).coreTab === "orders")!;
  const real = packFrame(workspacePack(kind, "signup"), "en");
  const view = (over: Partial<import("./nav").PackFrame> = {}): FrameData => ({ ...NO_FRAME_DATA, pack: { ...real, ...over } });
  const names = () => within(screen.getByRole("navigation", { name: "Workspace menu" })).getAllByRole("link").map((a) => a.textContent);
  it("shows the pack's words, leaves out the modules it does not have, and offers what only a pack brings", () => {
    side(only("owner"), view());
    // Business follows the business type: a builder's merchant's rows, and none of a school's
    expect(names()).toEqual(expect.arrayContaining(["Quotes", "Trips", "Dues", "Reports"]));
    expect(names()).not.toContain("Fees");
    expect(names()).not.toContain("Admissions");
  });
  it("leaves out a part whose module is off", () => {
    side(only("owner"), view({ modules: real.modules.filter((m) => m !== "reports") }));
    expect(names()).not.toContain("Reports"); // its only page needs the module
  });
  it("marks a business type no real owner has reviewed under the name (a small badge in its accent), but not a reviewed one", () => {
    const { container, unmount } = side(only("owner"), view());
    expect(container.querySelector("[data-accent]")).toHaveTextContent(real.name);
    expect(container.querySelector("[data-accent]")).toHaveAttribute("data-accent", real.accent);
    unmount();
    const again = side(only("owner"), view({ validated: true }));
    expect(again.container.querySelector("[data-accent]")).toBeNull();
  });
  it("draws the phone's four tabs (the same words for every business type), then More with the rest", () => {
    bar(only("owner"), view());
    const tabs = within(screen.getByRole("navigation", { name: "Quick menu" }));
    expect(tabs.getAllByRole("link").map((a) => a.textContent)).toEqual(["Today", "Leads", "Chats", "Calls"]); // the same four for every business type
    expect(tabs.getByRole("button", { name: "More" })).toBeInTheDocument();
    fireEvent.click(tabs.getByRole("button", { name: "More" }));
    const sheet = within(screen.getByRole("dialog"));
    expect(sheet.getByRole("link", { name: "Trips" })).toBeInTheDocument();
    expect(sheet.getByRole("link", { name: "Reports" })).toBeInTheDocument();
    expect(sheet.queryByRole("link", { name: "Calls" })).toBeNull(); // it is a tab of the bar, not in the sheet
  });
  it("the default pack's frame is the menu the product always had, with the same four tabs", () => {
    const defaultView = { ...NO_FRAME_DATA, pack: packFrame(defaultWorkspacePack(), "en") };
    const first = side(owner);
    const plain = names();
    first.unmount();
    side(owner, defaultView);
    expect(names()).toEqual(plain);
    cleanup();
    bar(owner, defaultView);
    expect(within(screen.getByRole("navigation", { name: "Quick menu" })).getAllByRole("link").map((a) => a.textContent)).toEqual(["Today", "Leads", "Chats", "Calls"]);
  });
  it("is what the workspace's slot brought in that wins over what the first paint had (no flash of the wrong menu after the client takes over)", async () => {
    const { act } = await import("@testing-library/react");
    render(<SideNav memberships={only("owner")} frame={view()} email="o@example.test" signOut={noSignOut} mark={MARK} />);
    expect(names()).toContain("Reports");
    await act(async () => {
      render(<FrameDataSlot data={view({ modules: real.modules.filter((m) => m !== "reports") })} />);
    });
    expect(names()).not.toContain("Reports");
  });
});

describe("app v4: the menu is five groups (job-app-v4.md part 1)", () => {
  const V4: FrameData = { ...NO_FRAME_DATA, v4: true };
  it("the phone's bar is Today, Customers, Sales, AI team and Settings, with no More, and the current page's group is marked", () => {
    nav.pathname = `/app/tenants/${A}/orders`;
    bar(only("owner"), V4);
    const tabs = within(screen.getByRole("navigation", { name: "Quick menu" })).getAllByRole("link");
    expect(tabs.map((a) => a.getAttribute("data-bar-tab"))).toEqual(["v4-today", "v4-customers", "v4-sales", "v4-aiteam", "v4-settings"]);
    expect(screen.queryByRole("button", { name: "More" })).toBeNull();
    expect(tabs.find((a) => a.getAttribute("aria-current") === "page")?.getAttribute("data-bar-tab")).toBe("v4-sales");
  });
  it("the side menu is the same five rows, with no group headings; without v4 it is the menu as it was", () => {
    nav.pathname = `/app/tenants/${A}/followups`;
    side(only("owner"), V4);
    const rows = [...document.querySelectorAll("[data-nav-row]")].map((r) => r.getAttribute("data-nav-row"));
    expect(rows).toEqual(["v4-today", "v4-customers", "v4-sales", "v4-aiteam", "v4-settings"]);
    expect(document.querySelector('[data-nav-row="v4-customers"]')?.getAttribute("aria-current")).toBe("page");
    expect(screen.queryByRole("button", { name: /^Sell$/i })).toBeNull();
    cleanup();
    side(only("owner"));
    expect(document.querySelector("[data-nav-row^='v4-']")).toBeNull();
  });
});

describe("app v4: the phone's top bar (owner, 6 Nov 2026)", () => {
  it("keeps search, the bell and the person; the language, the theme and Help are in the person's menu on a phone", async () => {
    const { TopBar } = await import("./TopBar");
    nav.pathname = `/app/tenants/${A}/orders`;
    render(
      <TopBar memberships={only("owner")} email="o@example.test" signOut={noSignOut} mark={MARK} frame={{ ...NO_FRAME_DATA, v4: true }}>
        <span data-testid="lang-and-theme">language and theme</span>
      </TopBar>,
    );
    const extra = document.querySelector('[data-part="person-menu-extra"]');
    expect(extra).not.toBeNull();
    expect(within(extra as HTMLElement).getByTestId("lang-and-theme")).toBeInTheDocument();
    expect(within(extra as HTMLElement).getByRole("link", { name: "Help" })).toHaveAttribute("href", `/app/tenants/${A}/help`);
    cleanup();
    render(
      <TopBar memberships={only("owner")} email="o@example.test" signOut={noSignOut} mark={MARK} frame={NO_FRAME_DATA}>
        <span>language and theme</span>
      </TopBar>,
    );
    expect(document.querySelector('[data-part="person-menu-extra"]')).toBeNull();
  });
});
