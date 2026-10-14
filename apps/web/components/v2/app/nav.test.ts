import { describe, expect, it } from "vitest";

import { FOOT, NAV, barItems, footItems, hrefOf, itemFor, visibleGroups, workspaceOf, type Role } from "./nav";

const T = "22222222-2222-2222-2222-222222222222";

/** The menu of the design-lab app (docs/plans/workspace-v2-redesign-plan.md, 2.2, as ported in Job AC batch C1), typed out by hand: the menu must agree with it. [owner, admin, sales, viewer] */
const PLAN: Record<string, [string, string, string, [boolean, boolean, boolean, boolean]][]> = {
  Work: [
    ["Today", "", "today", [true, true, true, true]],
    ["Leads", "/review", "leads", [true, true, true, true]],
    ["Quotes", "/quotes", "quotes", [true, true, true, false]],
    ["Store visits", "/visits", "visits", [true, true, true, true]],
    ["Orders", "/orders", "orders", [true, true, true, false]],
    ["Outbox", "/outbox", "outbox", [true, true, true, false]],
    ["Customer chats", "/chats", "chats", [true, true, true, false]],
    ["This week", "/report", "report", [true, true, false, false]],
    ["Customers", "", "customers", [true, true, true, true]],
    ["Find retailers", "/retailers", "retailers", [true, true, true, false]],
  ],
  "Your business": [
    ["Catalogue", "/catalogue", "sarees", [true, true, true, true]],
    ["Prices and products", "/item-types", "catalogue", [true, true, true, false]],
  ],
  "Your team": [
    ["Team", "/team", "team", [true, true, true, true]],
    ["Office", "/office", "office", [true, true, true, true]],
  ],
  Connect: [["Integrations", "/integrations", "integrations", [true, true, false, false]]],
};
const PLAN_FOOT: [string, string, string, [boolean, boolean, boolean, boolean]] = ["Settings", "/settings", "settings", [true, true, true, true]];
const ROLES: Role[] = ["owner", "admin", "sales", "viewer"];

describe("the menu table", () => {
  it("has exactly the groups and items of the plan, in order, with the same words", () => {
    expect(NAV.map((g) => g.label)).toEqual(Object.keys(PLAN));
    // the two items only a business type brings (job CL: Fees, Campaigns) are not part of the plan the product always had; they are pinned below
    for (const g of NAV) expect(g.items.filter((i) => !i.packOnly).map((i) => [i.label, i.path, i.id]), g.label).toEqual(PLAN[g.label].map(([l, p, id]) => [l, p, id]));
    expect(FOOT.map((i) => [i.label, i.path, i.id])).toEqual([[PLAN_FOOT[0], PLAN_FOOT[1], PLAN_FOOT[2]]]);
  });

  it.each(ROLES)("offers a %s exactly the items the plan says", (role) => {
    const idx = ROLES.indexOf(role);
    const offered = visibleGroups(role).flatMap((g) => g.items.map((i) => i.label));
    const expected = Object.values(PLAN).flatMap((items) => items.filter((i) => i[3][idx]).map((i) => i[0]));
    expect(offered).toEqual(expected);
    expect(footItems(role).map((i) => i.label)).toEqual(PLAN_FOOT[3][idx] ? ["Settings"] : []);
  });

  it("hides a group with nothing in it (a viewer has no Connect, a sales person no Connect); every role reads the saree Catalogue, so Your business stays for all", () => {
    expect(visibleGroups("viewer").map((g) => g.label)).toEqual(["Work", "Your business", "Your team"]);
    expect(visibleGroups("viewer").find((g) => g.id === "business")?.items.map((i) => i.id)).toEqual(["sarees"]);
    expect(visibleGroups("sales").map((g) => g.label)).toEqual(["Work", "Your business", "Your team"]);
    expect(visibleGroups("owner").map((g) => g.label)).toEqual(["Work", "Your business", "Your team", "Connect"]);
  });

  it("the phone's tabs are the daily pages (Today, Leads, Quotes, Visits, Office), then More (Orders is in More)", () => {
    expect(barItems("owner").map((i) => i.id)).toEqual(["today", "leads", "quotes", "visits", "office"]);
    expect(barItems("viewer").map((i) => i.id)).toEqual(["today", "leads", "visits", "office"]);
  });

  it("keeps the saree Catalogue in More on the phone: the bar is full at its five tabs, and these are the tabs for what needs a person today (job BC)", () => {
    expect(NAV.flatMap((g) => g.items).find((i) => i.id === "sarees")?.bar).toBeUndefined();
    expect(barItems("owner")).toHaveLength(5);
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

describe("the items only a business type brings (job CL)", () => {
  const flat = NAV.flatMap((g) => g.items);
  it("are Fees and Campaigns, each tied to a module, and absent from the menu of a workspace with no pack", () => {
    expect(flat.filter((i) => i.packOnly).map((i) => [i.id, i.path, i.module])).toEqual([["fees", "/fees", "fees"], ["campaigns", "/campaigns", "campaigns"]]);
    for (const role of ROLES) expect(visibleGroups(role).flatMap((g) => g.items.map((i) => i.id))).not.toEqual(expect.arrayContaining(["fees"]));
  });
  it("show when the pack has the module on, and only then", () => {
    const view = { name: "X", accent: "sky_blue", validated: false, coreTab: "fees", modules: ["today", "enquiries", "visits", "office", "fees"], labels: {} };
    const ids = visibleGroups("owner", view).flatMap((g) => g.items.map((i) => i.id));
    expect(ids).toContain("fees");
    expect(ids).not.toContain("campaigns");
    expect(barItems("owner", view).map((i) => i.id)).toEqual(["today", "leads", "fees", "visits", "office"]); // the core tab (Fees) takes the Quotes slot
  });
  it("every item that has a module is hidden when the pack does not have it", () => {
    const none = { name: "X", accent: "sky_blue", validated: false, coreTab: "fees", modules: ["today"], labels: {} };
    const ids = visibleGroups("owner", none).flatMap((g) => g.items.map((i) => i.id));
    expect(ids).toEqual(flat.filter((i) => !i.module).map((i) => i.id));
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
    expect(at(`/app/tenants/${T}/visits`)).toBe("visits");
    expect(at(`/app/tenants/${T}/outbox`)).toBe("outbox");
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
    for (const p of ["catalogue", "catalogue/new", "catalogue/abc/edit", "catalogue/abc"]) expect(at(`/app/tenants/${T}/${p}`), p).toBe("sarees");
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
