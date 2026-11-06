import { headers } from "next/headers";
import { cache } from "react";

import { getBillingAccess } from "@/lib/api/billing-access";
import { fetchTenant } from "@/lib/api/client";
import { isCanonicalUuid } from "@/lib/api/crm";
import { demoVideo } from "@/lib/screens/flag";

/**
 * Who may open the demo-video mode (job demo-video): the scripted story on Today that a presenter records for a 60-second video. SERVER ONLY. All three must hold, and any read that fails is "no":
 *   1. the flag `DEMO_VIDEO` is `on` (or `1`) on this server (off unless set; staging only);
 *   2. the person is the Owner or an Admin of the workspace (the API's own role, read with their token);
 *   3. the API itself says the workspace is a DEMO one (`demo: true` on `GET /billing/access`). The NAME is never enough here ("DEMO ..." is only a hint elsewhere): a real customer can call a business anything.
 * The mode itself reads nothing and writes nothing: every screen of the story is drawn from fixtures in the browser (lib/demo-video/fixtures.ts), so even a wrong "yes" could only show invented data on that person's own screen.
 */
export const demoVideoAllowed = cache(async (accessToken: string, tenantId: string): Promise<boolean> => {
  if (!demoVideo() || !isCanonicalUuid(tenantId)) return false;
  try {
    const [tenant, access] = await Promise.all([fetchTenant(accessToken, tenantId), getBillingAccess(accessToken, tenantId)]);
    return (tenant.role === "owner" || tenant.role === "admin") && access.demo === true;
  } catch {
    return false;
  }
});

/** The word of the address that asks for the mode on any screen: `?demo=video` (it goes to the story's own page). */
export const DEMO_VIDEO_QUERY = { name: "demo", value: "video" } as const;
/** The story's own page inside a workspace (its own route, so Today's first load carries none of it). */
export const DEMO_VIDEO_PATH = "/demo-video";

const TENANT_PATH = /^\/app\/tenants\/([0-9a-fA-F-]{36})(\/[^?#]*)?$/;

/**
 * Where an address (path and query, as the proxy records it in `x-sme-path`) asks for the mode: the workspace, and whether it is the story's own page (`stage`; any other screen asked with `?demo=video` goes there).
 * null = it does not ask (neither the page nor `demo=video`, or not inside a workspace). It decides nothing on its own: `demoVideoAllowed` is always asked as well.
 */
export function videoAddress(pathWithSearch: string | null | undefined): { tenantId: string; stage: boolean } | null {
  if (!pathWithSearch) return null;
  let url: URL;
  try {
    url = new URL(pathWithSearch, "https://address.invalid");
  } catch {
    return null;
  }
  const m = TENANT_PATH.exec(url.pathname);
  if (!m || !isCanonicalUuid(m[1])) return null;
  const stage = (m[2] ?? "").replace(/\/$/, "") === DEMO_VIDEO_PATH;
  if (!stage && url.searchParams.get(DEMO_VIDEO_QUERY.name) !== DEMO_VIDEO_QUERY.value) return null;
  return { tenantId: m[1], stage };
}

/** The address of the mode for a workspace (step 1 of the story). */
export const videoHref = (tenantId: string): string => `/app/tenants/${tenantId}${DEMO_VIDEO_PATH}`;

/** The address of this request as the proxy recorded it (`x-sme-path`, set on every request, never taken from the browser), read for the mode; outside a request (a test) none. */
export async function requestVideoAddress(): Promise<{ tenantId: string; stage: boolean } | null> {
  try {
    return videoAddress((await headers()).get("x-sme-path"));
  } catch {
    return null;
  }
}
