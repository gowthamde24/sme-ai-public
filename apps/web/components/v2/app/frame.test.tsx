import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/design/fonts", () => ({ v2FontClassName: () => "font-vars" }));
const nav = { pathname: "/app/tenants/22222222-2222-2222-2222-222222222222/orders", search: "" };
vi.mock("next/navigation", () => ({
  usePathname: () => nav.pathname,
  useSearchParams: () => new URLSearchParams(nav.search),
  useRouter: () => ({ refresh: vi.fn() }),
}));

import { AccountMenu } from "./AccountMenu";
import type { FrameData } from "./contract";
import { AppFrame } from "./AppFrame";
import { SideNav } from "./SideNav";
import { TabBar } from "./TabBar";
import type { Membership } from "./use-workspace";
import { WorkspaceSwitcher } from "./WorkspaceSwitcher";

const A = "22222222-2222-2222-2222-222222222222";
const B = "33333333-3333-3333-3333-333333333333";
const owner: Membership[] = [{ id: A, name: "Acme Silks", role: "owner" }, { id: B, name: "Second Shop", role: "viewer" }];
const only = (role: Membership["role"]): Membership[] => [{ id: A, name: "Acme Silks", role }];

beforeEach(() => {
  nav.pathname = `/app/tenants/${A}/orders`;
  nav.search = "";
  window.matchMedia = vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() });
});
afterEach(cleanup);

const none: FrameData = { plan: null, usage: null, waiting: null };
const loaded: FrameData = { plan: { plan: "pilot", workspace_limit: 1, trial_started_at: null }, usage: { spent_paise: 19000, cap_paise: 50000, left_paise: 31000 }, waiting: 5 };
const noSignOut = async () => undefined;
const side = (memberships: Membership[], frame = none, email: string | null = "o@example.test") => render(<SideNav memberships={memberships} frame={frame} email={email} signOut={noSignOut} />);
const bar = (memberships: Membership[], frame = none) => render(<TabBar memberships={memberships} frame={frame} email="o@example.test" signOut={noSignOut} />);

