import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const nav = { pathname: "/app/tenants/22222222-2222-2222-2222-222222222222/orders", search: "" };
vi.mock("next/navigation", () => ({ usePathname: () => nav.pathname, useSearchParams: () => new URLSearchParams(nav.search), useRouter: () => ({ refresh: vi.fn() }) }));

import { otherPackIds, workspacePack } from "@/lib/packs/pack-test-kit";
import { packFrame } from "@/lib/packs/resolve";

import { NO_FRAME_DATA } from "./contract";
import { GroupTabs } from "./GroupTabs";
import type { Membership } from "./use-workspace";

const A = "22222222-2222-2222-2222-222222222222";
const only = (role: Membership["role"]): Membership[] => [{ id: A, name: "Acme", role }];
const draw = (role: Membership["role"], pack = NO_FRAME_DATA.pack) => render(<GroupTabs memberships={only(role)} frame={{ ...NO_FRAME_DATA, pack }} />);
const tabs = () => within(screen.getByRole("navigation", { name: "Parts of this section" })).getAllByRole("link");

beforeEach(() => {
  nav.pathname = `/app/tenants/${A}/orders`;
  nav.search = "";
});
afterEach(cleanup);

describe("the tabs of a menu item (job DQ part 0)", () => {
  it("Sales: Quotes, Store visits and Orders, the page we are on marked, every tab a plain link inside the workspace", () => {
    draw("owner");
    expect(tabs().map((a) => a.textContent)).toEqual(["Quotes", "Store visits", "Orders"]);
    expect(tabs().map((a) => a.getAttribute("href"))).toEqual([`/app/tenants/${A}/quotes`, `/app/tenants/${A}/visits`, `/app/tenants/${A}/orders`]);
    expect(screen.getByRole("link", { name: "Orders" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Quotes" })).not.toHaveAttribute("aria-current");
  });
  it("is the same strip on every page of the item, and the Customers tabs are reached from the records tab of the home", () => {
    nav.pathname = `/app/tenants/${A}/outbox`;
    draw("owner");
    expect(tabs().map((a) => a.textContent)).toEqual(["Customer chats", "Outbox"]);
    cleanup();
    nav.pathname = `/app/tenants/${A}`;
    nav.search = "tab=companies";
    draw("owner");
    expect(tabs().map((a) => a.textContent)).toEqual(["Leads", "Customers", "Find retailers"]);
    expect(screen.getByRole("link", { name: "Customers" })).toHaveAttribute("aria-current", "page");
  });
  it("Settings holds Team, Office and Integrations: they are tabs of Settings, with the address of each page unchanged", () => {
    nav.pathname = `/app/tenants/${A}/team`;
    draw("owner");
    expect(tabs().map((a) => a.textContent)).toEqual(["Settings", "Team", "Office", "Integrations"]);
    expect(screen.getByRole("link", { name: "Team" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Integrations" })).toHaveAttribute("href", `/app/tenants/${A}/integrations`);
    cleanup();
    draw("sales");
    expect(tabs().map((a) => a.textContent)).toEqual(["Settings", "Team", "Office"]); // Integrations is for the Owner and Admin
  });
  it("is not drawn when the item has only one page for this role (Today, Reports, a viewer's Sales), or on a page no item holds", () => {
    nav.pathname = `/app/tenants/${A}`;
    draw("owner");
    expect(screen.queryByRole("navigation")).toBeNull();
    cleanup();
    nav.pathname = `/app/tenants/${A}/report`;
    draw("owner");
    expect(screen.queryByRole("navigation")).toBeNull();
    cleanup();
    nav.pathname = `/app/tenants/${A}/orders`;
    draw("viewer");
    expect(screen.queryByRole("navigation")).toBeNull();
    cleanup();
    nav.pathname = `/app/tenants/${A}/help`;
    draw("owner");
    expect(screen.queryByRole("navigation")).toBeNull();
  });
  it("a business type brings its own pages and its own words into the tabs (a school: Fees and the Admission board under Sales)", () => {
    const kind = otherPackIds().find((i) => workspacePack(i).coreTab === "orders")!;
    const real = packFrame(workspacePack(kind, "signup"), "en");
    draw("owner", real);
    expect(tabs().map((a) => a.textContent)).toContain(real.labels["nav.item.orders"]);
    cleanup();
    const school = otherPackIds().find((i) => workspacePack(i).coreTab === "fees")!;
    const frame = packFrame(workspacePack(school, "signup"), "en");
    nav.pathname = `/app/tenants/${A}/fees`;
    draw("owner", frame);
    const names = tabs().map((a) => a.textContent);
    expect(names).toContain(frame.labels["nav.item.fees"] ?? "Fees");
    expect(names).toContain("Admission board");
    expect(names).not.toContain("Quotes");
  });
});
