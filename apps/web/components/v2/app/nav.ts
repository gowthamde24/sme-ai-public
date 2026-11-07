/**
 * The workspace menu: ONE table (workspace redesign, plan section 2.2; ported to the design-lab app in Job AC, batch C1). Visibility is a convenience only: the
 * page, the API and the database stay the gate. `test: nav.test.ts` pins this table to the plan, so a role change in a page cannot silently disagree with the menu.
 * Pure data and pure functions: no React, no request. A path is relative to /app/tenants/<id>; a path starting with /app is absolute (account level).
 */
export type Role = "owner" | "admin" | "sales" | "viewer";
export const ALL_ROLES: readonly Role[] = ["owner", "admin", "sales", "viewer"];
export const WRITERS: readonly Role[] = ["owner", "admin", "sales"];
export const ADMINS: readonly Role[] = ["owner", "admin"];

export type IconKey = "today" | "leads" | "quotes" | "orders" | "customers" | "catalogue" | "sarees" | "visits" | "outbox" | "office" | "integrations" | "report" | "settings" | "retailers" | "team" | "chats" | "fees" | "campaigns" | "sites" | "dues" | "calls" | "students" | "admissions" | "announcements" | "programmes" | "assistant" | "find" | "followups" | "trips" | "aiteam" | "train" | "phone" | "sources";

export type NavItem = {
  id: string;
  label: string;
  icon: IconKey;
  /** The page this item opens for a business type with `module` instead of `path` (building materials: the catalogue IS /materials), so the menu never goes through a redirect (owner rule, 6 Nov). */
  pathIf?: { module: string; path: string };
  /** "" = the workspace home. A path with "?" (a Settings section) is a link only: no page is "under" it, so it never takes the current marker from the page it opens. */
  path: string;
  /** A place on the page to go to (`#ask`: the assistant's box on Today). */
  hash?: string;
  /** The home's records tab (`?tab=`) that makes this item the current one: "" = the home with no tab. */
  tab?: string;
  /** Other home tabs (`?tab=`) that belong to this item too. */
  tabs?: readonly string[];
  /** Other paths (relative to the workspace) whose pages belong under this item: the current marker and the way back use them. */
  also?: readonly string[];
  /** A tab of the phone's bottom bar (the rest are in "More"). */
  bar?: boolean;
  /** The bar tab that holds the business type's core work (job CL, blueprint 2): in a workspace whose core tab is another item's module, that item takes this tab's place; without a business type it is itself. */
  core?: boolean;
  /** The shorter word the phone's bottom bar uses for the item ("Visits" for "Store visits"); without it the bar uses `label`. */
  short?: string;
  roles: readonly Role[];
  /**
   * The module a business type must have switched ON for this item to show (blueprint section 4; the pack's `modules`). Absent = every business type has it. Visibility is a convenience only: the page
   * (`requireModule`, lib/packs/guard.ts) answers 403 and the database refuses the work; the menu just does not offer what the business does not have.
   */
  module?: string;
  /** An item no business had before packs existed (Fees, Campaigns): it is offered only when a pack's modules include its module. With no pack at all the menu is the one the product always had. */
  packOnly?: boolean;
  /** Hidden when the business type has this module ON: Dues is the education Fees page's own ledger, so a business with `fees` is not offered it twice (jobs CO and CS). */
  unlessModule?: string;
  /** A part that exists only while its feature flag is on (night 4: Lead Desk, Ask Vijaya to do it). Offered only when the workspace's frame lists the feature; the page itself answers 404 when the flag is off. */
  feature?: string;
  /** Hidden while this feature is on (app v4: the old pretend live-call page gives way to Phone calls). */
  unlessFeature?: string;
};
export type NavGroup = { id: string; label: string; items: readonly NavItem[] };

/**
 * The menu as the design-lab app draws it: four labelled groups (Work, Your business, Your team, Connect), then, below the scrolling part, Settings. The
 * pages the old menu listed one by one are reached from the screens now: follow-ups and suggestions from Leads, the item types, price list, products and quote policy from "Prices and
 * products" (the word "Catalogue" is the saree photo catalogue since job BC), the privacy and security pages from Settings, runs and cost from Office. Each page still belongs to one item (`also`), so the marker and the way back stay right.
 * There is no "Your team" members page yet (docs/plans/members-and-invitations.md): "Your team" is the group of the AI team (Office).
 */
