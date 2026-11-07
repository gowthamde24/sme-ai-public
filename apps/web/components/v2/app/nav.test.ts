import { describe, expect, it } from "vitest";

import { FOOT, NAV, barItems, footItems, hrefOf, itemFor, visibleGroups, workspaceOf, type Role, MENU, MENU_V4, menuGroupsV4, v4Sections, v4ItemId, activeV4Id, tabsOf, menuGroupsV4D, activeV4dId, v4dRowOf, v4dSections, type PackFrame } from "./nav";

const T = "22222222-2222-2222-2222-222222222222";

/** The menu of the design-lab app (docs/plans/workspace-v2-redesign-plan.md, 2.2, as ported in Job AC batch C1), typed out by hand: the menu must agree with it. [owner, admin, sales, viewer] */
const PLAN: Record<string, [string, string, string, [boolean, boolean, boolean, boolean]][]> = {
  Work: [
    ["Today", "", "today", [true, true, true, true]],
    ["Talk to assistant", "/talk", "assistant", [true, true, true, true]],
    ["Live calls", "/office/live", "live", [true, true, true, false]],
    ["Leads", "/review", "leads", [true, true, true, true]],
    ["Follow-ups", "/followups", "followups", [true, true, true, true]],
    ["Quotes", "/quotes", "quotes", [true, true, true, false]],
    ["Store visits", "/visits", "visits", [true, true, true, true]],
    ["Orders", "/orders", "orders", [true, true, true, false]],
    ["Outbox", "/outbox", "outbox", [true, true, true, false]],
    ["Customer chats", "/chats", "chats", [true, true, true, false]],
    ["This week", "/report", "report", [true, true, false, false]],
    ["Customers", "", "customers", [true, true, true, true]],
    ["Find retailers", "/retailers", "retailers", [true, true, true, false]],
  ],
  Business: [
    ["Catalogue", "/catalogue", "sarees", [true, true, true, true]],
    ["Prices and products", "/item-types", "catalogue", [true, true, true, false]],
  ],
  "Your team": [
    ["Team", "/team", "team", [true, true, true, true]],
    ["Office", "/ai-team", "office", [true, true, true, true]],
    ["Train how it talks", "/ai-team/training", "train", [true, false, false, false]],
    ["Phone number", "/phone-number", "phone", [true, true, false, false]],
  ],
  Connect: [["Integrations", "/integrations", "integrations", [true, true, false, false]]],
};
const PLAN_FOOT: [string, string, string, [boolean, boolean, boolean, boolean]] = ["Settings", "/settings", "settings", [true, true, true, true]];
const ROLES: Role[] = ["owner", "admin", "sales", "viewer"];