describe("SideNav", () => {
  it("lists the groups for the role, marks the current page, and links inside the workspace", () => {
    side(owner);
    const menu = screen.getByRole("navigation", { name: "Workspace menu" });
    expect(within(menu).getByRole("link", { name: "Orders" })).toHaveAttribute("aria-current", "page");
    expect(within(menu).getByRole("link", { name: "Orders" })).toHaveAttribute("href", `/app/tenants/${A}/orders`);
    for (const name of ["Work", "Your business", "Your team", "Connect"]) expect(within(menu).getByRole("group", { name })).toBeInTheDocument();
    expect(within(menu).getAllByRole("link").map((a) => a.textContent)).toEqual(["Today", "Leads", "Quotes", "Orders", "Customers", "Catalogue and prices", "Office", "Integrations"]);
  });
  it("the foot holds the AI usage card, Settings, Help (not available yet), the user card and Collapse menu", () => {
    side(owner, loaded);
    expect(screen.getByText("AI usage today")).toBeInTheDocument();
    expect(screen.getByText("₹190")).toBeInTheDocument();
    expect(screen.getByText("₹310 left today")).toBeInTheDocument();
    expect(screen.getByRole("meter", { name: "AI usage today" })).toHaveAttribute("aria-valuenow", "190");
    expect(screen.getByRole("link", { name: "Settings" })).toHaveAttribute("href", `/app/tenants/${A}/settings`);
    expect(screen.getByRole("button", { name: /^Help/ })).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByRole("button", { name: /^Help/ })).toHaveTextContent("Not available yet");
    expect(screen.getAllByText("o@example.test").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Collapse menu" })).toBeInTheDocument();
    expect(within(screen.getByRole("navigation", { name: "Workspace menu" })).getByRole("link", { name: /Today/ })).toHaveTextContent("Waiting for you: 5");
  });
  it("says 'Not available yet' for the plan, the AI usage and the count while they cannot be read, and invents nothing", () => {
    side(owner);
    expect(screen.getAllByText("Not available yet").length).toBeGreaterThanOrEqual(3); // the plan, the usage card, Help
    expect(screen.queryByText(/₹/)).toBeNull();
    expect(screen.queryByText(/Waiting for you/)).toBeNull();
    expect(screen.queryByRole("meter")).toBeNull();
  });
  it("shows the business and its plan on top, and no list of workspaces for one business", () => {
    side(only("owner"), loaded);
    expect(screen.getByText("Acme Silks")).toBeInTheDocument();
    expect(screen.getByText("Pilot plan")).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Your workspaces" })).toBeNull();
    expect(screen.queryByText("Switch workspace")).toBeNull();
  });
  it("a viewer is not offered what the plan hides from them, and a workspace not in the list gets no menu", () => {
    side(only("viewer"));
    for (const hidden of ["Quotes", "Orders", "Catalogue and prices", "Integrations"]) expect(screen.queryByRole("link", { name: hidden })).toBeNull();
    expect(screen.getByRole("link", { name: "Leads" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Settings" })).toBeInTheDocument();
    cleanup();
    nav.pathname = `/app/tenants/${B}`;
    side(only("owner"));
    // outside a workspace of the person's: only the two account pages, no workspace menu
    expect(within(screen.getByRole("navigation", { name: "Workspace menu" })).getAllByRole("link").map((a) => a.textContent)).toEqual(["All workspaces", "Security"]);
  });
  it("on the workspace home with a records tab, 'Customers' (or 'Leads') is current, not 'Today'", () => {
    nav.pathname = `/app/tenants/${A}`;
    nav.search = "tab=contacts";
    side(owner);
    expect(screen.getByRole("link", { name: "Customers" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Today" })).not.toHaveAttribute("aria-current");
  });
  it("collapses to a narrow rail and back, and remembers the choice in this browser", () => {
    window.localStorage.clear();
    side(owner);
    fireEvent.click(screen.getByRole("button", { name: "Collapse menu" }));
    expect(screen.getByRole("button", { name: "Expand menu" })).toBeInTheDocument();
    expect(screen.queryByText("AI usage today")).toBeNull();
    expect(window.localStorage.getItem("sme_menu_collapsed")).toBe("1");
    fireEvent.click(screen.getByRole("button", { name: "Expand menu" }));
    expect(screen.getByText("AI usage today")).toBeInTheDocument();
    expect(window.localStorage.getItem("sme_menu_collapsed")).toBe("0");
  });
});

describe("TabBar", () => {
  it("shows the five daily tabs and More, then the rest of the menu in a sheet that closes with Escape", () => {
    bar(owner, loaded);
    const quick = screen.getByRole("navigation", { name: "Quick menu" });
    expect(within(quick).getAllByRole("link").map((a) => a.textContent)).toEqual(["Waiting for you: 5Today", "Leads", "Quotes", "Orders", "Office"]);
    expect(within(quick).getByRole("link", { name: "Orders" })).toHaveAttribute("aria-current", "page");
    fireEvent.click(within(quick).getByRole("button", { name: "More" }));
    const dialog = screen.getByRole("dialog", { name: "All of the menu" });
    expect(within(dialog).getAllByRole("link").map((a) => a.textContent).slice(0, 4)).toEqual(["Customers", "Catalogue and prices", "Integrations", "Settings"]);
    expect(within(dialog).getByRole("link", { name: "Settings" })).toHaveAttribute("href", `/app/tenants/${A}/settings`);
    expect(within(dialog).getByText("AI usage today")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: /^Help/ })).toHaveAttribute("aria-disabled", "true");
    expect(within(dialog).getByRole("button", { name: "Sign out" })).toHaveAttribute("type", "submit");
    expect(within(dialog).getByRole("link", { name: /Second Shop/ })).toHaveAttribute("href", `/app/tenants/${B}`); // two businesses: the list is here
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });
  it("a viewer has only the tabs their role is offered, and one business has no list in the sheet", () => {
    bar(only("viewer"));
    const quick = screen.getByRole("navigation", { name: "Quick menu" });
    expect(within(quick).getAllByRole("link").map((a) => a.textContent)).toEqual(["Today", "Leads", "Office"]);
    fireEvent.click(within(quick).getByRole("button", { name: "More" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getAllByRole("link").map((a) => a.textContent)).toEqual(["Customers", "Settings"]);
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
    expect(screen.getByRole("link")).toHaveTextContent("Acme SilksPilot plan");
    expect(screen.queryByText("Switch workspace")).toBeNull();
  });
  it("two or more: the name opens the list, with each role, and goes to a workspace's HOME, never the same sub-page", () => {
    render(<WorkspaceSwitcher memberships={owner} plan={null} />);
    const list = screen.getByRole("list", { name: "Your workspaces" });
    expect(within(list).getByRole("link", { name: /Second Shop/ })).toHaveAttribute("href", `/app/tenants/${B}`);
    expect(within(list).getByRole("link", { name: /Second Shop/ })).toHaveTextContent("viewer");
    expect(screen.getByRole("link", { name: "All workspaces" })).toHaveAttribute("href", "/app");
  });
  it("outside a workspace it names the product and has no plan line", () => {
    nav.pathname = "/app";
    render(<WorkspaceSwitcher memberships={only("owner")} plan={loaded.plan} />);
    expect(screen.getByRole("link")).toHaveAttribute("href", "/app");
    expect(screen.queryByText("Pilot plan")).toBeNull();
  });
});

describe("AccountMenu", () => {
  it("is the user card: the mark, who is signed in and the role; it links to Security and signs out with the server action", () => {
    const signOut = vi.fn(async () => undefined);
    render(<AccountMenu email="owner@example.test" role="owner" signOut={signOut} several />);
    expect(screen.getAllByText("owner@example.test").length).toBeGreaterThan(0);
    expect(screen.getByText("OW")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Security" })).toHaveAttribute("href", "/app/security");
    expect(screen.getByRole("link", { name: "All workspaces" })).toHaveAttribute("href", "/app");
    expect(screen.getByRole("button", { name: "Sign out" })).toHaveAttribute("type", "submit");
  });
  it("offers 'All workspaces' only to someone who belongs to two or more", () => {
    render(<AccountMenu email="owner@example.test" signOut={async () => undefined} />);
    expect(screen.queryByRole("link", { name: "All workspaces" })).toBeNull();
  });
});

describe("AppFrame", () => {
  const frame = (memberships: Membership[] | null) =>
    render(
      <AppFrame lang="en" theme="dark" email="o@example.test" memberships={memberships} signOut={noSignOut}>
        <main id="page">The page</main>
      </AppFrame>,
    );
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
  it("with no memberships (the API could not be read) it draws the account part only and still shows the page", () => {
    nav.pathname = "/app";
    frame(null);
    expect(screen.queryByRole("link", { name: "Orders" })).toBeNull(); // no workspace menu: the two account pages only
    expect(within(screen.getByRole("navigation", { name: "Workspace menu" })).getAllByRole("link").map((a) => a.textContent)).toEqual(["All workspaces", "Security"]);
    expect(screen.getByText("The page")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Sign out" }).length).toBeGreaterThan(0);
  });
});
