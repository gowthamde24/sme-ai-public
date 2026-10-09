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

export type IconKey = "today" | "followups" | "leads" | "customers" | "orders" | "catalogue" | "assistant" | "safety";

export type NavItem = {
  id: string;
  label: string;
  /** "" = the workspace home. */
  path: string;
  /** The home's records tabs: `?tab=` value that makes this item the current one (and "" = no tab). */
  tab?: string;
  /** Set on the few daily items that are a tab of the phone's bottom bar: the short word under the icon, and the icon. */
  bar?: string;
  barIcon?: IconKey;
  roles: readonly Role[];
};
/**
 * `collapsible`: the group opens and closes (a group with more than three items must be; the test pins that). `defaultOpen`: open until the person closes it
 * (the group that holds the current page always opens itself). `humanOnly`: the group's name stays English in every language until a person who reads the
 * language has reviewed it (language track).
 */
export type NavGroup = { id: string; label: string; icon: IconKey; items: readonly NavItem[]; collapsible?: boolean; defaultOpen?: boolean; humanOnly?: boolean };

/**
 * The menu, simplified (Job X, owner feedback 2026-10-09): six top-level entries at most, plain words, the daily groups always open, the rarely used
 * ones (catalogue and prices, privacy and safety) closed until opened. Every page a role can open is at most two clicks from here. A group a role has
 * only one item of is drawn as a plain link (see `visibleGroups`). There is no "Your team" entry: there is no page for it yet (docs/plans/members-and-invitations.md).
 */
export const NAV: readonly NavGroup[] = [
  {
    id: "today",
    label: "Today",
    icon: "today",
    items: [
      { id: "today", label: "Home", path: "", tab: "", bar: "Today", barIcon: "today", roles: ALL_ROLES },
      { id: "followups-due", label: "Follow-ups due", path: "/followups", bar: "Follow-ups", barIcon: "followups", roles: WRITERS },
      { id: "followups-policy", label: "Rules for follow-ups", path: "/followups/policy", roles: WRITERS },
    ],
  },
  {
    id: "leads",
    label: "Leads and orders",
    icon: "orders",
    items: [
      { id: "review", label: "Leads to look at", path: "/review", bar: "Leads", barIcon: "leads", roles: ALL_ROLES },
      { id: "orders", label: "Orders", path: "/orders", bar: "Orders", barIcon: "orders", roles: WRITERS },
    ],
  },
  {
    id: "customers",
    label: "Customers",
    icon: "customers",
    items: [
      { id: "records", label: "Companies and contacts", path: "", tab: "companies", roles: ALL_ROLES },
      { id: "add-customer", label: "Add a customer", path: "/customers/new", roles: WRITERS },
    ],
  },
  {
    id: "catalogue",
    label: "Catalogue and prices",
    icon: "catalogue",
    collapsible: true,
    items: [
      { id: "item-types", label: "Item types", path: "/item-types", roles: WRITERS },
      { id: "price-list", label: "Price list", path: "/price-list", roles: ADMINS },
      { id: "add-product", label: "Add a product", path: "/products/new", roles: ADMINS },
      { id: "quote-policy", label: "Quote policy", path: "/quote-policy", roles: ADMINS },
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
    id: "safety",
    label: "Privacy and safety",
    icon: "safety",
    collapsible: true,
    humanOnly: true,
    items: [
      { id: "privacy", label: "Privacy and erasure", path: "/privacy", roles: ADMINS },
      { id: "suppression", label: "Suppression keys", path: "/suppression", roles: OWNER_ONLY },
      { id: "security", label: "Security (your account)", path: "/app/security", roles: ALL_ROLES },
    ],
  },
];

export type VisibleGroup = {
  id: string;
  label: string;
  icon: IconKey;
  items: NavItem[];
  /** The group opens and closes (and has at least two items for this role). */
  collapsible: boolean;
  defaultOpen: boolean;
  /** One item only for this role: drawn as a plain link, with no group heading. */
  flat: boolean;
};

/** The groups (and, inside them, the items) a role is offered. A group with no visible item is hidden. */
export function visibleGroups(role: Role): VisibleGroup[] {
  return NAV.map((g) => {
    const items = g.items.filter((i) => i.roles.includes(role));
    return { id: g.id, label: g.label, icon: g.icon, items, collapsible: !!g.collapsible && items.length > 1, defaultOpen: !!g.defaultOpen, flat: items.length === 1 };
  }).filter((g) => g.items.length > 0);
}

/** The daily items that are tabs of the phone's bottom bar (then "More" holds the whole menu), only those the role is offered. */
export function barItems(role: Role): NavItem[] {
  return NAV.flatMap((g) => g.items).filter((i) => i.bar && i.roles.includes(role));
}

/** Where a nav item goes, for a workspace. */
export function hrefOf(item: NavItem, tenantId: string): string {
  if (item.path.startsWith("/app")) return item.path;
  const base = `/app/tenants/${tenantId}${item.path}`;
  return item.tab ? `${base}?tab=${item.tab}` : base;
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
    const group = NAV.find((g) => g.id === "safety")!;
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
