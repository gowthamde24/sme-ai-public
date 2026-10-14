import { headers } from "next/headers";

import { ProblemView } from "@/components/v2/app/robust/ProblemView";
import { appDict } from "@/i18n/app";
import { getLang } from "@/i18n/get-lang";
import { moduleForPath } from "@/lib/packs/guard";

/**
 * The 403 page of a part the business type does not have (job CL): drawn inside the frame by `forbidden()` from the workspace's template. One closed sentence in the person's language and the way back to Today
 * (the template does not say which module, nor what the business type is: the page says only that this part is not switched on).
 */
export default async function Forbidden() {
  const dict = appDict(await getLang()) as Record<string, string>;
  const labels = Object.fromEntries(Object.entries(dict).filter(([k]) => k.startsWith("problem.")));
  const needs = moduleForPath((await headers()).get("x-sme-path"));
  return <ProblemView kind={403} variant="module" labels={labels} homeHref={needs ? `/app/tenants/${needs.tenantId}` : undefined} />;
}
