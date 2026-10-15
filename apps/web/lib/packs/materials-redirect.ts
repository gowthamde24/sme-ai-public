import { redirect } from "next/navigation";

import { hasModule } from "./has";
import { readPackCached } from "./read";

/**
 * A page that belongs to the saree price list (item types, the price-list file, a saree "product") has no meaning for a business that sells by area, weight or piece (module `materials`, job CO): that business's
 * products and rules are in the catalogue and in the quote rules. Such a request is sent there instead of drawing saree words. Asked by module, never by business type.
 */
export async function sendMaterialsBusinessTo(accessToken: string, tenantId: string, tail: string): Promise<void> {
  if (hasModule(await readPackCached(accessToken, tenantId).catch(() => null), "materials")) redirect(`/app/tenants/${tenantId}${tail}`);
}

/** The query string of a page's search parameters as it came (`?a=1&b=2`, or empty), to carry a filter or a cursor across a redirect. Only plain string values are kept. */
export function rawQuery(raw: Record<string, string | string[] | undefined>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(raw)) {
    const one = Array.isArray(v) ? v[0] : v;
    if (typeof one === "string") q.set(k, one);
  }
  const text = q.toString();
  return text ? `?${text}` : "";
}