export const NAV: readonly NavGroup[] = [
  {
    id: "work",
    label: "Work",
    items: [
      { id: "today", label: "Today", icon: "today", path: "", tab: "", also: ["/start", "/lead-setup", "/demo-video"], bar: true, roles: ALL_ROLES }, // the demo video (DEMO_VIDEO, demo workspaces only) is a story on Today
      // sidebar v2 (owner, 5 Nov): "Talk to assistant" is the assistant's box on Today (its own place, `#ask`), not a page of its own
      { id: "assistant", label: "Talk to assistant", icon: "assistant", path: "/talk", roles: ALL_ROLES }, // its own page (owner rule, 6 Nov: every menu item opens its own page)
      // sidebar v2: the call that is going on ("● 1 live"): the Office's live page, the last tab of Calls
      { id: "live", label: "Live calls", icon: "calls", path: "/office/live", module: "office", unlessFeature: "app_v4", roles: WRITERS },
      // app v4 part 4: the assistant's phone calls, live first, then finished (GET /calls); each opens its own page. Only while APP_V4 is on (the feature `app_v4`); the first tab of Calls then
      { id: "phonecalls", label: "Phone calls", icon: "calls", path: "/calls", feature: "app_v4", roles: WRITERS },
      // sidebar v2: a builder's merchant's delivery trips (the construction pack's own page)
      { id: "trips", label: "Trips", icon: "trips", path: "/orders/trips", module: "deliveries", packOnly: true, roles: WRITERS },
      { id: "leads", label: "Leads", icon: "leads", path: "/review", tabs: ["leads"], also: ["/leads", "/suggestions", "/requirements"], bar: true, module: "enquiries", unlessModule: "lead_desk", roles: ALL_ROLES },
      // job DQ part 0: the follow-ups were reached from Leads; they are the first part of Calls now
      { id: "followups", label: "Follow-ups", icon: "calls", path: "/followups", module: "enquiries", roles: ALL_ROLES },
      { id: "quotes", label: "Quotes", icon: "quotes", path: "/quotes", also: ["/enquiries"], bar: true, core: true, module: "quotes", roles: WRITERS },
      { id: "visits", label: "Store visits", short: "Visits", icon: "visits", path: "/visits", bar: true, module: "visits", roles: ALL_ROLES },
      // job CL: the fee page of the education business type (blueprint 2, the phone's core tab); only a pack whose modules include "fees" offers it
      { id: "fees", label: "Fees", icon: "fees", path: "/fees", module: "fees", packOnly: true, roles: WRITERS },
      // job CS: the school's own pages (module `programmes`): the students (the minimum record), the admissions board and the messages to parents
      { id: "students", label: "Students", icon: "students", path: "/students", module: "programmes", packOnly: true, roles: WRITERS },
      { id: "admissions", label: "Admission board", icon: "admissions", path: "/admissions", module: "programmes", packOnly: true, roles: WRITERS },
      { id: "announcements", label: "Announcements", icon: "announcements", path: "/announcements", also: ["/marks"], module: "programmes", packOnly: true, roles: WRITERS },
      { id: "orders", label: "Orders", icon: "orders", path: "/orders", module: "orders", roles: WRITERS },
      // job CL: reminder campaigns (construction dues, education fees); the screens come with the campaign jobs
      { id: "campaigns", label: "Campaigns", icon: "campaigns", path: "/campaigns", module: "campaigns", packOnly: true, roles: ADMINS },
      // job CQ: the people a money reminder did not reach, who have not paid
      { id: "calllist", label: "Call list", icon: "calls", path: "/call-list", module: "campaigns", packOnly: true, roles: WRITERS },
      { id: "outbox", label: "Outbox", icon: "outbox", path: "/outbox", roles: WRITERS },
      // job CC: the customer chat inbox (WhatsApp)
      { id: "chats", label: "Customer chats", short: "Inbox", icon: "chats", path: "/chats", module: "inbox", roles: WRITERS },
      { id: "report", label: "This week", icon: "report", path: "/report", module: "reports", roles: ADMINS },
      { id: "customers", label: "Customers", short: "Contacts", icon: "customers", path: "", tab: "companies", tabs: ["companies", "contacts"], also: ["/companies", "/contacts", "/customers"], module: "contacts", roles: ALL_ROLES },
      // job CO: a customer's delivery sites, and what customers owe (the shared ledger, ADR 0086); only a pack with the module offers them
      // app v4 part 5: Customers > Map, where the customers are (a list of real places); only while APP_V4 is on
      { id: "map", label: "Map", icon: "customers", path: "/map", feature: "app_v4", roles: ALL_ROLES },
      { id: "sites", label: "Sites", icon: "sites", path: "/sites", module: "sites", packOnly: true, roles: ALL_ROLES },
      // app v4 part 6: Sales > Money, what customers owe (the ledger's own sums) with Remind (a draft for the owner's OK); only while APP_V4 is on, and where the business type has the ledger (module dues), not a school
      { id: "money", label: "Money", icon: "dues", path: "/money", module: "dues", unlessModule: "fees", feature: "app_v4", packOnly: true, roles: WRITERS },
      { id: "dues", label: "Dues", icon: "dues", path: "/dues", module: "dues", unlessModule: "fees", packOnly: true, roles: WRITERS },
      // the Lead Finder (job lead-finder part D, ADR 0119): new businesses that may buy (made-up ones in a demo, Google Maps in the Owner Test workspace only), the Researcher's decision and the practice call. It replaced job CC's
      // map search (one place, not two). The tab keeps its word "Find retailers" (the business types' packs name it; packages/packs); the frame drops the module when the API says the Lead Finder is not available here (app/app/frame-data.ts)
      { id: "retailers", label: "Find retailers", icon: "retailers", path: "/retailers", module: "lead_finder", roles: WRITERS },
      // night 4 (jobs DR, DS): Lead Desk, the core for every business, and "Ask Vijaya to do it". Each exists only while its feature flag is on (lib/screens/features.ts); they are tabs of Customers, Calls and Reports
      { id: "leaddesk", label: "Leads", icon: "leads", path: "/lead-desk", feature: "leads", roles: ALL_ROLES },
      { id: "import", label: "Add leads", icon: "customers", path: "/import", feature: "leads", roles: WRITERS },
      { id: "outreach", label: "Lead plans", icon: "campaigns", path: "/outreach", feature: "outreach", roles: WRITERS },
      { id: "tasks", label: "Tasks", icon: "calls", path: "/tasks", feature: "tasks", roles: ALL_ROLES },
      { id: "leadreport", label: "Lead report", icon: "report", path: "/lead-report", feature: "outreach", roles: ADMINS },
    ],
  },
  {
    id: "business",
    label: "Business",
    items: [
      // the saree photo catalogue (job BC): every member reads it, Owner and Admin keep it. On the phone it lives in "More": the bar is full at five tabs and these are tabs for what needs a person today
      { id: "sarees", label: "Catalogue", icon: "sarees", path: "/catalogue", pathIf: { module: "materials", path: "/materials" }, also: ["/materials"], module: "catalogue", roles: ALL_ROLES },
      { id: "catalogue", label: "Prices and products", icon: "catalogue", path: "/item-types", also: ["/price-list", "/products", "/quote-policy"], module: "quotes", roles: WRITERS },
      // job CS: the institution, its programmes, classes and sections
      { id: "programmes", label: "Programmes", icon: "programmes", path: "/programmes", module: "programmes", packOnly: true, roles: WRITERS },
    ],
  },
  {
    id: "team",
    label: "Your team",
    items: [
      // job CC: the people in the business, with their owls; everyone sees who is on the team, the Owner and Admin manage it
      { id: "team", label: "Team", icon: "team", path: "/team", roles: ALL_ROLES },
      { id: "office", label: "Office", icon: "office", path: "/ai-team", also: ["/office", "/agents"], bar: true, module: "office", roles: ALL_ROLES },
      // sidebar v2: how the assistant talks (Settings > AI assistant, the Owner's) and the number it calls from (its own page; "not set up yet" until telephony exists; the WhatsApp number is Integrations > WhatsApp)
      { id: "train", label: "Train how it talks", icon: "train", path: "/ai-team/training", roles: ["owner"] },
      { id: "phone", label: "Phone number", icon: "phone", path: "/phone-number", roles: ADMINS },
    ],
  },
  {
    id: "connect",
    label: "Connect",
    items: [
      { id: "integrations", label: "Integrations", icon: "integrations", path: "/integrations", module: "integrations", roles: ADMINS },
      // night 4: where leads arrive from (Meta, IndiaMART, portals, the website form, a sheet, a webhook); a tab of Settings
      { id: "lead-sources", label: "Lead sources", icon: "integrations", path: "/lead-sources", feature: "leads", roles: ADMINS },
    ],
  },
];

