import { describe, expect, it } from "vitest";

import { FOOT, NAV, barItems, footItems, hrefOf, itemFor, visibleGroups, workspaceOf, type Role } from "./nav";

const T = "22222222-2222-2222-2222-222222222222";

/** The menu of the design-lab app (docs/plans/workspace-v2-redesign-plan.md, 2.2, as ported in Job AC batch C1), typed out by hand: the menu must agree with it. [owner, admin, sales, viewer] */
const PLAN: Record<string, [string, string, string, [boolean, boolean, boolean, boolean]][]> = {
  Work: [
    ["Today", "", "today", [true, true, true, true]],
    ["Leads", "/review", "leads", [true, true, true, true]],
    ["Quotes", "/quotes", "quotes", [true, true, true, false]],
    ["Orders", "/orders", "orders", [true, true, true, false]],
    ["Customers", "", "customers", [true, true, true, true]],
  ],
  "Your business": [["Catalogue and prices", "/item-types", "catalogue", [true, true, true, false]]],
  "Your team": [["Office", "/office", "office", [true, true, true, true]]],
  Connect: [["Integrations", "/integrations", "integrations", [true, true, false, false]]],
};
const PLAN_FOOT: [string, string, string, [boolean, boolean, boolean, boolean]] = ["Settings", "/settings", "settings", [true, true, true, true]];
const ROLES: Role[] = ["owner", "admin", "sales", "viewer"];

describe("the menu table", () => {
  it("has exactly the groups and items of the plan, in order, with the same words", () => {
    expect(NAV.map((g) => g.label)).toEqual(Object.keys(PLAN));
    for (const g of NAV) expect(g.items.map((i) => [i.label, i.path, i.id]), g.label).toEqual(PLAN[g.label].map(([l, p, id]) => [l, p, id]));
    expect(FOOT.map((i) => [i.label, i.path, i.id])).toEqual([[PLAN_FOOT[0], PLAN_FOOT[1], PLAN_FOOT[2]]]);
  });

  it.each(ROLES)("offers a %s exactly the items the plan says", (role) => {
    const idx = ROLES.indexOf(role);
    const offered = visibleGroups(role).flatMap((g) => g.items.map((i) => i.label));
    const expected = Object.values(PLAN).flatMap((items) => items.filter((i) => i[3][idx]).map((i) => i[0]));
    expect(offered).toEqual(expected);
    expect(footItems(role).map((i) => i.label)).toEqual(PLAN_FOOT[3][idx] ? ["Settings"] : []);
  });

  it("hides a group with nothing in it (a viewer has no Your business and no Connect, a sales person no Connect)", () => {
    expect(visibleGroups("viewer").map((g) => g.label)).toEqual(["Work", "Your team"]);
    expect(visibleGroups("sales").map((g) => g.label)).toEqual(["Work", "Your business", "Your team"]);
    expect(visibleGroups("owner").map((g) => g.label)).toEqual(["Work", "Your business", "Your team", "Connect"]);
  });

  it("the phone's tabs are the daily pages (Today, Leads, Quotes, Orders, Office), then More", () => {
    expect(barItems("owner").map((i) => i.id)).toEqual(["today", "leads", "quotes", "orders", "office"]);
    expect(barItems("viewer").map((i) => i.id)).toEqual(["today", "leads", "office"]);
  });

  it("makes addresses inside the workspace", () => {
    const flat = NAV.flatMap((g) => g.items);
    expect(hrefOf(flat.find((i) => i.id === "orders")!, T)).toBe(`/app/tenants/${T}/orders`);
    expect(hrefOf(flat.find((i) => i.id === "customers")!, T)).toBe(`/app/tenants/${T}?tab=companies`);
    expect(hrefOf(flat.find((i) => i.id === "today")!, T)).toBe(`/app/tenants/${T}`);
    expect(hrefOf(flat.find((i) => i.id === "leads")!, T)).toBe(`/app/tenants/${T}/review`);
    expect(hrefOf(FOOT[0], T)).toBe(`/app/tenants/${T}/settings`);
  });
});

describe("which item a page belongs to", () => {
  const at = (p: string, tab: string | null = null) => itemFor(p, tab)?.item.id ?? null;
  it("finds the top-level pages, the longest path first", () => {
    expect(at(`/app/tenants/${T}`)).toBe("today");
    expect(at(`/app/tenants/${T}`, "leads")).toBe("leads");
    expect(at(`/app/tenants/${T}`, "companies")).toBe("customers");
    expect(at(`/app/tenants/${T}`, "contacts")).toBe("customers");
    expect(at(`/app/tenants/${T}`, "products")).toBe("today");
    expect(at(`/app/tenants/${T}/orders/abc`)).toBe("orders");
    expect(at(`/app/tenants/${T}/quotes`)).toBe("quotes");
    expect(at(`/app/tenants/${T}/office`)).toBe("office");
    expect(at(`/app/tenants/${T}/integrations`)).toBe("integrations");
    expect(at("/app/security")).toBe("settings");
  });
  it("puts the pages that have no menu row of their own under the item they are reached from", () => {
    expect(at(`/app/tenants/${T}/followups`)).toBe("leads");
    expect(at(`/app/tenants/${T}/followups/policy`)).toBe("leads");
    expect(at(`/app/tenants/${T}/suggestions`)).toBe("leads");
    expect(at(`/app/tenants/${T}/leads/x`)).toBe("leads");
    expect(at(`/app/tenants/${T}/leads/x/followup`)).toBe("leads");
    expect(at(`/app/tenants/${T}/requirements/x/questions`)).toBe("leads");
    expect(at(`/app/tenants/${T}/enquiries/x`)).toBe("quotes");
    expect(at(`/app/tenants/${T}/companies/x`)).toBe("customers");
    expect(at(`/app/tenants/${T}/contacts/x/consent`)).toBe("customers");
    expect(at(`/app/tenants/${T}/customers/new`)).toBe("customers");
    for (const p of ["item-types", "price-list", "products/new", "quote-policy"]) expect(at(`/app/tenants/${T}/${p}`), p).toBe("catalogue");
    expect(at(`/app/tenants/${T}/agents`)).toBe("office");
    for (const p of ["privacy", "suppression", "settings"]) expect(at(`/app/tenants/${T}/${p}`), p).toBe("settings");
    expect(at(`/app/tenants/${T}/nothing-here`)).toBeNull();
    expect(at("/app")).toBeNull();
  });
  it("reads the workspace out of an address", () => {
    expect(workspaceOf(`/app/tenants/${T}/orders`)).toEqual({ tenantId: T, rest: "/orders" });
    expect(workspaceOf(`/app/tenants/${T}`)).toEqual({ tenantId: T, rest: "" });
    expect(workspaceOf("/app/tenants/not-an-id/orders")).toBeNull();
    expect(workspaceOf("/login")).toBeNull();
  });
});
