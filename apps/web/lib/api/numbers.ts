import { NUMBER_STATES, NUMBER_TYPES, UNAVAILABLE_REASONS, displayNumber, isNumber, type NumberType, type OwnNumber, type PickNumber, type UnavailableReason } from "@/lib/phone-picker/types";

import { ApiContractError, apiRequest } from "./client";
import { isCanonicalUuid } from "./crm";
import { bad, bool, int, oneOf, optStr, readRows, rec, str } from "./shape";

/**
 * The number picker's routes (C1; contract note reports/number-picker-contract-note.md, DRAFT: the shapes may change after C1's probe). SERVER ONLY, with the person's own token.
 *   GET  /numbers/available?type&prefix&page   Owner, Admin   numbers for sale (a read: nothing is reserved; never a price, never a phone-company id)
 *   POST /numbers/claim {number}               Owner + second factor   the server buys it, connects it, attaches it with calls OFF; answers `kyc_pending` until the business is verified (then `ready` or `calls_off`; `getting_ready` while it is being connected)
 *   GET  /numbers                              any member   the workspace's numbers and where each stands
 * The `display` the server sends is not trusted: a number is drawn from its digits (+91 XXXXX XXXXX).
 */
const base = (tenantId: string): string => {
  if (!isCanonicalUuid(tenantId)) throw new ApiContractError("id");
  return `/v1/tenants/${tenantId}/numbers`;
};

function parseOne(row: unknown): PickNumber {
  const x = rec(row, "number");
  const number = str(x.number, "number", 20);
  if (!isNumber(number)) bad("number");
  return { number, display: displayNumber(number), type: oneOf(x.type, NUMBER_TYPES, "type") };
}
export function parseAvailable(json: unknown): { numbers: PickNumber[]; page: number; more: boolean } {
  const x = rec(json, "numbers");
  return { numbers: readRows(x.numbers, "numbers", parseOne, 100), page: int(x.page, "page", 1, 1000), more: bool(x.more, "more") };
}
export function parseOwn(row: unknown): OwnNumber {
  const x = rec(row, "number");
  return { ...parseOne(row), state: oneOf(x.state, NUMBER_STATES, "state"), label: optStr(x.label, "label", 80) };
}
export function parseOwnList(json: unknown): OwnNumber[] {
  return readRows(rec(json, "numbers").numbers, "numbers", parseOwn, 20);
}
/** The closed reason of a `409 numbers_unavailable`: the `reason` or the first of the `fields`; a word outside the contract is dropped. */
export function reasonOf(error: { reason?: string; extra?: { fields?: string[] } }): UnavailableReason | undefined {
  const w = error.reason ?? error.extra?.fields?.[0];
  return (UNAVAILABLE_REASONS as readonly string[]).includes(w ?? "") ? (w as UnavailableReason) : undefined;
}

export async function listAvailable(accessToken: string, tenantId: string, type: NumberType, prefix: string, page: number) {
  const q = new URLSearchParams({ type, page: String(page) });
  if (prefix) q.set("prefix", prefix);
  return parseAvailable(await apiRequest(`${base(tenantId)}/available?${q.toString()}`, accessToken));
}
/** The 201 of a claim carries the number, its state and (since 28 Nov, C1's note) its type; an older answer without the type keeps the type of the list the person picked from. */
export function parseClaimed(json: unknown, type: NumberType): OwnNumber {
  const x = rec(json, "number");
  const number = str(x.number, "number", 20);
  if (!isNumber(number)) bad("number");
  return { number, display: displayNumber(number), type: x.type === undefined ? type : oneOf(x.type, NUMBER_TYPES, "type"), state: oneOf(x.state, NUMBER_STATES, "state"), label: null };
}
export async function claimNumber(accessToken: string, tenantId: string, number: string, type: NumberType): Promise<OwnNumber> {
  return parseClaimed(await apiRequest(`${base(tenantId)}/claim`, accessToken, { method: "POST", body: JSON.stringify({ number }) }), type);
}
export async function listOwn(accessToken: string, tenantId: string): Promise<OwnNumber[]> {
  return parseOwnList(await apiRequest(base(tenantId), accessToken));
}

