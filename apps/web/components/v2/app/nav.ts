/**
 * The workspace menu: ONE table (workspace redesign, plan section 2.2; ported to the design-lab app in Job AC, batch C1). Visibility is a convenience only: the
 * page, the API and the database stay the gate. `test: nav.test.ts` pins this table to the plan, so a role change in a page cannot silently disagree with the menu.
 * Pure data and pure functions: no React, no request. A path is relative to /app/tenants/<id>; a path starting with /app is absolute (account level).
 */
export type Role = "owner" | "admin" | "sales" | "viewer";
export const ALL_ROLES: readonly Role[] = ["owner", "admin", "sales", "viewer"];
export const WRITERS: readonly Role[] = ["owner", "admin", "sales"];
export const ADMINS: readonly Role[] = ["owner", "admin"];

export type IconKey = "today" | "leads" | "quotes" | "orders" | "customers" | "catalogue" | "sarees" | "visits" | "outbox" | "office" | "integrations" | "report" | "settings" | "retailers" | "team" | "chats" | "fees" | "campaigns" | "sites" | "dues" | "calls" | "students" | "admissions" | "announcements" | "programmes";

export type NavItem = {
  id: string;
  label: string;
  icon: IconKey;
  /** "" = the workspace home. */
  path: string;
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
      { id: "today", label: "Today", icon: "today", path: "", tab: "", also: ["/start"], bar: true, roles: ALL_ROLES },
      { id: "leads", label: "Leads", icon: "leads", path: "/review", tabs: ["leads"], also: ["/leads", "/followups", "/suggestions", "/requirements"], bar: true, module: "enquiries", roles: ALL_ROLES },
      { id: "quotes", label: "Quotes", icon: "quotes", path: "/quotes", also: ["/enquiries"], bar: true, core: true, module: "quotes", roles: WRITERS },
      { id: "visits", label: "Store visits", short: "Visits", icon: "visits", path: "/visits", bar: true, module: "visits", roles: ALL_ROLES },
      // job CL: the fee page of the education business type (blueprint 2, the phone's core tab); only a pack whose modules include "fees" offers it
      { id: "fees", label: "Fees", icon: "fees", path: "/fees", module: "fees", packOnly: true, roles: WRITERS },
      // job CS: the school's own pages (module `programmes`): the students (the minimum record), the admissions board and the messages to parents
      { id: "students", label: "Students", icon: "students", path: "/students", module: "programmes", packOnly: true, roles: WRITERS },
      { id: "admissions", label: "Admission board", icon: "admissions", path: "/admissions", module: "programmes", packOnly: true, roles: WRITERS },
      { id: "announcements", label: "Announcements", icon: "announcements", path: "/announcements", module: "programmes", packOnly: true, roles: WRITERS },
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
      { id: "sites", label: "Sites", icon: "sites", path: "/sites", module: "sites", packOnly: true, roles: ALL_ROLES },
      { id: "dues", label: "Dues", icon: "dues", path: "/dues", module: "dues", unlessModule: "fees", packOnly: true, roles: WRITERS },
      // job CC: look for shops and wholesalers on Google Maps and keep the good ones as leads
      { id: "retailers", label: "Find retailers", icon: "retailers", path: "/retailers", module: "lead_finder", roles: WRITERS },
    ],
  },
  {
    id: "business",
    label: "Your business",
    items: [
      // the saree photo catalogue (job BC): every member reads it, Owner and Admin keep it. On the phone it lives in "More": the bar is full at five tabs and these are tabs for what needs a person today
      { id: "sarees", label: "Catalogue", icon: "sarees", path: "/catalogue", also: ["/materials"], module: "catalogue", roles: ALL_ROLES },
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
      { id: "office", label: "Office", icon: "office", path: "/office", also: ["/agents"], bar: true, module: "office", roles: ALL_ROLES },
    ],
  },
  {
    id: "connect",
    label: "Connect",
    items: [{ id: "integrations", label: "Integrations", icon: "integrations", path: "/integrations", module: "integrations", roles: ADMINS }],
  },
];

/** Below the scrolling part of the menu: Settings (its tabs hold the business and plan, the members, language and look, security and privacy). */
export const FOOT: readonly NavItem[] = [
  { id: "settings", label: "Settings", icon: "settings", path: "/settings", also: ["/plans", "/privacy", "/suppression"], roles: ALL_ROLES },
];

export type VisibleGroup = { id: string; label: string; items: NavItem[] };

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
};

/** Is this item offered to a business of this type? Absent pack: everything but the items that only exist with a pack. */
export function offered(item: NavItem, view?: PackFrame | null): boolean {
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
  if (item.path.startsWith("/app")) return item.path;
  const base = `/app/tenants/${tenantId}${item.path}`;
  return item.tab ? `${base}?tab=${item.tab}` : base;
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
    .flatMap((x) => [x.item.path, ...(x.item.also ?? [])].filter((p) => p !== "" && !p.startsWith("/app") && under(ws.rest, p)).map((p) => ({ x, len: p.length })))
    .sort((a, b) => b.len - a.len);
  return hits[0]?.x ?? null;
}