/** Below the scrolling part of the menu: Settings (its tabs hold the business and plan, the members, language and look, security and privacy). */
export const FOOT: readonly NavItem[] = [
  { id: "settings", label: "Settings", icon: "settings", path: "/settings", also: ["/plans", "/privacy", "/suppression", "/assistant-work-preview"], roles: ALL_ROLES }, // the assistant-work preview (flag-only, mock) sits under Settings, next to Activity
];

export type VisibleGroup = { id: string; label: string; items: NavItem[] };

/**
 * THE MENU, sidebar v2 (owner-approved design, 5 Nov 2026; job-sidebar-v2.md): five groups, each with its heading and each one can be folded: OVERVIEW (Today, Reports, Talk to assistant), SELL (Leads, Find customers, Calls, Chats,
 * Follow-ups, Visits), BUSINESS (what the business type has: Catalogue & stock, Quotes, Orders for sarees; Materials, Quotes, Trips, Dues for building materials; Admissions, Students, Fees, Notices for a school),
 * AI TEAM (My AI team, Train how it talks, Phone number) and SETUP (Lead sources, Settings). Each row is a group of the pages above (shown as tabs when it has more than one, components/v2/app/GroupTabs.tsx), so no page and no address
 * is lost: a page that the business type or the role does not have is simply not a tab, and a row with no page at all is not in the menu (that is how BUSINESS follows the business type). `members` are NAV item ids in the order of
 * the tabs; the first one the person is offered is where the row goes. Row ids are `m-<id>` (their words are `nav.item.m-<id>`); `count` names the number the row shows (C1's nav-counts, components/v2/app/nav-badges.ts);
 * `labelOf` = a page whose business-type word wins when the business type has one (Visits: "Campus visits" for a school; Catalogue & stock: "Materials", "Programmes").
 */
