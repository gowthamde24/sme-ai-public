import { describe, expect, it } from "vitest";

import { FOOT, MENU, MENU_ITEMS, NAV, activeMenuId, hrefOf, menuBar, menuFoot, menuGroups, menuItemId, menuOfPage, tabsOf, type PackFrame, type Role } from "./nav";

const T = "22222222-2222-2222-2222-222222222222";
const ROLES: Role[] = ["owner", "admin", "sales", "viewer"];
const pack = (modules: string[], coreTab: string): PackFrame => ({ name: "X", accent: "sky_blue", validated: true, coreTab, modules, labels: {} });
/** The modules of the three business types (packages/packs): what each one switches on. */
const TEXTILES = pack(["today", "enquiries", "quotes", "orders", "visits", "office", "contacts", "catalogue", "inbox", "reports", "integrations", "lead_finder"], "quotes");
const CONSTRUCTION = pack(["today", "enquiries", "quotes", "orders", "visits", "office", "contacts", "materials", "sites", "dues", "campaigns", "inbox", "reports", "integrations", "lead_finder"], "orders");
const EDUCATION = pack(["today", "enquiries", "visits", "office", "contacts", "fees", "programmes", "campaigns", "inbox", "reports", "integrations"], "fees");
const PACKS: [string, PackFrame | null][] = [["no business type", null], ["textiles", TEXTILES], ["construction", CONSTRUCTION], ["education", EDUCATION]];

describe("the seven-item menu (job DQ part 0, owner decision of 26 Oct)", () => {
  it("is Today, Customers, Chats, Calls, Sales, Catalogue and Reports, with Settings below them, in that order", () => {
    expect(MENU_ITEMS.map((m) => m.label)).toEqual(["Today", "Customers", "Chats", "Calls", "Sales", "Catalogue", "Reports"]);
    expect(MENU_ITEMS).toHaveLength(7);
    expect(MENU.find((m) => m.id === "settings")?.members).toEqual(["settings", "team", "office", "integrations", "lead-sources"]);
    expect(FOOT.map((i) => i.id)).toEqual(["settings"]);
  });

  it.each(ROLES.flatMap((r) => PACKS.map(([n, p]) => [r, n, p] as const)))("%s, %s: at most seven items, and Settings below", (role, _n, view) => {
    const items = menuGroups(role, view).flatMap((g) => g.items);
    expect(items.length).toBeLessThanOrEqual(7);
    expect(items.length).toBeGreaterThanOrEqual(1);
    expect(menuFoot(role, view).map((i) => i.id)).toEqual(["settings"]);
    expect(items.every((i) => i.id.startsWith("m-"))).toBe(true);
  });

  it("every page of the old menu is a tab of exactly one item: nothing is lost, nothing is twice", () => {
    const pages = [...NAV.flatMap((g) => g.items), ...FOOT].map((i) => i.id);
    const members = MENU.flatMap((m) => m.members);
    expect(new Set(members).size).toBe(members.length);
    expect([...members].sort()).toEqual([...pages].sort());
    for (const id of pages) expect(menuOfPage(id), id).not.toBeNull();
  });

  it("an item goes to the first page the person is offered, and is left out when they are offered none", () => {
    const href = (role: Role, view: PackFrame | null, id: string) => hrefOf(menuGroups(role, view).flatMap((g) => g.items).find((i) => i.id === id)!, T);
    expect(href("owner", null, "m-today")).toBe(`/app/tenants/${T}`);
    expect(href("owner", null, "m-customers")).toBe(`/app/tenants/${T}/review`);
    expect(href("owner", null, "m-sales")).toBe(`/app/tenants/${T}/quotes`);
    expect(href("owner", EDUCATION, "m-sales")).toBe(`/app/tenants/${T}/visits`); // a school has no Quotes: Store visits, then Fees, then the Admission board
    expect(href("owner", null, "m-reports")).toBe(`/app/tenants/${T}/report`);
    // a viewer has no Reports, no Chats, no Calls' call list ... and so no Reports item
    const viewer = menuGroups("viewer", TEXTILES).flatMap((g) => g.items).map((i) => i.id);
    expect(viewer).not.toContain("m-reports");
    expect(viewer).not.toContain("m-chats");
    expect(viewer).toContain("m-today");
  });

  it("Sales holds the quotes, visits and orders of a trader, and the fees and admissions of a school", () => {
    const sales = MENU.find((m) => m.id === "sales")!;
    expect(tabsOf(sales, "owner", TEXTILES).map((p) => p.id)).toEqual(["quotes", "visits", "orders"]);
    expect(tabsOf(sales, "owner", CONSTRUCTION).map((p) => p.id)).toEqual(["quotes", "visits", "orders", "dues"]);
    expect(tabsOf(sales, "owner", EDUCATION).map((p) => p.id)).toEqual(["visits", "fees", "admissions"]);
    expect(tabsOf(sales, "sales", TEXTILES).map((p) => p.id)).toEqual(["quotes", "visits", "orders"]);
    expect(tabsOf(sales, "viewer", TEXTILES).map((p) => p.id)).toEqual(["visits"]);
  });

  it("Customers, Chats, Calls, Catalogue and Settings hold their pages", () => {
    const tabs = (id: string, role: Role, view: PackFrame | null) => tabsOf(MENU.find((m) => m.id === id)!, role, view).map((p) => p.id);
    expect(tabs("customers", "owner", TEXTILES)).toEqual(["leads", "customers", "retailers"]);
    expect(tabs("customers", "owner", CONSTRUCTION)).toEqual(["leads", "customers", "retailers", "sites"]);
    expect(tabs("customers", "owner", EDUCATION)).toEqual(["leads", "customers", "retailers", "students"].filter((i) => i !== "retailers"));
    expect(tabs("chats", "owner", TEXTILES)).toEqual(["chats", "outbox"]);
    expect(tabs("chats", "owner", EDUCATION)).toEqual(["chats", "outbox", "announcements"]);
    expect(tabs("calls", "owner", TEXTILES)).toEqual(["followups"]);
    expect(tabs("calls", "owner", CONSTRUCTION)).toEqual(["followups", "calllist", "campaigns"]);
    expect(tabs("catalogue", "owner", TEXTILES)).toEqual(["sarees", "catalogue"]);
    expect(tabs("settings", "owner", TEXTILES)).toEqual(["settings", "team", "office", "integrations"]);
    expect(tabs("settings", "sales", TEXTILES)).toEqual(["settings", "team", "office"]); // Integrations is for the Owner and Admin
  });

  it("the phone's bar is Today, Customers, Chats and Sales; Calls, Catalogue, Reports and Settings are in More", () => {
    expect(menuBar("owner", TEXTILES).map((i) => i.id)).toEqual(["m-today", "m-customers", "m-chats", "m-sales"]);
    expect(menuBar("viewer", TEXTILES).map((i) => i.id)).toEqual(["m-today", "m-customers", "m-sales"]);
  });

  it("every page belongs to the item it is a tab of (the marker stays right), and a page no item holds belongs to none", () => {
    const at = (p: string, tab: string | null = null) => activeMenuId(`/app/tenants/${T}${p}`, tab);
    expect(at("")).toBe("m-today");
    expect(at("", "leads")).toBe("m-customers");
    expect(at("", "companies")).toBe("m-customers");
    expect(at("/leads/x")).toBe("m-customers");
    expect(at("/outbox")).toBe("m-chats");
    expect(at("/chats/x")).toBe("m-chats");
    expect(at("/followups/policy")).toBe("m-calls");
    expect(at("/campaigns")).toBe("m-calls");
    expect(at("/enquiries/x")).toBe("m-sales");
    expect(at("/orders/abc")).toBe("m-sales");
    expect(at("/price-list")).toBe("m-catalogue");
    expect(at("/materials")).toBe("m-catalogue");
    expect(at("/report")).toBe("m-reports");
    expect(at("/team")).toBe("settings");
    expect(at("/office")).toBe("settings");
    expect(at("/integrations")).toBe("settings");
    expect(at("/plans")).toBe("settings");
    expect(at("/nothing-here")).toBeNull();
    expect(menuItemId(MENU[1])).toBe("m-customers");
  });
});

