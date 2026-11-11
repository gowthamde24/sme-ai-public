import { forbidden } from "next/navigation";
import { headers } from "next/headers";
import type { ReactNode } from "react";

import { moduleForPath } from "@/lib/packs/guard";
import { requireUser } from "@/lib/auth/session";
import { isCanonicalUuid } from "@/lib/api/crm";
import { moduleOn } from "@/lib/api/pack";
import { readPackCached } from "@/lib/packs/read";

import { readFinderAccessCached } from "../../frame-data";

/**
 * The module guard of a workspace (job CL, blueprint principle 8): a page whose module is OFF for the business type answers 403 (`forbidden.tsx`), even when the address is typed in or an old link is followed.
 * A TEMPLATE, not the layout: a layout stays mounted while the person moves between pages of the workspace, a template is made again for every move, so the check runs on a link as well as on a typed address.
 * The path comes from the proxy (`x-sme-path`, always set there, never from the request). A read that fails other than by a rejected session (or a server with no pack routes) counts as no pack: nothing is refused here, and the API and the
 * database refuse the work regardless: this only keeps the screens honest. Nothing is asked for a page that needs no module (Today, Help, Settings).
 */
export default async function WorkspaceTemplate({ children }: { children: ReactNode }) {
  const needs = moduleForPath((await headers()).get("x-sme-path"));
  if (needs && isCanonicalUuid(needs.tenantId)) {
    const user = await requireUser();
    // the Lead Finder is where ITS API says (C1 #319: a school gets it on AI Workforce though its pack does not list the module); the Prospects page itself answers 404 where it is not
    const finder = needs.module === "lead_finder" ? await readFinderAccessCached(user.accessToken, needs.tenantId).catch(() => null) : null;
    if (finder && finder.access !== "hidden") return <>{children}</>;
    const pack = await readPackCached(user.accessToken, needs.tenantId);
    if (!moduleOn(pack, needs.module)) forbidden();
  }
  return <>{children}</>;
}
