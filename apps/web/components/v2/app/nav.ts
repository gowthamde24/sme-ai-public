/**
 * The workspace menu: ONE table (workspace redesign, plan section 2.2). Visibility is a convenience only: the page, the API and the database
 * stay the gate. `test: nav.test.ts` pins this table to the plan, so a role change in a page cannot silently disagree with the menu.
 * Pure data and pure functions: no React, no request. A path is relative to /app/tenants/<id>; a path starting with /app is absolute (account level).
 */
export type Role = "owner" | "admin" | "sales" | "viewer";
export const ALL_ROLES: readonly Role[] = ["owner", "admin", "sales", "viewer"];
export const WRITERS: readonly Role[] = ["owner", "admin", "sales"];
export const ADMINS: readonly Role[] = ["owner", "admin"];
export const OWNER_ONLY: readonly Role[] = ["owner"];

export type IconKey = "today" | "customers" | "orders" | "followups" | "catalogue" | "assistant" | "settings";

export type NavItem = {
  id: string;
  label: string;
  /** "" = the workspace home. */
  path: string;
  /** The home's records tabs: `?tab=` value that makes this item the current one (and "" = no tab). */
  tab?: string;
  roles: readonly Role[];
};
export type NavGroup = { id: string; label: string; icon: IconKey; items: readonly NavItem[] };

export const NAV: readonly NavGroup[] = [
  { id: "today", label: "Today", icon: "today", items: [{ id: "today", label: "Today", path: "", tab: "", roles: ALL_ROLES }] },
  {
    id: "customers",
    label: "Customers",
    icon: "customers",
    items: [
      { id: "review", label: "Leads to look at", path: "/review", roles: ALL_ROLES },
      { id: "records", label: "Companies and contacts", path: "", tab: "companies", roles: ALL_ROLES },
      { id: "add-customer", label: "Add a customer", path: "/customers/new", roles: WRITERS },
    ],
  },
  { id: "orders", label: "Quotes and orders", icon: "orders", items: [{ id: "orders", label: "Orders", path: "/orders", roles: WRITERS }] },
  {
    id: "followups",
    label: "Follow-ups",
    icon: "followups",
    items: [
      { id: "followups-due", label: "Due now", path: "/followups", roles: WRITERS },
      { id: "followups-policy", label: "Rules for follow-ups", path: "/followups/policy", roles: WRITERS },
    ],
  },
  {
    id: "catalogue",
    label: "Catalogue",
    icon: "catalogue",
    items: [
      { id: "item-types", label: "Item types", path: "/item-types", roles: WRITERS },
      { id: "price-list", label: "Price list", path: "/price-list", roles: ADMINS },
      { id: "add-product", label: "Add a product", path: "/products/new", roles: ADMINS },
    ],
  },
  {
    id: "assistant",
    label: "Assistant",
    icon: "assistant",
    items: [
      { id: "suggestions", label: "Suggestions", path: "/suggestions", roles: ALL_ROLES },
      { id: "agents", label: "Agents", path: "/agents", roles: ALL_ROLES },
    ],
  },
  {
    id: "settings",
    label: "Settings",
    icon: "settings",
    items: [
      { id: "quote-policy", label: "Quote policy", path: "/quote-policy", roles: ADMINS },
      { id: "privacy", label: "Privacy and erasure", path: "/privacy", roles: ADMINS },
      { id: "suppression", label: "Suppression keys", path: "/suppression", roles: OWNER_ONLY },
      { id: "security", label: "Security (your account)", path: "/app/security", roles: ALL_ROLES },
    ],
  },
];

/** The phone's bottom bar: these groups, then "More" with the rest. */
export const TAB_GROUPS = ["today", "customers", "orders", "followups"] as const;

export type VisibleGroup = { id: string; label: string; icon: IconKey; items: NavItem[] };

/** The groups (and, inside them, the items) a role is offered. A group with no visible item is hidden. */
export function visibleGroups(role: Role): VisibleGroup[] {
  return NAV.map((g) => ({ id: g.id, label: g.label, icon: g.icon, items: g.items.filter((i) => i.roles.includes(role)) })).filter((g) => g.items.length > 0);
}

/** Where a nav item goes, for a workspace. */
export function hrefOf(item: NavItem, tenantId: string): string {
  if (item.path.startsWith("/app")) return item.path;
  const base = `/app/tenants/${tenantId}${item.path}`;
  return item.tab ? `${base}?tab=${item.tab}` : base;
}

/** The first thing a group's tab opens. */
export function groupHref(group: VisibleGroup, tenantId: string): string {
  return hrefOf(group.items[0], tenantId);
}

/** Pages that belong under an item although their path does not start with it (static rules, most specific first). */
const BELONGS: readonly { test: RegExp; item: string }[] = [
  { test: /^\/leads\/[^/]+\/followup/, item: "followups-due" },
  { test: /^\/requirements\//, item: "followups-due" },
  { test: /^\/leads\//, item: "review" },
  { test: /^\/(companies|contacts)\//, item: "records" },
  { test: /^\/enquiries\//, item: "orders" },
];

const TENANT_PATH = /^\/app\/tenants\/([0-9a-fA-F-]{36})(\/[^?#]*)?/;

/** `{ tenantId, rest }` for a path under a workspace, else null. `rest` is "" for the workspace home. */
export function workspaceOf(pathname: string): { tenantId: string; rest: string } | null {
  const m = TENANT_PATH.exec(pathname);
  return m ? { tenantId: m[1], rest: (m[2] ?? "").replace(/\/$/, "") } : null;
}

/** The nav item a path belongs to (for the current marker and the way back), or null. */
export function itemFor(pathname: string, tab: string | null): { group: VisibleGroup | NavGroup; item: NavItem } | null {
  if (pathname === "/app/security" || pathname.startsWith("/app/security/")) {
    const group = NAV.find((g) => g.id === "settings")!;
    return { group, item: group.items.find((i) => i.id === "security")! };
  }
  const ws = workspaceOf(pathname);
  if (!ws) return null;
  const items = NAV.flatMap((g) => g.items.map((item) => ({ group: g, item })));
  if (ws.rest === "") {
    const id = tab ? "records" : "today";
    return items.find((x) => x.item.id === id) ?? null;
  }
  const rule = BELONGS.find((b) => b.test.test(ws.rest));
  if (rule) return items.find((x) => x.item.id === rule.item) ?? null;
  // the longest matching path wins (/followups/policy before /followups)
  const hits = items.filter((x) => x.item.path !== "" && !x.item.path.startsWith("/app") && (ws.rest === x.item.path || ws.rest.startsWith(`${x.item.path}/`)));
  hits.sort((a, b) => b.item.path.length - a.item.path.length);
  return hits[0] ?? null;
}
