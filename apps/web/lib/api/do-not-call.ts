import { ApiContractError, apiRequest } from "./client";
import { isCanonicalUuid } from "./crm";
import { parseDncEntry, parseDncPage } from "./do-not-call-parse";
import { bad } from "./shape";
import { indianMobile, maskIndianMobile, type DncEntry, type DncPage } from "@/lib/jobs/dnc";
import { MOCK_DNC, MOCK_DNC_COUNT } from "@/lib/jobs/dnc-mock";
import { jobsScreens } from "@/lib/screens/flag";

/**
 * The Do-Not-Call list (JOBS; C1's contract, FINAL 1.0, section 6: the wire names live in lib/api/do-not-call-parse.ts and the paths in THIS file). SERVER ONLY, with the signed-in person's own token.
 *   GET /do-not-call?q&cursor -> {items: [{id, phone_masked, reason, at, added_by, history}], count, next_cursor}
 *   POST /do-not-call {phone} -> the entry          POST /do-not-call/{id}/remove (Owner only; the project allows no HTTP DELETE route; `409 stopped_by_customer` for a number the customer stopped)
 * Only a MASKED number ever comes back. With JOBS=mock the made-up list of lib/jobs/dnc-mock.ts answers and nothing leaves the server.
 */
const base = (tenantId: string): string => {
  if (!isCanonicalUuid(tenantId)) throw new ApiContractError("Unexpected workspace id.");
  return `/v1/tenants/${tenantId}/do-not-call`;
};

export { parseDncEntry, parseDncPage };

const digitsOf = (s: string): string => s.replace(/\D/g, "");
/** `GET /do-not-call`; null when the screens are off or the API does not have the list yet (the page then says so). `q` is what the person typed in the search box. */
export async function readDnc(token: string, tenantId: string, q: { q?: string | null; cursor?: string | null } = {}): Promise<DncPage | null> {
  const mode = jobsScreens();
  if (mode === "off") return null;
  const search = (q.q ?? "").trim().slice(0, 40);
  if (mode === "mock") {
    const items = MOCK_DNC.filter((e) => search === "" || (digitsOf(search) !== "" ? digitsOf(e.phoneMasked).includes(digitsOf(search)) : false));
    return { items, count: search === "" ? MOCK_DNC_COUNT : items.length, nextCursor: null };
  }
  try {
    const p = new URLSearchParams();
    if (search) p.set("q", search);
    if (q.cursor) p.set("cursor", q.cursor.slice(0, 300));
    return parseDncPage(await apiRequest(`${base(tenantId)}${p.size ? `?${p}` : ""}`, token));
  } catch {
    return null;
  }
}

/** `POST /do-not-call {phone}`: an Indian mobile number as +91 and ten digits (Owner and Admin). A number that is not one is refused here, before anything is sent. */
export async function addDnc(token: string, tenantId: string, typed: string): Promise<DncEntry> {
  const phone = indianMobile(typed);
  if (phone === null) bad("phone");
  if (jobsScreens() === "mock") return { id: "77777777-7777-4777-8777-777777777799", phoneMasked: maskIndianMobile(phone), reason: "added_by_owner", at: new Date().toISOString(), addedBy: null, history: [] };
  return parseDncEntry(await apiRequest(base(tenantId), token, { method: "POST", body: JSON.stringify({ phone }) }));
}

/** `POST /do-not-call/{id}/remove` (the Owner only; no HTTP DELETE in this project). */
export async function removeDnc(token: string, tenantId: string, id: string): Promise<void> {
  if (!isCanonicalUuid(id)) bad("id");
  if (jobsScreens() === "mock") return;
  await apiRequest(`${base(tenantId)}/${id}/remove`, token, { method: "POST", body: JSON.stringify({}) });
}
