import type {
  AgentCostOut,
  AgentSettingsOut,
  ClaimEvidenceOut,
  ClaimSuggestionOut,
  PageRunOut,
  ReviewIn,
  ReviewOut,
  RunOut,
} from "@contracts";

import { ApiContractError, apiRequest } from "./client";
import { isCanonicalUuid } from "./crm";

/**
 * Server-side client for the agent endpoints of OUR API (T006, ADR 0013).
 *
 * An agent claim is a SUGGESTION until a human accepts it. Claim values are UNTRUSTED text (a model
 * wrote them, from text a stranger controls): they are parsed here and rendered as plain text only
 * (a guard test enforces that). Types come from packages/contracts/agents.ts (generated).
 */
export type {
  AgentCostOut,
  AgentSettingsOut,
  ClaimEvidenceOut,
  ClaimSuggestionOut,
  PageRunOut,
  ReviewOut,
  RunOut,
} from "@contracts";

export type RunStatus = RunOut["status"];
export type ReviewState = ClaimSuggestionOut["review_state"];
export type ReviewReason = NonNullable<ReviewIn["reason_code"]>;
export type ReviewConfidence = NonNullable<ReviewIn["confidence"]>;
export type SuggestionTarget = "companies" | "leads";

export const REVIEW_CONFIDENCES: readonly ReviewConfidence[] = ["low", "medium", "high"];
export const REVIEW_REASONS: readonly ReviewReason[] = [
  "incorrect",
  "unsupported_by_evidence",
  "outdated",
  "duplicate",
  "not_relevant",
];
export const REVIEW_REASON_LABELS: Record<ReviewReason, string> = {
  incorrect: "Incorrect",
  unsupported_by_evidence: "Not supported by the evidence",
  outdated: "Outdated",
  duplicate: "Duplicate",
  not_relevant: "Not relevant",
};
export const CONFIDENCE_LABELS: Record<ReviewConfidence, string> = {
  low: "Low confidence",
  medium: "Medium confidence",
  high: "High confidence",
};

/** The run states a person sees: nothing is "Approved" or "Sent" unless a human did it. */
export const RUN_STATUS_LABELS: Record<RunStatus, string> = {
  running: "Running",
  succeeded: "Completed",
  failed: "Failed",
  cancelled: "Cancelled",
  expired: "Failed (expired)",
  killed: "Failed (switched off)",
};

/** Why a run failed, in words (shown only for a run that failed; a cancelled or switched-off run says so by its status). */
export const RUN_ERROR_LABELS: Record<NonNullable<RunOut["error_code"]>, string> = {
  budget: "it used up its budget",
  expired: "it ran out of time",
  killed: "agents were switched off",
  cancelled: "it was cancelled",
  disabled: "agents were off",
  tool_failed: "a step failed",
  model_failed: "the model did not answer",
  invalid_output: "the model's answer was unusable",
};

// ----------------------------------------------------------------------------- parsing
function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function bad(what: string): never {
  throw new ApiContractError(`Unexpected ${what} in an agent response.`);
}
function str(r: Record<string, unknown>, key: string): string {
  const v = r[key];
  return typeof v === "string" ? v : bad(key);
}
function strOrNull(r: Record<string, unknown>, key: string): string | null {
  const v = r[key];
  return v === null ? null : typeof v === "string" ? v : bad(key);
}
function num(r: Record<string, unknown>, key: string): number {
  const v = r[key];
  return typeof v === "number" && Number.isFinite(v) ? v : bad(key);
}
function bool(r: Record<string, unknown>, key: string): boolean {
  const v = r[key];
  return typeof v === "boolean" ? v : bad(key);
}
function oneOf<T extends string>(
  r: Record<string, unknown>,
  key: string,
  allowed: readonly T[],
): T {
  const v = r[key];
  return typeof v === "string" && (allowed as readonly string[]).includes(v)
    ? (v as T)
    : bad(key);
}
function oneOfOrNull<T extends string>(
  r: Record<string, unknown>,
  key: string,
  allowed: readonly T[],
): T | null {
  return r[key] === null ? null : oneOf(r, key, allowed);
}

const STATUSES = ["running", "succeeded", "failed", "cancelled", "expired", "killed"] as const;
const ERRORS = [
  "budget",
  "expired",
  "killed",
  "cancelled",
  "disabled",
  "tool_failed",
  "model_failed",
  "invalid_output",
] as const;
const CONFIDENCES = ["unverified", "low", "medium", "high"] as const;
const STATES = ["not_applicable", "unreviewed", "accepted", "rejected"] as const;
const ORIGINS = ["manual", "import", "agent"] as const;