describe("the parts that need a feature flag (night 4: Lead Desk, Ask your assistant to do it)", () => {
  const withFeatures = (features: string[]): PackFrame => ({ ...TEXTILES, features });
  it("are not offered while their flag is off, in any business type", () => {
    for (const [, view] of PACKS) {
      const ids = tabsOf(MENU.find((m) => m.id === "calls")!, "owner", view).map((t) => t.id);
      expect(ids).not.toContain("tasks");
      expect(ids).not.toContain("outreach");
      expect(tabsOf(MENU.find((m) => m.id === "customers")!, "owner", view).map((t) => t.id)).not.toContain("leaddesk");
      expect(tabsOf(MENU.find((m) => m.id === "settings")!, "owner", view).map((t) => t.id)).not.toContain("lead-sources");
    }
  });
  it("show up as tabs of Customers, Calls, Reports and Settings when on, for the roles that may use them", () => {
    const view = withFeatures(["leads", "outreach", "tasks"]);
    const tab = (menu: string, role: "owner" | "admin" | "sales" | "viewer") => tabsOf(MENU.find((m) => m.id === menu)!, role, view).map((t) => t.id);
    expect(tab("customers", "owner")).toEqual(expect.arrayContaining(["leaddesk", "import"]));
    expect(tab("customers", "viewer")).toContain("leaddesk");
    expect(tab("customers", "viewer")).not.toContain("import");
    expect(tab("calls", "owner")).toEqual(expect.arrayContaining(["outreach", "tasks"]));
    expect(tab("calls", "viewer")).toEqual(expect.arrayContaining(["tasks"]));
    expect(tab("reports", "owner")).toEqual(["report", "leadreport"]);
    expect(tab("reports", "sales")).not.toContain("leadreport");
    expect(tab("settings", "admin")).toContain("lead-sources");
    expect(tab("settings", "sales")).not.toContain("lead-sources");
  });
  it("each flag brings only its own parts", () => {
    const tasksOnly = withFeatures(["tasks"]);
    expect(tabsOf(MENU.find((m) => m.id === "calls")!, "owner", tasksOnly).map((t) => t.id)).toContain("tasks");
    expect(tabsOf(MENU.find((m) => m.id === "calls")!, "owner", tasksOnly).map((t) => t.id)).not.toContain("outreach");
    expect(tabsOf(MENU.find((m) => m.id === "customers")!, "owner", tasksOnly).map((t) => t.id)).not.toContain("import");
  });
  it("their addresses belong to the right menu item", () => {
    const view = withFeatures(["leads", "outreach", "tasks"]);
    void view;
    for (const [path, menu] of [["/lead-desk", "m-customers"], ["/import", "m-customers"], ["/outreach", "m-calls"], ["/tasks", "m-calls"], ["/lead-report", "m-reports"], ["/lead-sources", "settings"], ["/lead-setup", "m-today"]] as const) {
      expect(activeMenuId(`/app/tenants/11111111-1111-1111-1111-111111111111${path}`, null), path).toBe(menu);
    }
  });
});

