/**
 * The workspace menu: ONE table (workspace redesign, plan section 2.2; ported to the design-lab app in Job AC, batch C1). Visibility is a convenience only: the
 * page, the API and the database stay the gate. `test: nav.test.ts` pins this table to the plan, so a role change in a page cannot silently disagree with the menu.
 * Pure data and pure functions: no React, no request. A path is relative to /app/tenants/<id>; a path starting with /app is absolute (account level).
 */
export type Role = "owner" | "admin" | "sales" | "viewer";
export const ALL_ROLES: readonly Role[] = ["owner", "admin", "sales", "viewer"];
export const WRITERS: readonly Role[] = ["owner", "admin", "sales"];
export const ADMINS: readonly Role[] = ["owner", "admin"];
export const OWNER_ONLY: readonly Role[] = ["owner"];

export type IconKey = "today" | "leads" | "quotes" | "orders" | "customers" | "catalogue" | "office" | "integrations" | "settings";

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
  roles: readonly Role[];
};
export type NavGroup = { id: string; label: string; items: readonly NavItem[] };

/**
 * The menu as the design-lab app draws it: four labelled groups (Work, Your business, Your team, Connect), then, below the scrolling part, Settings. The
 * pages the old menu listed one by one are reached from the screens now: follow-ups and suggestions from Leads, the catalogue's four pages from "Catalogue and
 * prices", the privacy and security pages from Settings, runs and cost from Office. Each page still belongs to one item (`also`), so the marker and the way back stay right.
 * There is no "Your team" members page yet (docs/plans/members-and-invitations.md): "Your team" is the group of the AI team (Office).
 */
export const NAV: readonly NavGroup[] = [
  {
    id: "work",
    label: "Work",
    items: [
      { id: "today", label: "Today", icon: "today", path: "", tab: "", bar: true, roles: ALL_ROLES },
      { id: "leads", label: "Leads", icon: "leads", path: "/review", tabs: ["leads"], also: ["/leads", "/followups", "/suggestions", "/requirements"], bar: true, roles: ALL_ROLES },
      { id: "quotes", label: "Quotes", icon: "quotes", path: "/quotes", also: ["/enquiries"], bar: true, roles: WRITERS },
      { id: "orders", label: "Orders", icon: "orders", path: "/orders", bar: true, roles: WRITERS },
      { id: "customers", label: "Customers", icon: "customers", path: "", tab: "companies", tabs: ["companies", "contacts"], also: ["/companies", "/contacts", "/customers"], roles: ALL_ROLES },
    ],
  },
  {
    id: "business",
    label: "Your business",
    items: [{ id: "catalogue", label: "Catalogue and prices", icon: "catalogue", path: "/item-types", also: ["/price-list", "/products", "/quote-policy"], roles: WRITERS }],
  },
  {
    id: "team",
    label: "Your team",
    items: [{ id: "office", label: "Office", icon: "office", path: "/office", also: ["/agents"], bar: true, roles: ALL_ROLES }],
  },
  {
    id: "connect",
    label: "Connect",
    items: [{ id: "integrations", label: "Integrations", icon: "integrations", path: "/integrations", roles: ADMINS }],
  },
];

/** Below the scrolling part of the menu: Settings (its tabs hold the business and plan, the members, language and look, security and privacy). */
export const FOOT: readonly NavItem[] = [
  { id: "settings", label: "Settings", icon: "settings", path: "/settings", also: ["/privacy", "/suppression"], roles: ALL_ROLES },
];

export type VisibleGroup = { id: string; label: string; items: NavItem[] };

/** The groups (and, inside them, the items) a role is offered. A group with no visible item is hidden. */
export function visibleGroups(role: Role): VisibleGroup[] {
  return NAV.map((g) => ({ id: g.id, label: g.label, items: g.items.filter((i) => i.roles.includes(role)) })).filter((g) => g.items.length > 0);
}

/** The items under the scrolling part (Settings) a role is offered. */
export function footItems(role: Role): NavItem[] {
  return FOOT.filter((i) => i.roles.includes(role));
}

/** The items that are tabs of the phone's bottom bar (then "More" holds the rest), only those the role is offered. */
export function barItems(role: Role): NavItem[] {
  return NAV.flatMap((g) => g.items).filter((i) => i.bar && i.roles.includes(role));
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