export function parseRun(json: unknown): RunOut {
  if (!isRecord(json)) return bad("run");
  return {
    id: str(json, "id"),
    agent_name: str(json, "agent_name"),
    agent_version: str(json, "agent_version"),
    status: oneOf(json, "status", STATUSES),
    started_by: str(json, "started_by"),
    company_id: strOrNull(json, "company_id"),
    lead_id: strOrNull(json, "lead_id"),
    created_at: str(json, "created_at"),
    expires_at: str(json, "expires_at"),
    finished_at: strOrNull(json, "finished_at"),
    error_code: oneOfOrNull(json, "error_code", ERRORS),
    cancel_requested: bool(json, "cancel_requested"),
    max_writes: num(json, "max_writes"),
    writes_used: num(json, "writes_used"),
    max_tool_calls: num(json, "max_tool_calls"),
    tool_calls_used: num(json, "tool_calls_used"),
    max_input_tokens: num(json, "max_input_tokens"),
    input_tokens_used: num(json, "input_tokens_used"),
    max_output_tokens: num(json, "max_output_tokens"),
    output_tokens_used: num(json, "output_tokens_used"),
    max_cost_micros: num(json, "max_cost_micros"),
    cost_micros_used: num(json, "cost_micros_used"),
  };
}

export function parseRunPage(json: unknown): PageRunOut {
  if (!isRecord(json) || !Array.isArray(json.items)) return bad("page");
  const next = json.next_cursor;
  if (next !== null && typeof next !== "string") bad("cursor");
  return { items: json.items.map(parseRun), next_cursor: next };
}

const STANCES = ["supports", "context", "contradicts"] as const;

/** One cited piece of evidence. EVERY field is untrusted text (a model chose the quote from a page a stranger controls):
 * the screens render it as plain text and never build a link, an image or a frame from it. */
export function parseClaimEvidence(json: unknown): ClaimEvidenceOut {
  if (!isRecord(json)) return bad("evidence");
  return {
    kind: str(json, "kind"),
    stance: oneOf(json, "stance", STANCES),
    provider: str(json, "provider"),
    host: strOrNull(json, "host"),
    path: strOrNull(json, "path"),
    quote: strOrNull(json, "quote"),
  };
}

export function parseClaim(json: unknown): ClaimSuggestionOut {
  if (!isRecord(json)) return bad("claim");
  const evidence = json.evidence;
  if (evidence !== undefined && !Array.isArray(evidence)) return bad("evidence");
  return {
    id: str(json, "id"),
    company_id: strOrNull(json, "company_id"),
    lead_id: strOrNull(json, "lead_id"),
    predicate: str(json, "predicate"),
    value: str(json, "value"),
    confidence: oneOf(json, "confidence", CONFIDENCES),
    claim_confidence: oneOf(json, "claim_confidence", CONFIDENCES),
    created_via: oneOf(json, "created_via", ORIGINS),
    agent_run_id: strOrNull(json, "agent_run_id"),
    created_by: strOrNull(json, "created_by"),
    created_at: str(json, "created_at"),
    review_state: oneOf(json, "review_state", STATES),
    review_confidence: oneOfOrNull(json, "review_confidence", REVIEW_CONFIDENCES),
    reviewed_by: strOrNull(json, "reviewed_by"),
    reviewed_at: strOrNull(json, "reviewed_at"),
    counts_toward_score: json.counts_toward_score === true,
    company_name: json.company_name === undefined ? null : strOrNull(json, "company_name"),
    evidence: (evidence ?? []).map(parseClaimEvidence),
  };
}

export function parseSettings(json: unknown): AgentSettingsOut {
  if (!isRecord(json)) return bad("settings");
  return { enabled: bool(json, "enabled") };
}

export function parseReviewOut(json: unknown): ReviewOut {
  if (!isRecord(json)) return bad("review");
  return {
    review_id: str(json, "review_id"),
    replayed: bool(json, "replayed"),
    self_review: bool(json, "self_review"),
  };
}

// ----------------------------------------------------------------------------- requests
function checked(tenantId: string, ...ids: string[]): void {
  if (!isCanonicalUuid(tenantId) || ids.some((id) => !isCanonicalUuid(id)))
    throw new ApiContractError("id");
}

export async function fetchAgentSettings(
  accessToken: string,
  tenantId: string,
): Promise<AgentSettingsOut> {
  checked(tenantId);
  return parseSettings(
    await apiRequest(`/v1/tenants/${tenantId}/agent-settings`, accessToken),
  );
}

export async function setAgentsEnabled(
  accessToken: string,
  tenantId: string,
  enabled: boolean,
): Promise<AgentSettingsOut> {
  checked(tenantId);
  return parseSettings(
    await apiRequest(`/v1/tenants/${tenantId}/agent-settings`, accessToken, {
      method: "PUT",
      body: JSON.stringify({ enabled }),
    }),
  );
}

