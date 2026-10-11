import { ApiAuthError } from "@/lib/api/client";
import { PAGE_SIZE, MAX_SCANNED, apiFilters, narrow, narrowsItself, type CatalogueQuery } from "@/components/v2/app/catalogue/catalogue-logic";
import { listCatalogueItems, type ItemSummary } from "@/lib/api/catalogue";

const SCAN_PAGE = 50;
const MAX_CURSOR = 400;

/**
 * The catalogue list, read for a query (job BC). The API filters by fabric, colour, occasion, price band and "in stock"; the name search and the stock choices it cannot make ("few left" alone, "made to
 * order") are done here on what was read. When the page narrows by itself it reads on, up to MAX_SCANNED items, until a screenful (PAGE_SIZE) is found; `more` is the cursor to carry on from, or null when
 * the end was reached. A read that fails is `items: null` (the screen says so in that place); a rejected session is thrown again so the page can send the person to sign in.
 */
export async function readCatalogue(accessToken: string, tenantId: string, query: CatalogueQuery, admin: boolean, after: string | null): Promise<{ items: ItemSummary[] | null; more: string | null }> {
  const filters = apiFilters(query, admin);
  const itself = narrowsItself(query);
  const found: ItemSummary[] = [];
  let cursor = after && after.length <= MAX_CURSOR ? after : null;
  let scanned = 0;
  try {
    for (;;) {
      const page = await listCatalogueItems(accessToken, tenantId, { ...filters, after: cursor, limit: itself ? SCAN_PAGE : PAGE_SIZE });
      scanned += page.items.length;
      found.push(...narrow(page.items, query));
      cursor = page.next_cursor;
      if (!itself || cursor === null || found.length >= PAGE_SIZE || scanned >= MAX_SCANNED) break;
    }
  } catch (error) {
    if (error instanceof ApiAuthError) throw error;
    return { items: null, more: null };
  }
  return { items: found, more: cursor };
}