export type MenuGroupId = "overview" | "sell" | "business" | "aiteam" | "setup" | "v4" | "d-overview" | "d-customers" | "d-sales" | "d-grow" | "d-team" | "d-last";
export type CountKey = "today" | "leads" | "calls" | "chats" | "followups" | "visits" | "quotes" | "aiteam" | "finder";
export type MenuId = "today" | "assistant" | "map" | "money" | "leads" | "find" | "calls" | "chats" | "followups" | "visits" | "catalogue" | "quotes" | "orders" | "trips" | "dues" | "admissions" | "students" | "fees" | "notices" | "reports" | "aiteam" | "train" | "phone" | "sources" | "settings";
export type MenuEntry = { id: MenuId; group: MenuGroupId; label: string; icon: IconKey; members: readonly string[]; /** A tab of the phone's bottom bar (the rest are in "More"). */ bar?: boolean; count?: CountKey; labelOf?: string };
export const MENU_GROUPS: readonly { id: MenuGroupId; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "sell", label: "Sell" },
  { id: "business", label: "Business" },
  { id: "aiteam", label: "AI team" },
  { id: "setup", label: "Setup" },
];
export const MENU: readonly MenuEntry[] = [
  { id: "today", group: "overview", label: "Today", icon: "today", members: ["today"], bar: true, count: "today" },
  // Reports sits under Today (owner's review, 5 Nov)
  { id: "reports", group: "overview", label: "Reports", icon: "report", members: ["report", "leadreport"] },
  { id: "assistant", group: "overview", label: "Talk to assistant", icon: "assistant", members: ["assistant"] },
  { id: "leads", group: "sell", label: "Leads", icon: "leads", members: ["leaddesk", "leads", "customers", "import", "sites"], bar: true, count: "leads" },
  { id: "find", group: "sell", label: "Find customers", icon: "find", members: ["retailers"] },
  { id: "calls", group: "sell", label: "Calls", icon: "calls", members: ["phonecalls", "outreach", "calllist", "campaigns", "tasks", "live"], bar: true, count: "calls" },
  { id: "chats", group: "sell", label: "Chats", icon: "chats", members: ["chats", "outbox"], bar: true, count: "chats" },
  { id: "followups", group: "sell", label: "Follow-ups", icon: "followups", members: ["followups"], count: "followups" },
  { id: "visits", group: "sell", label: "Store visits", icon: "visits", members: ["visits"], count: "visits", labelOf: "visits" },
  { id: "map", group: "sell", label: "Map", icon: "customers", members: ["map"] },
  { id: "catalogue", group: "business", label: "Catalogue & stock", icon: "catalogue", members: ["sarees", "catalogue", "programmes"], labelOf: "sarees" },
  { id: "quotes", group: "business", label: "Quotes", icon: "quotes", members: ["quotes"], count: "quotes" },
  { id: "orders", group: "business", label: "Orders", icon: "orders", members: ["orders"] },
  { id: "money", group: "business", label: "Money", icon: "dues", members: ["money"] },
  { id: "trips", group: "business", label: "Trips", icon: "trips", members: ["trips"] },
  { id: "dues", group: "business", label: "Dues", icon: "dues", members: ["dues"] },
  { id: "admissions", group: "business", label: "Admissions", icon: "admissions", members: ["admissions"] },
  { id: "students", group: "business", label: "Students", icon: "students", members: ["students"] },
  { id: "fees", group: "business", label: "Fees", icon: "fees", members: ["fees"] },
  { id: "notices", group: "business", label: "Notices", icon: "announcements", members: ["announcements"] },
  { id: "aiteam", group: "aiteam", label: "My AI team", icon: "aiteam", members: ["office"], count: "aiteam" },
  { id: "train", group: "aiteam", label: "Train how it talks", icon: "train", members: ["train"] },
  { id: "phone", group: "aiteam", label: "Phone number", icon: "phone", members: ["phone", "integrations"] },
  { id: "sources", group: "setup", label: "Lead sources", icon: "sources", members: ["lead-sources"] },
  // Settings: the business and plan, members, language and look, security and privacy, My profile (always there for everyone); Team is its tab
  { id: "settings", group: "setup", label: "Settings", icon: "settings", members: ["settings", "team"] },
];
/** Every row of the menu (Settings is one of them now: the foot of the menu is the meters and the person). */
export const MENU_ITEMS: readonly MenuEntry[] = MENU;