describe("the menu table", () => {
  it("has exactly the groups and items of the plan, in order, with the same words", () => {
    expect(NAV.map((g) => g.label)).toEqual(Object.keys(PLAN));
    // the two items only a business type brings (job CL: Fees, Campaigns) are not part of the plan the product always had; they are pinned below
    for (const g of NAV) expect(g.items.filter((i) => !i.packOnly && !i.feature).map((i) => [i.label, i.path, i.id]), g.label).toEqual(PLAN[g.label].map(([l, p, id]) => [l, p, id]));
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
    expect(visibleGroups("viewer").map((g) => g.label)).toEqual(["Work", "Business", "Your team"]);
    expect(visibleGroups("viewer").find((g) => g.id === "business")?.items.map((i) => i.id)).toEqual(["sarees"]);
    expect(visibleGroups("sales").map((g) => g.label)).toEqual(["Work", "Business", "Your team"]);
    expect(visibleGroups("owner").map((g) => g.label)).toEqual(["Work", "Business", "Your team", "Connect"]);
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
  it("are Fees, Campaigns, Sites, Money (app v4) and Dues, each tied to a module, and absent from the menu of a workspace with no pack", () => {
    expect(flat.filter((i) => i.packOnly).map((i) => [i.id, i.path, i.module])).toEqual([["trips", "/orders/trips", "deliveries"], ["fees", "/fees", "fees"], ["students", "/students", "programmes"], ["admissions", "/admissions", "programmes"], ["announcements", "/announcements", "programmes"], ["campaigns", "/campaigns", "campaigns"], ["calllist", "/call-list", "campaigns"], ["sites", "/sites", "sites"], ["money", "/money", "dues"], ["dues", "/dues", "dues"], ["programmes", "/programmes", "programmes"]]);
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
    expect(ids).toEqual(flat.filter((i) => !i.module && !i.feature).map((i) => i.id));
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
    expect(at(`/app/tenants/${T}/followups`)).toBe("followups"); // job DQ part 0: Follow-ups is a page of Calls, not a corner of Leads
    expect(at(`/app/tenants/${T}/followups/policy`)).toBe("followups");
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

describe("an item another module replaces (job CO)", () => {
  const view = (modules: string[]) => ({ name: "X", accent: "sky_blue", validated: false, coreTab: "fees", modules, labels: {} });
  it("Dues is hidden where Fees is on (the fee ledger is the education screen), and shown where only dues is", () => {
    const ids = (modules: string[]) => visibleGroups("owner", view(modules)).flatMap((g) => g.items.map((i) => i.id));
    expect(ids(["today", "dues", "fees"])).not.toContain("dues");
    expect(ids(["today", "dues"])).toContain("dues");
    expect(ids(["today"])).not.toContain("dues");
  });
  it("Sites needs its module and is absent from the menu of a workspace with no pack", () => {
    expect(visibleGroups("owner", view(["today", "sites"])).flatMap((g) => g.items.map((i) => i.id))).toContain("sites");
    expect(visibleGroups("owner").flatMap((g) => g.items.map((i) => i.id))).not.toContain("sites");
  });
});

describe("app v4: five groups (job-app-v4.md part 1, owner 6 Nov 2026)", () => {
  const T = "11111111-1111-4111-8111-111111111111";
  it("Today, Customers, Sales, AI team and Settings, and every menu row is in exactly one of them (no page is lost)", () => {
    expect(MENU_V4.map((g) => g.id)).toEqual(["today", "customers", "sales", "aiteam", "settings"]);
    for (const m of MENU) expect(MENU_V4.filter((g) => g.sections.includes(m.id) || (g.quiet ?? []).includes(m.id)).length, m.id).toBe(1);
    // "Talk to assistant" is Today's orb and composer, not a tab (owner, 6 Nov 2026): it still marks Today
    expect(MENU_V4[0].sections).toEqual(["today", "reports"]);
    expect(activeV4Id(`/app/tenants/${T}/talk`, null)).toBe("v4-today");
  });
  it("Customers holds Leads, Calls, Chats, Follow-ups, Store visits and Find customers; Sales holds Quotes, Orders, Catalogue & stock and the money pages; AI team holds My AI team, Train how it talks and Phone number; Settings holds Lead sources", () => {
    const of = (id: string) => MENU_V4.find((g) => g.id === id)!.sections;
    expect(of("customers")).toEqual(["leads", "calls", "chats", "followups", "visits", "map", "find"]);
    expect(of("sales").slice(0, 5)).toEqual(["quotes", "orders", "money", "catalogue", "dues"]);
    expect(of("aiteam")).toEqual(["aiteam", "train", "phone"]);
    expect(of("settings")).toEqual(["sources", "settings"]);
  });
  it("the five rows a role is offered, each going to its first section's first page; a group with nothing offered is left out", () => {
    const owner = menuGroupsV4("owner");
    expect(owner).toHaveLength(1);
    expect(owner[0].label).toBe("");
    expect(owner[0].items.map((i) => i.id)).toEqual(["v4-today", "v4-customers", "v4-sales", "v4-aiteam", "v4-settings"]);
    expect(owner[0].items.every((i) => i.bar)).toBe(true);
    expect(hrefOf(owner[0].items[0], T)).toBe(`/app/tenants/${T}`);
    // a Viewer is not offered Quotes or Orders (writers only): Sales then opens on what a Viewer may see, or is not there at all
    const viewer = menuGroupsV4("viewer")[0].items;
    for (const row of viewer) expect(v4Sections(MENU_V4.find((g) => v4ItemId(g.id) === row.id)!, "viewer").length, row.id).toBeGreaterThan(0);
  });
  it("a page belongs to its group: Follow-ups and Store visits are Customers, Quotes is Sales, Train how it talks is AI team, Lead sources is Settings, Today is Today", () => {
    expect(activeV4Id(`/app/tenants/${T}`, null)).toBe("v4-today");
    expect(activeV4Id(`/app/tenants/${T}/followups`, null)).toBe("v4-customers");
    expect(activeV4Id(`/app/tenants/${T}/visits`, null)).toBe("v4-customers");
    expect(activeV4Id(`/app/tenants/${T}/quotes`, null)).toBe("v4-sales");
    expect(activeV4Id(`/app/tenants/${T}/ai-team/training`, null)).toBe("v4-aiteam");
    expect(activeV4Id(`/app/tenants/${T}/lead-sources`, null)).toBe("v4-settings");
    expect(activeV4Id(`/app/tenants/${T}/settings`, null)).toBe("v4-settings");
  });
  it("desktop (owner, 7 Nov): Overview, Customers, Sales, Grow, Team, then Settings; a row's other pages are tabs; a school's Orders row is its first page (Fees)", () => {
    const textiles = { name: "Textiles", accent: "x", validated: true, coreTab: "quotes", modules: ["today", "enquiries", "quotes", "orders", "visits", "office", "contacts", "catalogue", "inbox", "reports", "integrations", "lead_finder", "campaigns"], labels: {} } as PackFrame;
    const groups = menuGroupsV4D("owner", textiles);
    const rows = (g: string) => groups.find((x) => x.id === g)?.items.map((i) => i.label);
    expect(groups.map((g) => g.label)).toEqual(["Overview", "Customers", "Sales", "Grow", "Team", ""]);
    expect(rows("d-overview")).toEqual(["Today", "Reports"]);
    expect(rows("d-customers")).toEqual(["Leads", "Chats", "Calls"]);
    expect(rows("d-sales")).toEqual(["Quotes", "Orders", "Catalogue & stock"]);
    expect(rows("d-grow")).toEqual(["Lead Finder"]);
    expect(rows("d-team")).toEqual(["My AI team"]);
    expect(rows("d-last")).toEqual(["Settings"]);
    // each row carries the menu rows that mark it: Follow-ups and Store visits mark Leads; Train and Phone mark AI team; the assistant marks Today
    const items = groups.flatMap((g) => g.items);
    expect(items.find((i) => i.id === "m-leads")?.members).toEqual(["m-leads", "m-followups", "m-visits"]);
    expect(menuGroupsV4D("owner", { ...textiles, features: ["app_v4"] } as PackFrame).flatMap((g) => g.items).find((i) => i.id === "m-leads")?.members).toEqual(["m-leads", "m-followups", "m-visits", "m-map"]); // Map joins Leads while app v4 is on
    expect(items.find((i) => i.id === "m-aiteam")?.members).toEqual(["m-aiteam", "m-train", "m-phone"]);
    expect(items.find((i) => i.id === "m-today")?.members).toEqual(["m-today", "m-assistant"]);
    expect(activeV4dId(groups, "m-visits")).toBe("m-leads");
    expect(activeV4dId(groups, "m-train")).toBe("m-aiteam");
    expect(activeV4dId(groups, "settings")).toBe("settings");
    expect(activeV4dId(groups, null)).toBeNull();
    expect(items.find((i) => i.id === "v4d-finder")).toMatchObject({ label: "Lead Finder", count: "finder", icon: "find" });
    // the sections of Leads are its three menu rows; a viewer has no Orders (writers only), so no Orders row
    expect(v4dSections(v4dRowOf("followups")!, "owner", { ...textiles, features: ["app_v4"] }).map((s) => s.id)).toEqual(["m-leads", "m-followups", "m-visits", "m-map"]); // the map is a tab only while app v4 is on
    expect(v4dSections(v4dRowOf("followups")!, "owner", textiles).map((s) => s.id)).toEqual(["m-leads", "m-followups", "m-visits"]);
    expect(menuGroupsV4D("viewer", textiles).flatMap((g) => g.items).find((i) => i.members.includes("m-orders"))).toBeUndefined();
    // a school: no quotes or orders; its first money page leads the row
    const school = { ...textiles, modules: ["today", "enquiries", "fees", "admissions", "students", "announcements", "visits", "office", "contacts", "inbox", "reports", "integrations"] } as PackFrame;
    const sales = menuGroupsV4D("owner", school).find((g) => g.id === "d-sales");
    expect(sales?.items.map((i) => i.label)).not.toContain("Quotes");
    expect(sales?.items.map((i) => i.label)).toContain("Fees");
  });
  it("part 4: Phone calls is the first page of Calls only while app v4 is on, and then the pretend Live calls page is not offered", () => {
    const calls = MENU.find((m) => m.id === "calls")!;
    const view = (features: string[]) => ({ modules: ["office"], features }) as unknown as Parameters<typeof tabsOf>[2];
    expect(tabsOf(calls, "owner", view(["app_v4"])).map((t) => t.id)).toEqual(["phonecalls"]);
    expect(tabsOf(calls, "owner", view([])).map((t) => t.id)).toEqual(["live"]);
    expect(tabsOf(calls, "viewer", view(["app_v4"]))).toEqual([]); // a Viewer has no calls
    expect(activeV4Id(`/app/tenants/${T}/calls`, null)).toBe("v4-customers");
  });
});
