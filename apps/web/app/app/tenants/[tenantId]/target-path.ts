import { ApiAuthError } from "@/lib/api/client";
import { fetchQuote, fetchQuotes } from "@/lib/api/quotes";
import type { Target } from "@/lib/api/today";

/**
 * "Open" for something the API names by `target` ({type, id}): the page of this workspace that decides it. An order, a lead (its follow-ups) and an enquiry have a page; a QUOTE has no page
 * of its own and opens the enquiry it belongs to, found from the newest 50 quotes (`fetchQuotes`) or, for an older one, from the quote itself; if neither can be read it opens the list of quotes.
 * One call for all the targets of a screen. Never throws except for a rejected session.
 */
export async function targetPaths(accessToken: string, tenantId: string, targets: readonly Target[]): Promise<(target: Target) => string> {
  const base = `/app/tenants/${tenantId}`;
  const enquiryOfQuote = await findEnquiries(accessToken, tenantId, targets.flatMap((t) => (t.type === "quote" ? [t.id] : [])));
  return (target) => {
    switch (target.type) {
      case "order":
        return `${base}/orders/${target.id}`;
      case "lead":
        return `${base}/leads/${target.id}`;
      case "enquiry":
        return `${base}/enquiries/${target.id}`;
      case "quote": {
        const enquiry = enquiryOfQuote.get(target.id);
        return enquiry ? `${base}/enquiries/${enquiry}?quote=${target.id}` : `${base}/quotes`;
      }
    }
  };
}

/** quote id -> the id of its enquiry, for the quotes asked about. Never throws except for a rejected session: a quote it cannot place is simply missing from the map. */
async function findEnquiries(accessToken: string, tenantId: string, quoteIds: string[]): Promise<Map<string, string>> {
  const found = new Map<string, string>();
  if (quoteIds.length === 0) return found;
  try {
    for (const q of await fetchQuotes(accessToken, tenantId, 50)) found.set(q.id, q.enquiry_id);
  } catch (error) {
    if (error instanceof ApiAuthError) throw error;
  }
  const missing = [...new Set(quoteIds)].filter((id) => !found.has(id));
  const each = await Promise.allSettled(missing.map((id) => fetchQuote(accessToken, tenantId, id)));
  each.forEach((r, i) => {
    if (r.status === "fulfilled") found.set(missing[i], r.value.enquiry_id);
    else if (r.reason instanceof ApiAuthError) throw r.reason;
  });
  return found;
}