const PAGES = (): readonly NavItem[] => [...NAV.flatMap((g) => g.items), ...FOOT];
/** The menu row a page (a NAV item id) belongs to, or null (a page no menu row holds). */
export function menuOfPage(pageId: string): MenuEntry | null {
  return MENU.find((m) => m.members.includes(pageId)) ?? null;
}
/** The id the menu draws for a row: `m-<id>`, and `settings` for Settings (the id of its own row since the first menu). */
export const menuItemId = (m: MenuEntry): string => (m.id === "settings" ? "settings" : `m-${m.id}`);

/** The pages of a menu row that this role and business type are offered, in the order of the tabs. */
export function tabsOf(menu: MenuEntry, role: Role, view?: PackFrame | null): NavItem[] {
  const pages = PAGES();
  return menu.members.flatMap((id) => pages.filter((p) => p.id === id)).filter((p) => p.roles.includes(role) && offered(p, view)).map((p) => (p.pathIf && view?.modules.includes(p.pathIf.module) ? { ...p, path: p.pathIf.path } : p));
}

/** A menu row as a NavItem (with what the row needs: its count and the page whose word wins): it goes to the first page the person is offered, and belongs to all of its pages' paths (`also`), so the marker and the way back stay right. */
export type MenuRow = NavItem & { count?: CountKey; labelOf?: string; group: MenuGroupId };
function menuRow(menu: MenuEntry, role: Role, view?: PackFrame | null): MenuRow | null {
  const tabs = tabsOf(menu, role, view);
  const first = tabs[0];
  if (!first) return null;
  return {
    id: menuItemId(menu),
    label: menu.label,
    icon: menu.icon,
    path: first.path,
    ...(first.tab !== undefined ? { tab: first.tab } : {}),
    ...(first.hash !== undefined ? { hash: first.hash } : {}),
    also: tabs.flatMap((t) => [t.path, ...(t.also ?? [])]).filter((p) => p !== "" && !p.includes("?")),
    bar: menu.bar,
    roles: ALL_ROLES,
    group: menu.group,
    ...(menu.count ? { count: menu.count } : {}),
    ...(menu.labelOf ? { labelOf: menu.labelOf } : {}),
  };
}

export type MenuGroup = { id: MenuGroupId; label: string; items: MenuRow[] };
/** The groups of the menu a role is offered, each with the rows it has; a group with no row (a school's SELL has no Find customers ... but never none) is left out. */
export function menuGroups(role: Role, view?: PackFrame | null): MenuGroup[] {
  return MENU_GROUPS.map((g) => ({ id: g.id, label: g.label, items: MENU.filter((m) => m.group === g.id).map((m) => menuRow(m, role, view)).filter((i): i is MenuRow => i !== null) })).filter((g) => g.items.length > 0);
}

/** The menu row the current page belongs to (`m-quotes`, `settings`), or null. */
export function activeMenuId(pathname: string, tab: string | null): string | null {
  const page = itemFor(pathname, tab);
  const menu = page ? menuOfPage(page.item.id) : null;
  return menu ? menuItemId(menu) : null;
}

/** The phone's bottom bar (sidebar v2): Today, Leads, Chats and Calls (then More, which holds every other row and the meters), only those the role is offered. */
export function menuBar(role: Role, view?: PackFrame | null): MenuRow[] {
  const order: readonly string[] = ["m-today", "m-leads", "m-chats", "m-calls"];
  return menuGroups(role, view)
    .flatMap((g) => g.items)
    .filter((i) => i.bar)
    .sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
}

/**
 * APP v4 (job-app-v4.md part 1, owner 6 Nov 2026; only while APP_V4 is on): the menu is five groups, Today, Customers, Sales, AI team and Settings. Each group is made of the menu rows above (its sections, drawn as tabs at the top of
 * the page), and each section keeps its own pages (a second row of tabs when it has more than one), so every page keeps its address: nothing moves, so nothing needs a redirect. The phone's bar is the five groups, with no "More";
 * ⌘K reaches every page. A section the role or the business type does not have is simply not a tab, and a group with none is not in the menu. Money (Sales) is the dues or fees page of the business type until part 6 brings its own.
 */
