import { describe, expect, it } from "vitest";

import { FOOT, MENU, MENU_GROUPS, NAV, activeMenuId, hrefOf, menuBar, menuGroups, menuItemId, menuOfPage, tabsOf, type PackFrame, type Role } from "./nav";

const T = "22222222-2222-2222-2222-222222222222";
const ROLES: Role[] = ["owner", "admin", "sales", "viewer"];
const pack = (modules: string[], coreTab: string, labels: Record<string, string> = {}): PackFrame => ({ name: "X", accent: "sky_blue", validated: true, coreTab, modules, labels });
/** The modules of the three business types (packages/packs): what each one switches on. */
const TEXTILES = pack(["today", "enquiries", "quotes", "orders", "visits", "office", "contacts", "catalogue", "inbox", "reports", "integrations", "lead_finder", "followups"], "quotes");
const CONSTRUCTION = pack(["today", "enquiries", "quotes", "orders", "deliveries", "visits", "office", "contacts", "materials", "sites", "dues", "campaigns", "inbox", "reports", "integrations", "lead_finder", "catalogue"], "orders");
const EDUCATION = pack(["today", "enquiries", "visits", "office", "contacts", "fees", "programmes", "campaigns", "inbox", "reports", "integrations"], "fees", { "nav.item.visits": "Campus visits", "nav.item.sarees": "Programmes" });
const PACKS: [string, PackFrame | null][] = [["no business type", null], ["textiles", TEXTILES], ["construction", CONSTRUCTION], ["education", EDUCATION]];
const rows = (role: Role, view: PackFrame | null) => menuGroups(role, view).flatMap((g) => g.items);
const ids = (role: Role, view: PackFrame | null, group?: string) => menuGroups(role, view).filter((g) => !group || g.id === group).flatMap((g) => g.items.map((i) => i.id));

describe("sidebar v2 (owner-approved design, 5 Nov 2026): five groups", () => {
  it("are Overview, Sell, Business, AI team and Setup, in that order, and every row belongs to one of them", () => {
    expect(MENU_GROUPS.map((g) => g.label)).toEqual(["Overview", "Sell", "Business", "AI team", "Setup"]);
    for (const m of MENU) expect(MENU_GROUPS.map((g) => g.id), m.id).toContain(m.group);
    expect(FOOT.map((i) => i.id)).toEqual(["settings"]);
  });

  it("every page of the menu table is a tab of exactly one row: nothing is lost, nothing is twice", () => {
    const pages = [...NAV.flatMap((g) => g.items), ...FOOT].map((i) => i.id);
    const members = MENU.flatMap((m) => m.members);
    expect(new Set(members).size).toBe(members.length);
    expect([...members].sort()).toEqual([...pages].sort());
    for (const id of pages) expect(menuOfPage(id), id).not.toBeNull();
  });

  it.each(ROLES.flatMap((r) => PACKS.map(([n, p]) => [r, n, p] as const)))("%s, %s: Today first, Settings in Setup, every row an m- row (Settings keeps its id)", (role, _n, view) => {
    const all = rows(role, view);
    expect(all[0]?.id).toBe("m-today");
    expect(ids(role, view, "setup")).toContain("settings");
    expect(all.every((i) => i.id.startsWith("m-") || i.id === "settings")).toBe(true);
  });

  it("Overview is Today, Reports and Talk to assistant (the assistant's box on Today, #ask)", () => {
    expect(ids("owner", TEXTILES, "overview")).toEqual(["m-today", "m-reports", "m-assistant"]); // Reports under Today (owner, 5 Nov)
    expect(hrefOf(rows("owner", TEXTILES).find((i) => i.id === "m-assistant")!, T)).toBe(`/app/tenants/${T}#ask`);
    expect(activeMenuId(`/app/tenants/${T}`, null)).toBe("m-today");
  });

  it("Sell is Leads, Find customers, Calls, Chats, Follow-ups and Visits; Find customers only where the Lead Finder is", () => {
    expect(ids("owner", TEXTILES, "sell")).toEqual(["m-leads", "m-find", "m-calls", "m-chats", "m-followups", "m-visits"]);
    expect(ids("owner", EDUCATION, "sell")).not.toContain("m-find");
    expect(ids("viewer", TEXTILES, "sell")).toEqual(["m-leads", "m-followups", "m-visits"]); // a Viewer has no chats, no calls, no finder
  });

  it("Business follows the business type: sarees, building materials, a school", () => {
    expect(ids("owner", TEXTILES, "business")).toEqual(["m-catalogue", "m-quotes", "m-orders"]);
    expect(ids("owner", CONSTRUCTION, "business")).toEqual(["m-catalogue", "m-quotes", "m-orders", "m-trips", "m-dues"]);
    expect(ids("owner", EDUCATION, "business")).toEqual(["m-catalogue", "m-admissions", "m-students", "m-fees", "m-notices"]);
    // the business type's own word wins for the rows that have one: "Campus visits", "Programmes"
    const school = rows("owner", EDUCATION);
    expect(school.find((i) => i.id === "m-visits")?.labelOf).toBe("visits");
    expect(school.find((i) => i.id === "m-catalogue")?.labelOf).toBe("sarees");
  });

  it("AI team is My AI team, Train how it talks (the Owner's) and Phone number (Owner, Admin); Setup is Lead sources (with Lead Desk) and Settings", () => {
    expect(ids("owner", TEXTILES, "aiteam")).toEqual(["m-aiteam", "m-train", "m-phone"]);
    expect(ids("admin", TEXTILES, "aiteam")).toEqual(["m-aiteam", "m-phone"]);
    expect(ids("sales", TEXTILES, "aiteam")).toEqual(["m-aiteam"]);
    expect(hrefOf(rows("owner", TEXTILES).find((i) => i.id === "m-train")!, T)).toBe(`/app/tenants/${T}/settings?section=assistant`);
    expect(hrefOf(rows("owner", TEXTILES).find((i) => i.id === "m-phone")!, T)).toBe(`/app/tenants/${T}/phone-number`); // the calling number, not WhatsApp (owner, 5 Nov)
    expect(ids("owner", TEXTILES, "setup")).toEqual(["settings"]);
    expect(ids("owner", { ...TEXTILES, features: ["leads"] }, "setup")).toEqual(["m-sources", "settings"]);
  });

  it("the rows that show a number say which one (C1's nav-counts)", () => {
    const counted = Object.fromEntries(rows("owner", TEXTILES).filter((i) => i.count).map((i) => [i.id, i.count]));
    expect(counted).toEqual({ "m-today": "today", "m-leads": "leads", "m-calls": "calls", "m-chats": "chats", "m-followups": "followups", "m-visits": "visits", "m-quotes": "quotes", "m-aiteam": "aiteam" });
  });

  it("the phone's bar is Today, Leads, Chats and Calls; the rest is in More", () => {
    expect(menuBar("owner", TEXTILES).map((i) => i.id)).toEqual(["m-today", "m-leads", "m-chats", "m-calls"]);
    expect(menuBar("viewer", TEXTILES).map((i) => i.id)).toEqual(["m-today", "m-leads"]);
  });

  it("every page belongs to the row it is a tab of (the marker stays right), and a link to a Settings section never takes the marker", () => {
    const at = (p: string, tab: string | null = null) => activeMenuId(`/app/tenants/${T}${p}`, tab);
    expect(at("")).toBe("m-today");
    expect(at("", "leads")).toBe("m-leads");
    expect(at("", "companies")).toBe("m-leads");
    expect(at("/leads/x")).toBe("m-leads");
    expect(at("/retailers")).toBe("m-find");
    expect(at("/outbox")).toBe("m-chats");
    expect(at("/chats/x")).toBe("m-chats");
    expect(at("/followups/policy")).toBe("m-followups");
    expect(at("/campaigns")).toBe("m-calls");
    expect(at("/office/live")).toBe("m-calls");
    expect(at("/visits")).toBe("m-visits");
    expect(at("/enquiries/x")).toBe("m-quotes");
    expect(at("/orders/abc")).toBe("m-orders");
    expect(at("/orders/trips")).toBe("m-trips");
    expect(at("/price-list")).toBe("m-catalogue");
    expect(at("/materials")).toBe("m-catalogue");
    expect(at("/report")).toBe("m-reports");
    expect(at("/office")).toBe("m-aiteam");
    expect(at("/agents")).toBe("m-aiteam");
    expect(at("/integrations")).toBe("m-phone");
    expect(at("/integrations/whatsapp")).toBe("m-phone");
    expect(at("/phone-number")).toBe("m-phone");
    expect(at("/settings")).toBe("settings");
    expect(at("/team")).toBe("settings");
    expect(at("/plans")).toBe("settings");
    expect(at("/nothing-here")).toBeNull();
    expect(menuItemId(MENU[0])).toBe("m-today");
  });
});

