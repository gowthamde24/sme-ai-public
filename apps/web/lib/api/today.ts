import { ApiContractError, apiRequest } from "./client";
import { isCanonicalUuid } from "./crm";

/**
 * Today, AI usage and the helpers' status (job AD / D3), read from `GET /v1/tenants/{tenant}/today`, `.../ai-usage/today` and `.../agents/status`. Server side only,
 * with the signed-in user's own token. The field names are the contract's, exactly (snake_case, as the API sends them). Money is integer paise.
 * A response that does not match the contract is an error and nothing is shown: never a guess, never a half-filled screen.
 *
 * What a person is shown depends on their role, decided by the database: a Viewer gets zeros and empty lists, Sales get the cards and the recent steps but nothing
 * to approve, an Admin gets approvals, and only the Owner is asked about money held on closed orders. A screen should show what it is given.
 */
export type NeedsYouKind = "quote_approval" | "followup_due" | "order_money_held";
export type NeedsYouAgent = "quote_writer" | "followup_desk" | "order_desk";

export interface NeedsYouItem {
  kind: NeedsYouKind;
  id: string;
  customer: string;
  city: string | null;
  agent: NeedsYouAgent;
  summary: string;
  /** ISO 8601 */
  at: string;
  amount_paise: number | null;
}

export interface RecentStep {
  kind: "order_step";
  order_ref: string;
  customer: string;
  text: string;
  /** ISO 8601 */
  at: string;
}

export interface Today {
  cards: { waiting: number; money_held_paise: number; orders_open: number };
  needs_you: NeedsYouItem[];
  /** at most 5, newest first */
  recent: RecentStep[];
}

export interface AiUsage {
  spent_paise: number;
  cap_paise: number;
  left_paise: number;
}

export const AGENT_KEYS = ["main", "lead_finder", "researcher", "requirement_analyst", "quote_writer", "followup_desk", "order_desk"] as const;
export type AgentKey = (typeof AGENT_KEYS)[number];

export interface AgentStatus {
  agent: AgentKey;
  state: "idle" | "working" | "not_available";
  job: string;
  last_event: { text: string; at: string } | null;
}

type Rec = Record<string, unknown>;
const isRecord = (v: unknown): v is Rec => typeof v === "object" && v !== null && !Array.isArray(v);
function bad(what: string): never {
  throw new ApiContractError(`Unexpected ${what} in a Today response.`);
}

const MAX_PAISE = 1_000_000_000_000;
function paise(v: unknown, what: string): number {
  return typeof v === "number" && Number.isSafeInteger(v) && v >= 0 && v <= MAX_PAISE ? v : bad(what);
}
function count(v: unknown, what: string): number {
  return typeof v === "number" && Number.isSafeInteger(v) && v >= 0 && v <= 1_000_000 ? v : bad(what);
}
function text(v: unknown, what: string, max = 600): string {
  return typeof v === "string" && v.trim() !== "" && v.length <= max ? v : bad(what);
}
function when(v: unknown, what: string): string {
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}T/.test(v) && !Number.isNaN(Date.parse(v)) ? v : bad(what);
}

const KINDS: readonly NeedsYouKind[] = ["quote_approval", "followup_due", "order_money_held"];
const AGENTS: readonly NeedsYouAgent[] = ["quote_writer", "followup_desk", "order_desk"];

export function parseNeedsYouItem(json: unknown): NeedsYouItem {
  if (!isRecord(json)) return bad("item");
  const { kind, id, customer, city, agent, summary, at, amount_paise: amount } = json;
  if (!KINDS.includes(kind as NeedsYouKind)) return bad("kind");
  if (typeof id !== "string" || !isCanonicalUuid(id)) return bad("id");
  if (!AGENTS.includes(agent as NeedsYouAgent)) return bad("agent");
  if (city !== null && (typeof city !== "string" || city.length > 200)) return bad("city");
  return {
    kind: kind as NeedsYouKind,
    id,
    customer: text(customer, "customer", 200),
    city: city as string | null,
    agent: agent as NeedsYouAgent,
    summary: text(summary, "summary"),
    at: when(at, "at"),
    amount_paise: amount === null ? null : paise(amount, "amount_paise"),
  };
}

export function parseRecentStep(json: unknown): RecentStep {
  if (!isRecord(json)) return bad("step");
  if (json.kind !== "order_step") return bad("step kind");
  return {
    kind: "order_step",
    order_ref: text(json.order_ref, "order_ref", 60),
    customer: text(json.customer, "customer", 200),
    text: text(json.text, "text"),
    at: when(json.at, "at"),
  };
}

export function parseToday(json: unknown): Today {
  if (!isRecord(json) || !isRecord(json.cards) || !Array.isArray(json.needs_you) || !Array.isArray(json.recent)) return bad("body");
  if (json.recent.length > 5) return bad("recent steps (more than five)");
  return {
    cards: {
      waiting: count(json.cards.waiting, "waiting"),
      money_held_paise: paise(json.cards.money_held_paise, "money_held_paise"),
      orders_open: count(json.cards.orders_open, "orders_open"),
    },
    needs_you: json.needs_you.map(parseNeedsYouItem),
    recent: json.recent.map(parseRecentStep),
  };
}

export function parseAiUsage(json: unknown): AiUsage {
  if (!isRecord(json)) return bad("usage body");
  const usage = { spent_paise: paise(json.spent_paise, "spent_paise"), cap_paise: paise(json.cap_paise, "cap_paise"), left_paise: paise(json.left_paise, "left_paise") };
  if (usage.left_paise > usage.cap_paise) return bad("usage (more left than the cap)");
  return usage;
}

export function parseAgentsStatus(json: unknown): AgentStatus[] {
  if (!Array.isArray(json) || json.length !== AGENT_KEYS.length) return bad("helpers list (it is always all seven)");
  return json.map((row, i) => {
    if (!isRecord(row)) return bad("helper");
    if (row.agent !== AGENT_KEYS[i]) return bad("helper order");
    if (row.state !== "idle" && row.state !== "working" && row.state !== "not_available") return bad("helper state");
    let last: AgentStatus["last_event"] = null;
    if (row.last_event !== null) {
      if (!isRecord(row.last_event)) return bad("last_event");
      last = { text: text(row.last_event.text, "last_event text"), at: when(row.last_event.at, "last_event at") };
    }
    return { agent: AGENT_KEYS[i], state: row.state, job: text(row.job, "job"), last_event: last };
  });
}

const tenantPath = (tenantId: string, tail: string) => `/v1/tenants/${encodeURIComponent(tenantId)}/${tail}`;

/** `GET /v1/tenants/{tenant}/today`: what waits for the caller, the money held, the open orders, the last five order steps. Any member. */
export async function getToday(accessToken: string, tenantId: string): Promise<Today> {
  return parseToday(await apiRequest(tenantPath(tenantId, "today"), accessToken));
}

/** `GET /v1/tenants/{tenant}/ai-usage/today`: today's AI spend against the cap, in paise. Owner and Admin only (403 for anyone else). */
export async function getAiUsageToday(accessToken: string, tenantId: string): Promise<AiUsage> {
  return parseAiUsage(await apiRequest(tenantPath(tenantId, "ai-usage/today"), accessToken));
}

/** `GET /v1/tenants/{tenant}/agents/status`: the seven helpers, always all seven in this order. Any member. */
export async function getAgentsStatus(accessToken: string, tenantId: string): Promise<AgentStatus[]> {
  return parseAgentsStatus(await apiRequest(tenantPath(tenantId, "agents/status"), accessToken));
}
