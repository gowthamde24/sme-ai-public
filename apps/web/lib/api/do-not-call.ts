import { ApiContractError, apiRequest } from "./client";
import { isCanonicalUuid } from "./crm";
import { bad, int, iso, list, oneOf, optStr, rec, uuid } from "./shape";
import { DNC_REASONS, indianMobile, isMaskedNumber, maskIndianMobile, type DncEntry, type DncPage } from "@/lib/jobs/dnc";
import { MOCK_DNC, MOCK_DNC_COUNT } from "@/lib/jobs/dnc-mock";
import { jobsScreens } from "@/lib/screens/flag";

/**
 * The Do-Not-Call list (JOBS; contracts/jobs-web-needs.md section 7, C1's contract draft is the final word, so the wire names live in THIS file only). SERVER ONLY, with the signed-in person's own token.
 *   GET /do-not-call?q&cursor -> {items: [{id, phone_masked, reason, at}], count, next_cursor}
 *   POST /do-not-call {phone} -> the entry          POST /do-not-call/{id}/remove (Owner only; the project allows no HTTP DELETE route, so the needs doc's `DELETE /{id}` is asked as a POST)
 * Only a MASKED number ever comes back. With JOBS=mock the made-up list of lib/jobs/dnc-mock.ts answers and nothing leaves the server.
 */
const base = (tenantId: string): string => {
  if (!isCanonicalUuid(tenantId)) throw new ApiContractError("Unexpected workspace id.");
  return `/v1/tenants/${tenantId}/do-not-call`;
};

export function parseDncEntry(json: unknown): DncEntry {
  const x = rec(json, "do-not-call entry");
  const masked = optStr(x.phone_masked, "phone_masked", 32);
  if (masked === null || !isMaskedNumber(masked)) bad("phone_masked");
  return { id: uuid(x.id, "id"), phoneMasked: masked, reason: oneOf(x.reason, DNC_REASONS, "reason"), at: iso(x.at, "at") };
}
export function parseDncPage(json: unknown): DncPage {
  const x = rec(json, "do-not-call list");
  const items = list(x.items, "items", 200).map(parseDncEntry);
  return { items, count: int(x.count ?? items.length, "count", 0, 100_000_000), nextCursor: x.next_cursor === null || x.next_cursor === undefined ? null : (optStr(x.next_cursor, "next_cursor", 300) as string) };
}

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
  if (jobsScreens() === "mock") return { id: "77777777-7777-4777-8777-777777777799", phoneMasked: maskIndianMobile(phone), reason: "added_by_owner", at: new Date().toISOString() };
  return parseDncEntry(await apiRequest(base(tenantId), token, { method: "POST", body: JSON.stringify({ phone }) }));
}

/** `POST /do-not-call/{id}/remove` (the Owner only; no HTTP DELETE in this project). */
export async function removeDnc(token: string, tenantId: string, id: string): Promise<void> {
  if (!isCanonicalUuid(id)) bad("id");
  if (jobsScreens() === "mock") return;
  await apiRequest(`${base(tenantId)}/${id}/remove`, token, { method: "POST", body: JSON.stringify({}) });
}
