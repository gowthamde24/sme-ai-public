import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/design/fonts", () => ({ v2FontClassName: () => "font-vars" }));
const nav = { pathname: "/app/tenants/22222222-2222-2222-2222-222222222222", search: "" };
vi.mock("next/navigation", () => ({
  usePathname: () => nav.pathname,
  useSearchParams: () => new URLSearchParams(nav.search),
  useRouter: () => ({ refresh: vi.fn() }),
}));

// the lazy chunks of the menu (the More sheet, the foot's meters) are the real ones in a test
vi.mock("./LazyMoreSheet", async () => ({ MoreSheet: (await import("./MoreSheet")).MoreSheet }));
vi.mock("./LazyNavMeters", async () => ({ NavMeters: (await import("./NavMeters")).NavMeters }));

import { NO_FRAME_DATA, type FrameData } from "./contract";
import { resetNavCountsForTests } from "./use-nav-counts";
import { SideNav } from "./SideNav";
import { TabBar } from "./TabBar";
import type { Membership } from "./use-workspace";

const A = "22222222-2222-2222-2222-222222222222";
const B = "33333333-3333-3333-3333-333333333333";
const one: Membership[] = [{ id: A, name: "Acme Silks", role: "owner" }];
const two: Membership[] = [...one, { id: B, name: "Second Shop", role: "owner" }];
const ds: FrameData = { ...NO_FRAME_DATA, ds: true, v4: true, balance: { text: "₹1,750", low: false, minutes: 350 }, assistant: "live" };
const MARK = <span aria-hidden="true">OW</span>;
const noSignOut = async () => undefined;
const side = (memberships = one, frame = ds) => render(<SideNav memberships={memberships} frame={frame} email="o@example.test" signOut={noSignOut} mark={MARK} />);
const menu = () => screen.getByRole("navigation", { name: "Workspace menu" });
const aside = () => document.querySelector("aside") as HTMLElement;

beforeEach(() => {
  nav.pathname = `/app/tenants/${A}`;
  nav.search = "";
  window.localStorage.clear();
  window.matchMedia = vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() });
  resetNavCountsForTests();
  vi.stubGlobal("fetch", vi.fn(async () => new Response("no", { status: 503 })));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("the design menu's icon rail (owner-approved boxy mock, 26 Nov 2026)", () => {
  it("has a 44px button at the top, next to the logo, that closes the menu to the icon rail and opens it again; its label flips", () => {
    side();
    const top = aside().querySelector('[data-part="menu-top"]') as HTMLElement;
    expect(within(top).getByRole("link", { name: "Stack19" })).toBeInTheDocument(); // the logo
    const close = within(top).getByRole("button", { name: "Close the sidebar" });
    expect(close.className).toContain("size-11");
    expect(aside()).not.toHaveAttribute("data-rail");
    expect(aside().className).toContain("w-[256px]");
    fireEvent.click(close);
    expect(aside()).toHaveAttribute("data-rail", "1");
    expect(aside().className).toContain("w-[72px]");
    expect(aside().className).toContain("[--dk-side-w:72px]"); // the desktop density rule's 232px yields to the rail
    expect(within(top).getByRole("button", { name: "Open the sidebar" })).toHaveAttribute("title", "Open the sidebar");
    fireEvent.click(within(top).getByRole("button", { name: "Open the sidebar" }));
    expect(aside()).not.toHaveAttribute("data-rail");
    expect(within(top).getByRole("button", { name: "Close the sidebar" })).toBeInTheDocument();
  });
  it("remembers the choice in this browser: a new render after closing it is the rail again, with no button state of its own", () => {
    const first = side();
    fireEvent.click(screen.getByRole("button", { name: "Close the sidebar" }));
    expect(window.localStorage.getItem("sme_menu_collapsed")).toBe("1");
    first.unmount();
    side();
    expect(aside()).toHaveAttribute("data-rail", "1");
    expect(screen.getByRole("button", { name: "Open the sidebar" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Open the sidebar" }));
    expect(window.localStorage.getItem("sme_menu_collapsed")).toBe("0");
  });
  it("is the full menu on a tablet until the person closes it (the design menu has no automatic rail)", () => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() });
    side();
    expect(aside()).not.toHaveAttribute("data-rail");
  });
  it("in the rail every row, the logo and the toggle say their word as a title AND a tooltip; the logo's symbol stays, the wordmark and the balance go", () => {
    side();
    expect(within(menu()).getByRole("link", { name: "Today" })).not.toHaveAttribute("data-tip"); // (the words are on the row while it is open)
    expect(aside().querySelector('[data-part="menu-logo"]')).toHaveTextContent("Stack19");
    expect(screen.getByText("₹1,750")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Close the sidebar" }));
    const rows = Array.from(aside().querySelectorAll<HTMLElement>("[data-nav-row]"));
    expect(rows.length).toBeGreaterThan(5);
    for (const row of rows) {
      expect(row.getAttribute("title")).toBeTruthy();
      expect(row.getAttribute("data-tip")).toBe(row.getAttribute("title"));
    }
    expect(within(menu()).getByRole("link", { name: "Today" })).toHaveAttribute("data-tip", "Today");
    const logo = aside().querySelector('[data-part="menu-logo"]') as HTMLElement;
    expect(logo.querySelector("svg, img")).not.toBeNull(); // the Stack19 symbol
    expect(logo).toHaveAttribute("aria-label", "Stack19");
    expect(logo).toHaveAttribute("data-tip", "Stack19");
    expect(logo.textContent).toBe(""); // no wordmark in the rail
    expect(screen.getByRole("button", { name: "Open the sidebar" })).toHaveAttribute("data-tip", "Open the sidebar");
    expect(screen.queryByText("₹1,750")).toBeNull(); // the balance box is hidden in the rail
  });
  it("the workspace mark keeps working in the rail: its name is the tooltip; with two businesses it still opens the list", () => {
    side();
    fireEvent.click(screen.getByRole("button", { name: "Close the sidebar" }));
    const mark = aside().querySelector('[data-tip="Acme Silks"]');
    expect(mark).not.toBeNull();
    expect(screen.getByRole("link", { name: "Acme Silks" })).toHaveAttribute("href", `/app/tenants/${A}`);
    cleanup();
    window.localStorage.clear();
    side(two);
    fireEvent.click(screen.getByRole("button", { name: "Close the sidebar" }));
    expect(aside().querySelector('[data-tip="Acme Silks"]')).not.toBeNull();
    expect(screen.getByText("Acme Silks: Switch workspace")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Second Shop/ })).toHaveAttribute("href", `/app/tenants/${B}`);
  });
});

