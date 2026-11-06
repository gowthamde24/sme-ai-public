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

describe("app v4: the sections of the page's group, above its own tabs (job-app-v4.md part 1)", () => {
  const v4 = (role: Membership["role"]) => render(<GroupTabs memberships={only(role)} frame={{ ...NO_FRAME_DATA, v4: true }} />);
  const sections = () => within(screen.getByRole("navigation", { name: "Sections" })).getAllByRole("link");
  it("a Follow-ups page shows Customers' sections, Follow-ups marked, each a plain link to its own first page", () => {
    nav.pathname = `/app/tenants/${A}/followups`;
    v4("owner");
    const links = sections();
    expect(links.map((a) => a.textContent)).toEqual(["Leads", "Calls", "Chats", "Follow-ups", "Store visits", "Find customers"].filter((x) => links.some((a) => a.textContent === x)));
    expect(links.find((a) => a.getAttribute("aria-current") === "page")?.textContent).toBe("Follow-ups");
    for (const a of links) expect(a.getAttribute("href")).toMatch(new RegExp(`^/app/tenants/${A}`));
  });
  it("a Quotes page shows Sales' sections; without v4 the same page has no sections row", () => {
    nav.pathname = `/app/tenants/${A}/quotes`;
    v4("owner");
    expect(sections().map((a) => a.textContent)).toContain("Quotes");
    cleanup();
    draw("owner");
    expect(screen.queryByRole("navigation", { name: "Sections" })).toBeNull();
  });
  it("one customer's own page (part 3) shows the sections, Leads marked, and no page tabs", () => {
    nav.pathname = `/app/tenants/${A}/customers/22222222-2222-4222-8222-222222222222`;
    v4("owner");
    expect(sections().find((a) => a.getAttribute("aria-current") === "page")?.textContent).toBe("Leads");
    expect(screen.getAllByRole("navigation")).toHaveLength(1);
    cleanup();
    nav.pathname = `/app/tenants/${A}/customers/new`;
    v4("owner");
    expect(screen.getAllByRole("navigation").length).toBeGreaterThan(1);
    cleanup();
    // one call's page (part 4): the sections only, too
    nav.pathname = `/app/tenants/${A}/calls/33333333-3333-4333-8333-333333333333`;
    v4("owner");
    expect(screen.getAllByRole("navigation")).toHaveLength(1);
  });
});
