import { bad, int, iso, list, oneOf, optStr, rec, str, uuid, word } from "./shape";
import { DNC_REASONS, isMaskedNumber, type DncEntry, type DncPage } from "@/lib/jobs/dnc";

/**
 * The Do-Not-Call list as the contract sends it (FINAL 1.0, section 6): `{id, phone_masked, reason, at, added_by, history[{at, how, by}]}`; reasons `stop_whatsapp | asked_on_call | added_by_owner | other`.
 * Pure parsers, no request (the mock fixtures run through them too: lib/jobs/fixtures.test.ts). Only a MASKED number ever comes back.
 */
export function parseDncEntry(json: unknown): DncEntry {
  const x = rec(json, "do-not-call entry");
  const masked = optStr(x.phone_masked, "phone_masked", 32);
  if (masked === null || !isMaskedNumber(masked)) bad("phone_masked");
  return {
    id: uuid(x.id, "id"),
    phoneMasked: masked,
    reason: oneOf(x.reason, DNC_REASONS, "reason"),
    at: iso(x.at, "at"),
    addedBy: x.added_by === null || x.added_by === undefined ? null : str(x.added_by, "added_by", 60).trim() || null,
    history: list(x.history ?? [], "history", 20).map((row) => {
      const r = rec(row, "history");
      return { at: iso(r.at, "history.at"), how: word(r.how, "history.how", 40), by: oneOf(r.by, ["customer", "owner_recorded"] as const, "history.by") };
    }),
  };
}
export function parseDncPage(json: unknown): DncPage {
  const x = rec(json, "do-not-call list");
  const items = list(x.items, "items", 200).map(parseDncEntry);
  return { items, count: int(x.count ?? items.length, "count", 0, 100_000_000), nextCursor: x.next_cursor === null || x.next_cursor === undefined ? null : (optStr(x.next_cursor, "next_cursor", 300) as string) };
}
