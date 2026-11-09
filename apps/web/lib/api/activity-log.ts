import { ApiContractError, apiRequest } from "./client";
import { isCanonicalUuid } from "./crm";

/**
 * "Everything it did" on the API's own timeline (C1's docs/contracts/activity-limits.md): `GET /v1/tenants/{t}/activity-log?limit=&cursor=&kind=call|message|action` (Owner, Admin) -> `{items, next_cursor}`, newest first. Only the fields the
 * page draws are kept; a row that does not match is left out, never drawn wrong. No message text comes back (a message says its category, status and who it went to). An Undo is real only where `undo.state` is "available".
 */
export type LogKind = "call" | "message" | "action";
export type LogItem = {
  key: string;
  kind: LogKind;
  id: string;
  at: string;
  waiting: boolean;
  undo: "available" | "done" | "expired" | "none";
  who: string | null;
  summary: string | null;
  status: string | null;
  direction: "inbound" | "outbound" | null;
  contactName: string | null;
  leadId: string | null;
  sandbox: boolean;
  refused: boolean;
};
export type LogPage = { items: LogItem[]; nextCursor: string | null };

const isRec = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown, max: number): string | null => (typeof v === "string" && v.trim() !== "" ? v.trim().slice(0, max) : null);
const iso = (v: unknown): string | null => (typeof v === "string" && v.length <= 40 && !Number.isNaN(Date.parse(v)) ? v : null);

export function parseLogItem(raw: unknown): LogItem | null {
  if (!isRec(raw)) return null;
  const kind = raw.kind === "call" || raw.kind === "message" || raw.kind === "action" ? raw.kind : null;
  const at = iso(raw.at);
  const id = typeof raw.id === "string" && isCanonicalUuid(raw.id) ? raw.id : null;
  const key = str(raw.key, 80);
  if (!kind || !at || !id || !key) return null;
  const undoState = isRec(raw.undo) ? raw.undo.state : null;
  return {
    key,
    kind,
    id,
    at,
    waiting: raw.waiting === true,
    undo: undoState === "available" || undoState === "done" || undoState === "expired" ? undoState : "none",
    who: str(raw.who, 40),
    summary: str(raw.summary, 400),
    status: str(raw.status, 40),
    direction: raw.direction === "inbound" || raw.direction === "outbound" ? raw.direction : null,
    contactName: str(raw.contact_name, 120),
    leadId: typeof raw.lead_id === "string" && isCanonicalUuid(raw.lead_id) ? raw.lead_id : null,
    sandbox: raw.sandbox === true,
    refused: kind === "call" && raw.state === "refused",
  };
}
export function parseLogPage(json: unknown): LogPage {
  if (!isRec(json) || !Array.isArray(json.items)) throw new ApiContractError("Unexpected activity log.");
  return { items: json.items.slice(0, 100).map(parseLogItem).filter((x): x is LogItem => x !== null), nextCursor: str(json.next_cursor, 300) };
}

export async function listActivityLog(token: string, tenantId: string, opts: { kind?: LogKind; limit?: number; cursor?: string | null } = {}): Promise<LogPage> {
  if (!isCanonicalUuid(tenantId)) throw new ApiContractError("id");
  const q = new URLSearchParams({ limit: String(Math.min(Math.max(opts.limit ?? 50, 1), 100)) });
  if (opts.kind) q.set("kind", opts.kind);
  if (opts.cursor) q.set("cursor", opts.cursor);
  return parseLogPage(await apiRequest(`/v1/tenants/${tenantId}/activity-log?${q}`, token));
}