export type V4Id = "today" | "customers" | "sales" | "aiteam" | "settings";
export type V4Entry = { id: V4Id; label: string; icon: IconKey; sections: readonly MenuId[]; /** Rows that belong to the group (its menu marker) but are not a tab of it: Today's "Talk to assistant" is the orb and the composer on Today itself (owner, 6 Nov 2026). */ quiet?: readonly MenuId[]; count?: CountKey };
export const MENU_V4: readonly V4Entry[] = [
  { id: "today", label: "Today", icon: "today", sections: ["today", "reports"], quiet: ["assistant"], count: "today" },
  { id: "customers", label: "Customers", icon: "customers", sections: ["leads", "calls", "chats", "followups", "visits", "map", "find"], count: "leads" },
  { id: "sales", label: "Sales", icon: "quotes", sections: ["quotes", "orders", "money", "catalogue", "dues", "fees", "trips", "admissions", "students", "notices"], count: "quotes" },
  { id: "aiteam", label: "AI team", icon: "aiteam", sections: ["aiteam", "train", "phone"], count: "aiteam" },
  { id: "settings", label: "Settings", icon: "settings", sections: ["sources", "settings"] },
];
/** The id the menu draws for a v4 group (`v4-sales`; its word is `nav.item.v4-sales`). */
export const v4ItemId = (id: V4Id): string => `v4-${id}`;
/** The v4 group a menu row (a section) belongs to, or null. */
export function v4OfMenu(menuId: MenuId): V4Entry | null {
  return MENU_V4.find((g) => g.sections.includes(menuId) || (g.quiet ?? []).includes(menuId)) ?? null;
}
/** The sections of a v4 group this role and business type are offered, in their order (each a menu row: it goes to its own first page). */
export function v4Sections(group: V4Entry, role: Role, view?: PackFrame | null): MenuRow[] {
  return group.sections.flatMap((id) => MENU.filter((m) => m.id === id)).map((m) => menuRow(m, role, view)).filter((r): r is MenuRow => r !== null);
}
/** The v4 menu as ONE group without a heading (the five rows), in the shape the menu drawing takes; a group with no section offered is left out. */
export function menuGroupsV4(role: Role, view?: PackFrame | null): MenuGroup[] {
  const items = MENU_V4.flatMap((g): MenuRow[] => {
    const sections = v4Sections(g, role, view);
    const first = sections[0];
    if (!first) return [];
    return [
      {
        id: v4ItemId(g.id),
        label: g.label,
        icon: g.icon,
        path: first.path,
        ...(first.tab !== undefined ? { tab: first.tab } : {}),
        ...(first.hash !== undefined ? { hash: first.hash } : {}),
        also: sections.flatMap((s) => [s.path, ...(s.also ?? [])]).filter((p) => p !== "" && !p.includes("?")),
        bar: true,
        roles: ALL_ROLES,
        group: "v4",
        ...(g.count ? { count: g.count } : {}),
      },
    ];
  });
  return items.length ? [{ id: "v4", label: "", items }] : [];
}
/** The v4 group the current page belongs to (`v4-customers`), or null. */
export function activeV4Id(pathname: string, tab: string | null): string | null {
  const page = itemFor(pathname, tab);
  const menu = page ? menuOfPage(page.item.id) : null;
  const group = menu ? v4OfMenu(menu.id) : null;
  return group ? v4ItemId(group.id) : null;
}

/**
 * APP v4 on a DESKTOP (1024 px and up; owner, 7 Nov 2026, from app-Main.png): the side menu is the design's, with small group headings: Overview (Today, Reports), Customers (Leads, Chats, Calls), Sales (Quotes, Orders, Catalogue),
 * Grow (Lead Finder), Team (AI team), then Settings. A row holds its other pages as tabs inside its page (`sections`, drawn by GroupTabs): Follow-ups and Store visits under Leads; the money pages (dues, fees, trips) and a school's
 * admissions, students and notices under Orders; Train how it talks and Phone number under AI team; Lead sources under Settings. A row's word and icon are its first section's the person is offered (a school's Orders row is "Fees"); a row with
 * no section offered is not in the menu. Narrower than 1024 px nothing changes: the five groups above (menuGroupsV4) and the phone's five tabs. Every page keeps its address.
 */
