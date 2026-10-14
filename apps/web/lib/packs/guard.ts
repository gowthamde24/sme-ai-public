import { itemFor, workspaceOf } from "@/components/v2/app/nav";

/**
 * The module guard's pure half (job CL): which module a request path needs. The menu table (nav.ts) already says which menu item every page of a workspace belongs to (`path` and `also`, the longest
 * match, the home's `?tab=`), and each item names its module, so a page can never be reachable by address while its menu item is hidden for the business type. A page that is in no menu item
 * (help, privacy, settings) needs no module. Server side: the template of the workspace (app/app/tenants/[tenantId]/template.tsx) asks this with the path the proxy recorded and refuses with a 403
 * page when the business type does not have the module. This is the screen's gate; the API and the database stay the real one (default deny, ADR 0084 principle 3).
 */
export function moduleForPath(smePath: string | null | undefined): { tenantId: string; module: string } | null {
  if (!smePath || smePath.length > 2048) return null;
  const q = smePath.indexOf("?");
  const pathname = q === -1 ? smePath : smePath.slice(0, q);
  const ws = workspaceOf(pathname);
  if (!ws) return null;
  const tab = q === -1 ? null : new URLSearchParams(smePath.slice(q + 1)).get("tab");
  const hit = itemFor(pathname, tab);
  return hit?.item.module ? { tenantId: ws.tenantId, module: hit.item.module } : null;
}
