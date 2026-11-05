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

describe("the tabs of a menu row (sidebar v2)", () => {
  it("Leads: Leads and Customers, the page we are on marked, every tab a plain link inside the workspace", () => {
    nav.pathname = `/app/tenants/${A}`;
    nav.search = "tab=companies";
    draw("owner");
    expect(tabs().map((a) => a.textContent)).toEqual(["Leads", "Customers"]);
    expect(tabs().map((a) => a.getAttribute("href"))).toEqual([`/app/tenants/${A}/review`, `/app/tenants/${A}?tab=companies`]);
    expect(screen.getByRole("link", { name: "Customers" })).toHaveAttribute("aria-current", "page");
  });
  it("is the same strip on every page of the row: Chats, Catalogue & stock, Phone number, Settings", () => {
    nav.pathname = `/app/tenants/${A}/outbox`;
    draw("owner");
    expect(tabs().map((a) => a.textContent)).toEqual(["Customer chats", "Outbox"]);
    cleanup();
    nav.pathname = `/app/tenants/${A}/price-list`;
    draw("owner");
    expect(tabs().map((a) => a.textContent)).toEqual(["Catalogue", "Prices and products"]);
    cleanup();
    nav.pathname = `/app/tenants/${A}/integrations`;
    draw("owner");
    expect(tabs().map((a) => a.textContent)).toEqual(["Phone number", "Integrations"]);
    expect(screen.getByRole("link", { name: "Integrations" })).toHaveAttribute("aria-current", "page");
    cleanup();
    nav.pathname = `/app/tenants/${A}/team`;
    draw("sales");
    expect(tabs().map((a) => a.textContent)).toEqual(["Settings", "Team"]);
  });
  it("is not drawn when the row has only one page for this role (Today, Orders, Reports), or on a page no row holds", () => {
    for (const p of ["", "/orders", "/report", "/help"]) {
      nav.pathname = `/app/tenants/${A}${p}`;
      draw("owner");
      expect(screen.queryByRole("navigation"), p).toBeNull();
      cleanup();
    }
  });
  it("a business type brings its own words into the tabs (a school: its words for Leads and Customers)", () => {
    const school = otherPackIds().find((i) => workspacePack(i).coreTab === "fees")!;
    const frame = packFrame(workspacePack(school, "signup"), "en");
    nav.pathname = `/app/tenants/${A}`;
    nav.search = "tab=companies";
    draw("owner", frame);
    const names = tabs().map((a) => a.textContent);
    expect(names).toContain(frame.labels["nav.item.customers"] ?? "Customers");
    expect(names).not.toContain("Quotes");
  });
});