describe("the design menu's rows", () => {
  it("the current row is marked (aria-current) and tinted in the brand colour, with a solid icon; the others are not", () => {
    side();
    const today = within(menu()).getByRole("link", { name: /Today/ });
    expect(today).toHaveAttribute("aria-current", "page");
    expect(today.className).toContain("bg-brand/10!");
    expect(today.className).toContain("text-brand-text!");
    expect(today.className).toContain("[&_svg]:fill-current/30");
    expect(today.querySelector('[aria-hidden="true"].absolute')).toBeNull(); // no bar at its edge
    const calls = within(menu()).getByRole("link", { name: /Calls/ });
    expect(calls).not.toHaveAttribute("aria-current");
    expect(calls.className).toContain("hover:bg-surface-2");
    expect(calls.className).toContain("min-h-11");
  });
  it("keeps the Live chip of My assistant", () => {
    side();
    expect(document.querySelector('[data-nav-badge="v6-myassistant"]')).toHaveTextContent("Live");
  });
  it("Settings is at the foot, above the balance box (not in the Setup group); the Setup group keeps its other rows in order", () => {
    side();
    const setup = within(menu()).getByRole("group", { name: "Setup" });
    expect(within(setup).getAllByRole("link").map((l) => l.textContent)).toEqual(["Catalogue", "Phone numbers", "Billing"]);
    expect(within(setup).queryByRole("link", { name: "Settings" })).toBeNull();
    expect(within(menu()).queryByRole("link", { name: "Settings" })).toBeNull();
    const foot = aside().querySelector('[data-part="menu-foot-rows"]') as HTMLElement;
    const settings = within(foot).getByRole("link", { name: "Settings" });
    expect(settings).toHaveAttribute("href", `/app/tenants/${A}/settings`);
    const balance = aside().querySelector('[data-part="balance-box"]') as HTMLElement;
    expect(foot.compareDocumentPosition(balance) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy(); // the balance box comes after Settings
    expect(menu().compareDocumentPosition(foot) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy(); // and Settings after the rows
  });
  it("Settings is the current row when the page is Settings, and in the rail it is an icon with a tooltip", () => {
    nav.pathname = `/app/tenants/${A}/settings`;
    side();
    const settings = within(aside().querySelector('[data-part="menu-foot-rows"]') as HTMLElement).getByRole("link", { name: "Settings" });
    expect(settings).toHaveAttribute("aria-current", "page");
    expect(settings.className).toContain("bg-brand/10!");
    fireEvent.click(screen.getByRole("button", { name: "Close the sidebar" }));
    expect(screen.getByRole("link", { name: "Settings" })).toHaveAttribute("data-tip", "Settings");
  });
  it("without the design system the menu is as before: Settings stays in its group and Collapse menu is at the foot", () => {
    side(one, { ...NO_FRAME_DATA });
    expect(aside().querySelector('[data-part="menu-top"]')).toBeNull();
    expect(screen.queryByRole("button", { name: "Close the sidebar" })).toBeNull();
    expect(screen.getByRole("button", { name: "Collapse menu" })).toBeInTheDocument();
  });
});

describe("the phone's More sheet", () => {
  it("has a 44px close button (X) that closes it, and Escape closes it too", () => {
    nav.pathname = `/app/tenants/${A}/orders`;
    render(<TabBar memberships={one} frame={NO_FRAME_DATA} email="o@example.test" signOut={noSignOut} mark={MARK} />);
    fireEvent.click(within(screen.getByRole("navigation", { name: "Quick menu" })).getByRole("button", { name: "More" }));
    const dialog = screen.getByRole("dialog", { name: "All of the menu" });
    const close = within(dialog).getByRole("button", { name: "Close the menu" });
    expect(close).toHaveFocus();
    expect(close.className).toContain("min-h-[44px]");
    expect(close.className).toContain("min-w-[44px]");
    fireEvent.click(close);
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(within(screen.getByRole("navigation", { name: "Quick menu" })).getByRole("button", { name: "More" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