export type V4dRow = { sections: readonly MenuId[]; /** Rows that belong to this row (its marker) but are not a tab of it (Today's "Talk to assistant"). */ quiet?: readonly MenuId[]; count?: CountKey; /** A row of its own: its id (`v4d-finder`), word (`nav.item.<id>`) and icon, not its first section's. */ own?: { id: string; label: string; icon: IconKey } };
export const MENU_V4D: readonly { id: MenuGroupId; label: string; rows: readonly V4dRow[] }[] = [
  { id: "d-overview", label: "Overview", rows: [{ sections: ["today"], quiet: ["assistant"], count: "today" }, { sections: ["reports"] }] },
  { id: "d-customers", label: "Customers", rows: [{ sections: ["leads", "followups", "visits", "map"], count: "leads" }, { sections: ["chats"], count: "chats" }, { sections: ["calls"], count: "calls" }] },
  { id: "d-sales", label: "Sales", rows: [{ sections: ["quotes"], count: "quotes" }, { sections: ["orders", "money", "trips", "dues", "fees", "admissions", "students", "notices"] }, { sections: ["catalogue"] }] },
  { id: "d-grow", label: "Grow", rows: [{ sections: ["find"], count: "finder", own: { id: "v4d-finder", label: "Lead Finder", icon: "find" } }] },
  { id: "d-team", label: "Team", rows: [{ sections: ["aiteam", "train", "phone"], count: "aiteam" }] },
  { id: "d-last", label: "", rows: [{ sections: ["settings", "sources"] }] },
];
/** A desktop row's id is the id of its first section the person is offered (`m-leads`), so its word is that menu row's; `members` are every menu row id that marks it as the current one. */
export type V4dItem = MenuRow & { members: readonly string[] };
export type V4dGroup = { id: MenuGroupId; label: string; items: V4dItem[] };
export function menuGroupsV4D(role: Role, view?: PackFrame | null): V4dGroup[] {
  return MENU_V4D.flatMap((g): V4dGroup[] => {
    const items = g.rows.flatMap((r): V4dItem[] => {
      const rows = r.sections.flatMap((id) => MENU.filter((m) => m.id === id)).map((m) => menuRow(m, role, view)).filter((x): x is MenuRow => x !== null);
      const first = rows[0];
      if (!first) return [];
      const { count: _count, ...rest } = first; // the row's number is its own, not its first section's
      void _count;
      return [
        {
          ...rest,
          id: r.own?.id ?? first.id,
          label: r.own?.label ?? first.label,
          icon: r.own?.icon ?? first.icon,
          also: rows.flatMap((s) => [s.path, ...(s.also ?? [])]).filter((p) => p !== "" && !p.includes("?")),
          bar: false,
          group: g.id,
          ...(r.count ? { count: r.count } : {}),
          members: [...rows.map((s) => s.id), ...(r.quiet ?? []).map((q) => `m-${q}`)],
        },
      ];
    });
    return items.length ? [{ id: g.id, label: g.label, items }] : [];
  });
}
/** The desktop row (its id) the current menu row (`m-leads`, `settings`) belongs to, or null. */
export function activeV4dId(groups: readonly V4dGroup[], activeMenu: string | null): string | null {
  if (!activeMenu) return null;
  return groups.flatMap((g) => g.items).find((i) => i.members.includes(activeMenu))?.id ?? null;
}
/** The desktop row a menu row (a section) belongs to, or null. */
export function v4dRowOf(menuId: MenuId): V4dRow | null {
  return MENU_V4D.flatMap((g) => g.rows).find((r) => r.sections.includes(menuId) || (r.quiet ?? []).includes(menuId)) ?? null;
}
/** The sections of a desktop row this role and business type are offered (each a menu row: it goes to its own first page). */
export function v4dSections(row: V4dRow, role: Role, view?: PackFrame | null): MenuRow[] {
  return row.sections.flatMap((id) => MENU.filter((m) => m.id === id)).map((m) => menuRow(m, role, view)).filter((r): r is MenuRow => r !== null);
}

/**
 * What the menu needs to know about the workspace's business type (job CL; a plain object, so the client never imports more than it draws): the modules that are ON (the API's answer), the module of the phone's
 * core tab, the words the business type changes (the `nav.*` and `pack.core_tab` keys, already in the person's language) and a few facts for a badge. With NO pack (`undefined`/`null`: not read yet, or a server that
 * has no pack routes) the menu is the one the product always had. Nothing here names a business type.
 */
export type PackFrame = {
  name: string;
  /** The accent token the pack names (`data-accent`); an unknown one draws the default look. */
  accent: string;
  /** A real owner of this kind of business has reviewed the pack; the badge says so when it is not. */
  validated: boolean;
  /** The module of the phone's core tab (Quotes, Orders & deliveries, Fees ...). */
  coreTab: string;
  modules: readonly string[];
  labels: Readonly<Record<string, string>>;
  /** The phone's bottom bar (job CU, blueprint 2): "classic" = Today, Leads, the core tab, Visits, Office (what the product always had); "core" = Today, Inbox, the core tab, Contacts, then More. Absent = classic. */
  bar?: "classic" | "core";
  /** Night 4: the parts switched ON by a feature flag (lib/screens/features.ts); an item that names a `feature` is offered only when it is in this list. Absent = none are on. */
  features?: readonly string[];
};