export async function fetchRuns(
  accessToken: string,
  tenantId: string,
  limit = 20,
): Promise<PageRunOut> {
  checked(tenantId);
  return parseRunPage(
    await apiRequest(
      `/v1/tenants/${tenantId}/agent-runs?limit=${limit}`,
      accessToken,
    ),
  );
}

/** Idempotent on `id`: an identical retry answers 200 with the same run. */
export async function startSelftestRun(
  accessToken: string,
  tenantId: string,
  input: { id: string; companyId: string },
): Promise<RunOut> {
  checked(tenantId, input.id, input.companyId);
  return parseRun(
    await apiRequest(`/v1/tenants/${tenantId}/agent-runs`, accessToken, {
      method: "POST",
      body: JSON.stringify({
        id: input.id,
        agent: "selftest",
        target_kind: "company",
        target_id: input.companyId,
      }),
    }),
  );
}

/** The Research Agent on one LEAD (it reads the lead's company's own website). Idempotent on `id`. */
export async function startResearchRun(
  accessToken: string,
  tenantId: string,
  input: { id: string; leadId: string },
): Promise<RunOut> {
  checked(tenantId, input.id, input.leadId);
  return parseRun(
    await apiRequest(`/v1/tenants/${tenantId}/agent-runs`, accessToken, {
      method: "POST",
      body: JSON.stringify({
        id: input.id,
        agent: "research",
        target_kind: "lead",
        target_id: input.leadId,
      }),
    }),
  );
}

export async function cancelRun(
  accessToken: string,
  tenantId: string,
  runId: string,
): Promise<void> {
  checked(tenantId, runId);
  await apiRequest(
    `/v1/tenants/${tenantId}/agent-runs/${runId}/cancel`,
    accessToken,
    { method: "POST" },
  );
}

export async function fetchClaims(
  accessToken: string,
  tenantId: string,
  target: SuggestionTarget,
  targetId: string,
): Promise<ClaimSuggestionOut[]> {
  checked(tenantId, targetId);
  const json = await apiRequest(
    `/v1/tenants/${tenantId}/${target}/${targetId}/claims`,
    accessToken,
  );
  if (!Array.isArray(json)) return bad("claims");
  return json.map(parseClaim);
}

/** The workspace's agent suggestions (newest first), each with its company's name and the evidence it cites. */
export async function fetchAgentClaims(
  accessToken: string,
  tenantId: string,
  state: "unreviewed" | "all" = "unreviewed",
  limit = 50,
): Promise<ClaimSuggestionOut[]> {
  checked(tenantId);
  const json = await apiRequest(
    `/v1/tenants/${tenantId}/agent-claims?state=${state}&limit=${limit}`,
    accessToken,
  );
  if (!Array.isArray(json)) return bad("claims");
  return json.map(parseClaim);
}

export type ReviewInput = {
  id: string;
} & (
  | { decision: "accepted"; confidence: ReviewConfidence }
  | { decision: "rejected"; reason_code?: ReviewReason }
);

/** Idempotent on `id`: an identical retry answers 200 (replayed), a changed one 409. */
export async function reviewClaim(
  accessToken: string,
  tenantId: string,
  claimId: string,
  input: ReviewInput,
): Promise<ReviewOut> {
  checked(tenantId, claimId, input.id);
  return parseReviewOut(
    await apiRequest(
      `/v1/tenants/${tenantId}/claims/${claimId}/reviews`,
      accessToken,
      { method: "POST", body: JSON.stringify(input) },
    ),
  );
}

const RUN_STATUSES = ["running", "succeeded", "failed", "cancelled", "expired", "killed"] as const;

export function parseAgentCost(json: unknown): AgentCostOut {
  if (!isRecord(json) || !Array.isArray(json.open)) return bad("cost");
  return {
    day: str(json, "day"),
    cap_micros: num(json, "cap_micros"),
    settled_micros: num(json, "settled_micros"),
    open_micros: num(json, "open_micros"),
    open: json.open.map((o) => {
      if (!isRecord(o)) return bad("open reservation");
      return {
        run_id: str(o, "run_id"),
        step_key: str(o, "step_key"),
        reserved_micros: num(o, "reserved_micros"),
        run_status: oneOf(o, "run_status", RUN_STATUSES),
        created_at: str(o, "created_at"),
      };
    }),
  };
}

/** Today's (UTC) agent spending of the workspace, for its Owner / Admin: settled, and still open (counted at the worst case). */
export async function fetchAgentCost(accessToken: string, tenantId: string): Promise<AgentCostOut> {
  checked(tenantId);
  return parseAgentCost(await apiRequest(`/v1/tenants/${tenantId}/agent-cost`, accessToken));
}
