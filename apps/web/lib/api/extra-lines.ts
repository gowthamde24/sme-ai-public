import { LINE_STATUSES, type ExtraLine, type ExtraLines } from "@/lib/extra-lines/types";

import { ApiContractError, apiRequest } from "./client";
import { isCanonicalUuid } from "./crm";
import { bool, int, iso, list, oneOf, optIso, rec, uuid } from "./shape";

/**
 * Extra lines' routes (C1, 26 Nov 2026; docs/contracts/extra-lines.md). SERVER ONLY, with the person's own token.
 *   GET  /extra-lines                    Owner, Admin   the price, the limit, the lines and what is bought (404 while the API switch EXTRA_LINES is off)
 *   POST /extra-lines {key}              Owner (+ second factor when on)   one line, paid from the credits; `409 lines_unavailable` with a closed `reason`
 *   POST /extra-lines/{id}/cancel|keep   Owner   the line works to the end of the paid month, or takes the cancel back
 */
const base = (tenantId: string): string => {
  if (!isCanonicalUuid(tenantId)) throw new ApiContractError("id");
  return `/v1/tenants/${tenantId}/extra-lines`;
};

export function parseLine(row: unknown): ExtraLine {
  const x = rec(row, "line");
  return { id: uuid(x.id, "id"), status: oneOf(x.status, LINE_STATUSES, "status"), working: bool(x.working, "working"), paidUntil: iso(x.paid_until, "paid_until"), cancelAtEnd: bool(x.cancel_at_period_end, "cancel_at_period_end"), graceUntil: optIso(x.grace_until, "grace_until") };
}
export function parseOverview(json: unknown): ExtraLines {
  const x = rec(json, "extra-lines");
  const out: ExtraLines = {
    enabled: bool(x.enabled, "enabled"),
    priceRupees: int(x.price_rupees, "price_rupees", 0, 100000),
    cap: int(x.cap, "cap", 0, 100),
    numbers: int(x.numbers, "numbers", 0, 1000),
    included: int(x.included, "included", 0, 1000),
    total: int(x.total, "total", 0, 1000),
    canAdd: bool(x.can_add, "can_add"),
    extra: list(x.extra, "extra", 100).map(parseLine),   // a line that does not read is an answer that does not add up: never drawn, never guessed
  };
  return out;
}

export async function readOverview(accessToken: string, tenantId: string): Promise<ExtraLines> {
  return parseOverview(await apiRequest(base(tenantId), accessToken));
}
export async function addLine(accessToken: string, tenantId: string, key: string): Promise<ExtraLine> {
  return parseLine(await apiRequest(base(tenantId), accessToken, { method: "POST", body: JSON.stringify({ key }) }));
}
export async function changeLine(accessToken: string, tenantId: string, lineId: string, move: "cancel" | "keep"): Promise<ExtraLine> {
  if (!isCanonicalUuid(lineId)) throw new ApiContractError("id");
  return parseLine(await apiRequest(`${base(tenantId)}/${lineId}/${move}`, accessToken, { method: "POST" }));
}
