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
import { AppFrame } from "./AppFrame";
import { Crumbs } from "./Crumbs";
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

describe("SideNav", () => {
  it("lists the groups for the role, marks the current page, and links inside the workspace", () => {
    render(<SideNav memberships={owner} />);
    const menu = screen.getByRole("navigation", { name: "Workspace menu" });
    expect(within(menu).getByRole("link", { name: "Orders" })).toHaveAttribute("aria-current", "page");
    expect(within(menu).getByRole("link", { name: "Orders" })).toHaveAttribute("href", `/app/tenants/${A}/orders`);
    // a group that opens and closes is closed until opened (the group with the current page opens itself)
    const safety = within(menu).getByText("Privacy and safety").closest("details");
    expect(safety).not.toHaveAttribute("open");
    fireEvent.click(within(menu).getByText("Privacy and safety"));
    expect(safety).toHaveAttribute("open");
    expect(within(menu).getByRole("link", { name: "Suppression keys" })).toBeInTheDocument();
    expect(within(menu).queryByRole("link", { name: "Follow-ups due" })).toBeInTheDocument();
  });
  it("a viewer is not offered what the plan hides from them, and a workspace not in the list gets no menu", () => {
    render(<SideNav memberships={only("viewer")} />);
    for (const hidden of ["Orders", "Follow-ups due", "Item types", "Price list", "Quote policy", "Suppression keys", "Add a customer"]) expect(screen.queryByRole("link", { name: hidden })).toBeNull();
    expect(screen.getByRole("link", { name: "Leads to look at" })).toBeInTheDocument();
    cleanup();
    nav.pathname = `/app/tenants/${B}`;
    render(<SideNav memberships={only("owner")} />);
    // outside a workspace of the person's: only the two account pages, no workspace menu
    expect(screen.getAllByRole("link").map((a) => a.textContent)).toEqual(["All workspaces", "Security"]);
  });
  it("on the workspace home with a records tab, 'Companies and contacts' is current, not 'Home'", () => {
    nav.pathname = `/app/tenants/${A}`;
    nav.search = "tab=contacts";
    render(<SideNav memberships={owner} />);
    expect(screen.getByRole("link", { name: "Companies and contacts" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Home" })).not.toHaveAttribute("aria-current");
  });
});

describe("TabBar", () => {
  it("shows the four daily tabs and More, then the whole menu in a dialog that closes with Escape", () => {
    render(<TabBar memberships={owner} />);
    const bar = screen.getByRole("navigation", { name: "Quick menu" });
    expect(within(bar).getAllByRole("link").map((a) => a.textContent)).toEqual(["Today", "Follow-ups", "Leads", "Orders"]);
    expect(within(bar).getByRole("link", { name: "Orders" })).toHaveAttribute("aria-current", "page");
    fireEvent.click(within(bar).getByRole("button", { name: "More" }));
    const dialog = screen.getByRole("dialog", { name: "All of the menu" });
    fireEvent.click(within(dialog).getByText("Catalogue and prices")); // the groups that open and close start closed
    fireEvent.click(within(dialog).getByText("Privacy and safety"));
    expect(within(dialog).getByRole("link", { name: "Quote policy" })).toBeInTheDocument();
    expect(within(dialog).getByRole("link", { name: "Security (your account)" })).toHaveAttribute("href", "/app/security");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });
  it("a viewer has only the tabs their role is offered", () => {
    render(<TabBar memberships={only("viewer")} />);
    expect(within(screen.getByRole("navigation", { name: "Quick menu" })).getAllByRole("link").map((a) => a.textContent)).toEqual(["Today", "Leads"]);
  });
});

describe("Crumbs", () => {
  it("names the workspace, the group and the page, and on a deeper page offers one way back", () => {
    nav.pathname = `/app/tenants/${A}/orders/abc`;
    render(<Crumbs memberships={owner} />);
    expect(screen.getByRole("list", { name: "You are here" })).toHaveTextContent("Acme SilksLeads and ordersOrders");
    expect(screen.getAllByRole("link", { name: /Orders/ })[0]).toHaveAttribute("href", `/app/tenants/${A}/orders`);
  });
  it("draws no way back on a top-level page and nothing outside a workspace", () => {
    const { container, rerender } = render(<Crumbs memberships={owner} />);
    expect(screen.queryByRole("link", { name: "← Orders" })).toBeNull();
    nav.pathname = "/app";
    rerender(<Crumbs memberships={owner} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("WorkspaceSwitcher", () => {
  it("lists the memberships with their roles and goes to a workspace's HOME, never the same sub-page", () => {
    render(<WorkspaceSwitcher memberships={owner} />);
    const list = screen.getByRole("list", { name: "Your workspaces" });
    expect(within(list).getByRole("link", { name: /Second Shop/ })).toHaveAttribute("href", `/app/tenants/${B}`);
    expect(within(list).getByRole("link", { name: /Second Shop/ })).toHaveTextContent("viewer");
  });
  it("ends with ONE row, Add a workspace, that opens the page's create form in place and closes with Escape (focus goes back to the row)", () => {
    render(<WorkspaceSwitcher memberships={owner} addForm={<form aria-label="Create workspace form"><input aria-label="Workspace name" /></form>} />);
    expect(screen.queryByRole("form", { name: "Create workspace form" })).toBeNull(); // hidden until wanted
    const row = screen.getByRole("button", { name: "Add a workspace" });
    expect(row).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(row);
    expect(row).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("form", { name: "Create workspace form" })).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Workspace name" }), { key: "Escape" });
    expect(screen.queryByRole("form", { name: "Create workspace form" })).toBeNull();
    expect(row).toHaveFocus();
  });
  it("one workspace: still a pop-over (to add another), with the one workspace listed", () => {
    render(<WorkspaceSwitcher memberships={only("owner")} addForm={<p>FORM</p>} />);
    expect(within(screen.getByRole("list", { name: "Your workspaces" })).getByRole("link", { name: /Acme Silks/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add a workspace" })).toBeInTheDocument();
  });
  it("outside a workspace it says Workspaces", () => {
    nav.pathname = "/app";
    render(<WorkspaceSwitcher memberships={owner} />);
    expect(screen.getAllByText("Workspaces").length).toBeGreaterThan(0);
  });
});

describe("AccountMenu", () => {
  it("shows who is signed in, links to Security and signs out with the server action", () => {
    const signOut = vi.fn(async () => undefined);
    render(<AccountMenu email="owner@example.test" signOut={signOut} />);
    expect(screen.getByText("owner@example.test")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Security" })).toHaveAttribute("href", "/app/security");
    expect(screen.getByRole("link", { name: "All workspaces" })).toHaveAttribute("href", "/app");
    expect(screen.getByRole("button", { name: "Sign out" })).toHaveAttribute("type", "submit");
  });
});

describe("AppFrame", () => {
  const frame = (memberships: Membership[] | null) =>
    render(
      <AppFrame lang="en" theme="dark" email="o@example.test" memberships={memberships} signOut={async () => undefined}>
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
    frame(null);
    expect(screen.queryByRole("link", { name: "Orders" })).toBeNull(); // no workspace menu: the two account pages only
    expect(screen.getByRole("navigation", { name: "Workspace menu" })).toHaveTextContent("All workspacesSecurity");
    expect(screen.getByText("The page")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Sign out" }).length).toBeGreaterThan(0);
  });
});
