import { describe, expect, it } from "vitest";

import { NAV, barItems, hrefOf, itemFor, visibleGroups, workspaceOf, type Role } from "./nav";

const T = "22222222-2222-2222-2222-222222222222";

/** The plan's table (docs/plans/workspace-v2-redesign-plan.md, 2.2, as simplified by Job X on 2026-10-09: six top-level groups), typed out by hand: the menu must agree with it. [owner, admin, sales, viewer] */
const PLAN: Record<string, [string, string, string, [boolean, boolean, boolean, boolean]][]> = {
  Today: [
    ["Home", "", "today", [true, true, true, true]],
    ["Follow-ups due", "/followups", "followups-due", [true, true, true, false]],
    ["Rules for follow-ups", "/followups/policy", "followups-policy", [true, true, true, false]],
  ],
  "Leads and orders": [
    ["Leads to look at", "/review", "review", [true, true, true, true]],
    ["Orders", "/orders", "orders", [true, true, true, false]],
  ],
  Customers: [
    ["Companies and contacts", "", "records", [true, true, true, true]],
    ["Add a customer", "/customers/new", "add-customer", [true, true, true, false]],
  ],
  "Catalogue and prices": [
    ["Item types", "/item-types", "item-types", [true, true, true, false]],
    ["Price list", "/price-list", "price-list", [true, true, false, false]],
    ["Add a product", "/products/new", "add-product", [true, true, false, false]],
    ["Quote policy", "/quote-policy", "quote-policy", [true, true, false, false]],
  ],
  Assistant: [
    ["Suggestions", "/suggestions", "suggestions", [true, true, true, true]],
    ["Agents", "/agents", "agents", [true, true, true, true]],
  ],
  "Privacy and safety": [
    ["Privacy and erasure", "/privacy", "privacy", [true, true, false, false]],
    ["Suppression keys", "/suppression", "suppression", [true, false, false, false]],
    ["Security (your account)", "/app/security", "security", [true, true, true, true]],
  ],
};
const ROLES: Role[] = ["owner", "admin", "sales", "viewer"];

describe("the menu table", () => {
  it("has exactly the groups and items of the plan, in order, with the same words", () => {
    expect(NAV.map((g) => g.label)).toEqual(Object.keys(PLAN));
    for (const g of NAV) expect(g.items.map((i) => [i.label, i.path, i.id]), g.label).toEqual(PLAN[g.label].map(([l, p, id]) => [l, p, id]));
  });

  it.each(ROLES)("offers a %s exactly the items the plan says", (role) => {
    const idx = ROLES.indexOf(role);
    const offered = visibleGroups(role).flatMap((g) => g.items.map((i) => i.label));
    const expected = Object.values(PLAN).flatMap((items) => items.filter((i) => i[3][idx]).map((i) => i[0]));
    expect(offered).toEqual(expected);
  });

  it("hides a group with nothing in it (a viewer has no Catalogue and prices)", () => {
    expect(visibleGroups("viewer").map((g) => g.label)).toEqual(["Today", "Leads and orders", "Customers", "Assistant", "Privacy and safety"]);
    expect(visibleGroups("sales").map((g) => g.label)).toEqual(["Today", "Leads and orders", "Customers", "Catalogue and prices", "Assistant", "Privacy and safety"]);
  });

  it("the phone's tabs are four daily pages, then More", () => {
    expect(barItems("owner").map((i) => i.id)).toEqual(["today", "followups-due", "review", "orders"]);
    expect(barItems("viewer").map((i) => i.id)).toEqual(["today", "review"]);
  });

  it("makes addresses inside the workspace, and the account page absolute", () => {
    const flat = NAV.flatMap((g) => g.items);
    expect(hrefOf(flat.find((i) => i.id === "orders")!, T)).toBe(`/app/tenants/${T}/orders`);
    expect(hrefOf(flat.find((i) => i.id === "records")!, T)).toBe(`/app/tenants/${T}?tab=companies`);
    expect(hrefOf(flat.find((i) => i.id === "today")!, T)).toBe(`/app/tenants/${T}`);
    expect(hrefOf(flat.find((i) => i.id === "security")!, T)).toBe("/app/security");
    expect(hrefOf(barItems("owner")[2], T)).toBe(`/app/tenants/${T}/review`);
  });

  it("every menu address is a real route of the app (no new URL)", () => {
    const routes = ["", "/review", "/customers/new", "/orders", "/followups", "/followups/policy", "/item-types", "/price-list", "/products/new", "/suggestions", "/agents", "/quote-policy", "/privacy", "/suppression"];
    for (const i of NAV.flatMap((g) => g.items)) if (!i.path.startsWith("/app")) expect(routes).toContain(i.path);
  });
});

describe("which item a page belongs to", () => {
  const at = (p: string, tab: string | null = null) => itemFor(p, tab)?.item.id ?? null;
  it("finds the top-level pages, the longest path first", () => {
    expect(at(`/app/tenants/${T}`)).toBe("today");
    expect(at(`/app/tenants/${T}`, "leads")).toBe("records");
    expect(at(`/app/tenants/${T}/followups`)).toBe("followups-due");
    expect(at(`/app/tenants/${T}/followups/policy`)).toBe("followups-policy");
    expect(at(`/app/tenants/${T}/orders/abc`)).toBe("orders");
    expect(at("/app/security")).toBe("security");
  });
  it("puts record pages under the item they are reached from, and says nothing for an unknown page", () => {
    expect(at(`/app/tenants/${T}/leads/x`)).toBe("review");
    expect(at(`/app/tenants/${T}/leads/x/followup`)).toBe("followups-due");
    expect(at(`/app/tenants/${T}/companies/x`)).toBe("records");
    expect(at(`/app/tenants/${T}/contacts/x/consent`)).toBe("records");
    expect(at(`/app/tenants/${T}/enquiries/x`)).toBe("orders");
    expect(at(`/app/tenants/${T}/requirements/x/questions`)).toBe("followups-due");
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