/** Is this item offered to a business of this type? Absent pack: everything but the items that only exist with a pack. */
export function offered(item: NavItem, view?: PackFrame | null): boolean {
  if (item.feature !== undefined && !(view?.features ?? []).includes(item.feature)) return false;
  if (item.unlessFeature !== undefined && (view?.features ?? []).includes(item.unlessFeature)) return false;
  if (!view) return !item.packOnly;
  if (item.unlessModule !== undefined && view.modules.includes(item.unlessModule)) return false;
  return item.module === undefined || view.modules.includes(item.module);
}

/** The groups (and, inside them, the items) a role is offered. A group with no visible item is hidden. */
export function visibleGroups(role: Role, view?: PackFrame | null): VisibleGroup[] {
  return NAV.map((g) => ({ id: g.id, label: g.label, items: g.items.filter((i) => i.roles.includes(role) && offered(i, view)) })).filter((g) => g.items.length > 0);
}

/** The items under the scrolling part (Settings) a role is offered. */
export function footItems(role: Role): NavItem[] {
  return FOOT.filter((i) => i.roles.includes(role));
}

/** The item that holds the core work of a business type: the first menu item of its module (Quotes for `quotes`, Orders for `orders`, Fees for `fees`). Null when no screen has that module yet. */
export function coreItem(view: PackFrame): NavItem | null {
  return NAV.flatMap((g) => g.items).find((i) => i.module === view.coreTab) ?? null;
}

/**
 * The items that are tabs of the phone's bottom bar (then "More" holds the rest), only those the role is offered. The bar is Today, Leads, the CORE tab, Visits and Office (blueprint 2: a business type's core tab,
 * Quotes / Orders & deliveries / Fees, has its place on the bar); the core tab takes the place of the Quotes slot when the business type's core module is another one, and with no business type the bar is the one the product always had.
 */
export function barItems(role: Role, view?: PackFrame | null): NavItem[] {
  const all = NAV.flatMap((g) => g.items);
  const core = view ? coreItem(view) : null;
  if (view?.bar === "core") {
    // Today, Inbox, the business type's core tab, Contacts (and More): the four tabs of blueprint 2, only those the role is offered
    const pick = (id: string) => all.find((i) => i.id === id);
    return [pick("today"), pick("chats"), core, pick("customers")].filter((i): i is NavItem => !!i && i.roles.includes(role) && offered(i, view));
  }
  return all
    .filter((i) => i.bar)
    .map((i) => (i.core && core ? core : i))
    .filter((i) => i.roles.includes(role) && offered(i, view));
}

/** Where a nav item goes, for a workspace. */
export function hrefOf(item: NavItem, tenantId: string): string {
  const hash = item.hash ? `#${item.hash}` : "";
  if (item.path.startsWith("/app")) return `${item.path}${hash}`;
  const base = `/app/tenants/${tenantId}${item.path}`;
  return `${item.tab ? `${base}?tab=${item.tab}` : base}${hash}`;
}

const TENANT_PATH = /^\/app\/tenants\/([0-9a-fA-F-]{36})(\/[^?#]*)?/;

/** `{ tenantId, rest }` for a path under a workspace, else null. `rest` is "" for the workspace home. */
export function workspaceOf(pathname: string): { tenantId: string; rest: string } | null {
  const m = TENANT_PATH.exec(pathname);
  return m ? { tenantId: m[1], rest: (m[2] ?? "").replace(/\/$/, "") } : null;
}

const under = (rest: string, path: string) => rest === path || rest.startsWith(`${path}/`);

/** The nav item a path belongs to (for the current marker and the way back), or null. */
export function itemFor(pathname: string, tab: string | null): { group: NavGroup; item: NavItem } | null {
  const all = [...NAV.flatMap((g) => g.items.map((item) => ({ group: g, item }))), ...FOOT.map((item) => ({ group: { id: "foot", label: "", items: FOOT } as NavGroup, item }))];
  if (pathname === "/app/security" || pathname.startsWith("/app/security/")) return all.find((x) => x.item.id === "settings") ?? null;
  const ws = workspaceOf(pathname);
  if (!ws) return null;
  if (ws.rest === "") {
    if (!tab) return all.find((x) => x.item.id === "today") ?? null;
    return all.find((x) => x.item.tabs?.includes(tab)) ?? all.find((x) => x.item.id === "today") ?? null;
  }
  // the longest matching path wins (/followups/policy is under Leads through its own prefix; /agents is under Office)
  const hits = all
    .flatMap((x) => [x.item.path, ...(x.item.also ?? [])].filter((p) => p !== "" && !p.startsWith("/app") && !p.includes("?") && under(ws.rest, p)).map((p) => ({ x, len: p.length })))
    .sort((a, b) => b.len - a.len);
  return hits[0]?.x ?? null;
}