describe("the parts that need a feature flag (night 4: Lead Desk, Ask your assistant to do it)", () => {
  const withFeatures = (features: string[]): PackFrame => ({ ...TEXTILES, features, modules: features.includes("leads") ? [...TEXTILES.modules, "lead_desk"] : TEXTILES.modules }); // what packFrame() sends
  it("are not offered while their flag is off, in any business type", () => {
    for (const [, view] of PACKS) {
      const calls = tabsOf(MENU.find((m) => m.id === "calls")!, "owner", view).map((t) => t.id);
      expect(calls).not.toContain("tasks");
      expect(calls).not.toContain("outreach");
      const leads = tabsOf(MENU.find((m) => m.id === "leads")!, "owner", view).map((t) => t.id);
      expect(leads).not.toContain("leaddesk");
      expect(leads).toContain("leads"); // without Lead Desk the old Leads screen is the list
    }
  });
  it("show up as tabs of Leads and Calls when on, for the roles that may use them", () => {
    const view = withFeatures(["leads", "outreach", "tasks"]);
    const tab = (menu: string, role: Role) => tabsOf(MENU.find((m) => m.id === menu)!, role, view).map((t) => t.id);
    expect(tab("leads", "owner").slice(0, 3)).toEqual(["leaddesk", "customers", "import"]);
    expect(tab("leads", "owner")).not.toContain("leads"); // one list of leads while Lead Desk is on
    expect(tab("leads", "viewer")).not.toContain("import");
    expect(tab("calls", "owner")).toEqual(["outreach", "tasks", "live"]);
    expect(tab("reports", "owner")).toEqual(["report", "leadreport"]);
    expect(tab("sources", "admin")).toEqual(["lead-sources"]);
    expect(tab("sources", "sales")).toEqual([]);
  });
  it("their addresses belong to the right row", () => {
    for (const [path, menu] of [["/lead-desk", "m-leads"], ["/import", "m-leads"], ["/outreach", "m-calls"], ["/tasks", "m-calls"], ["/lead-report", "m-reports"], ["/lead-sources", "m-sources"], ["/lead-setup", "m-today"]] as const) {
      expect(activeMenuId(`/app/tenants/11111111-1111-1111-1111-111111111111${path}`, null), path).toBe(menu);
    }
  });
});
