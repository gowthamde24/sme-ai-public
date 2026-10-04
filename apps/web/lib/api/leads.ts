export type {
  ExportFormat,
  ExportKind,
  ExportRecordOut,
  IcpConfigOut,
  ImportBatchCounts,
  ImportBatchReport,
  ImportBatchRequest,
  ImportOutcome,
  ImportRowInput,
  ImportRowOutcome,
  LeadLabel,
  LeadLabelCreate,
  LeadLabelOut,
  LeadLabelReason,
  PageIcpConfigOut,
  PageLeadLabelOut,
  PageReviewQueueLeadOut,
  ReviewQueueLeadOut,
} from "@contracts";

import type {
  ExportFormat,
  IcpConfigOut,
  ImportBatchReport,
  ImportBatchRequest,
  ImportRowOutcome,
  LeadLabel,
  LeadLabelOut,
  LeadLabelReason,
  PageReviewQueueLeadOut,
  RecordOrigin,
  ReviewQueueLeadOut,
} from "@contracts";

import {
  ApiContractError,
  apiExportRequest,
  apiRequest,
  ApiRequestError,
  type ExportDownloadResult,
} from "./client";

export const LEAD_LABEL_REASONS: readonly LeadLabelReason[] = [
  "not_our_market",
  "wrong_product",
  "too_small",
  "too_large",
  "inactive",
  "not_a_business",
  "no_contact_route",
  "already_customer",
  "duplicate",
  "insufficient_info",
  "payment_risk",
] as const;

export const LEAD_LABEL_REASON_LABELS: Record<LeadLabelReason, string> = {
  not_our_market: "Not our market / wrong geography",
  wrong_product: "Wrong product category",
  too_small: "Too small / insufficient volume",
  too_large: "Too large / beyond capacity",
  inactive: "Inactive or out of business",
  not_a_business: "Not a business entity",
  no_contact_route: "No viable contact route",
  already_customer: "Already an active customer",
  duplicate: "Duplicate lead entry",
  insufficient_info: "Insufficient information to evaluate",
  payment_risk: "Payment or credit risk",
};

export const SCORE_BANDS = [
  "priority",
  "worth_reviewing",
  "maybe",
  "low_priority",
] as const;
export type ScoreBand = (typeof SCORE_BANDS)[number];

export const SCORE_BAND_LABELS: Record<ScoreBand, string> = {
  priority: "Priority (80+)",
  worth_reviewing: "Worth Reviewing (65-79)",
  maybe: "Maybe (50-64)",
  low_priority: "Low Priority (<50)",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isNumber(value: unknown): value is number {
  return typeof value === "number" && !Number.isNaN(value);
}

export function parseReviewQueueLead(json: unknown): ReviewQueueLeadOut {
  if (
    !isRecord(json) ||
    !isString(json.lead_id) ||
    !isString(json.status) ||
    !isString(json.created_at) ||
    !isRecord(json.company)
  ) {
    throw new ApiContractError("Unexpected ReviewQueueLead response shape.");
  }

  const latestLabel = json.latest_label;
  let parsedLabel: LeadLabelOut | null = null;
  if (isRecord(latestLabel)) {
    if (
      !isString(latestLabel.id) ||
      !isString(latestLabel.tenant_id) ||
      !isString(latestLabel.lead_id) ||
      !isString(latestLabel.label)
    ) {
      throw new ApiContractError("Unexpected LeadLabel shape in ReviewQueueLead.");
    }
    parsedLabel = {
      id: latestLabel.id,
      tenant_id: latestLabel.tenant_id,
      lead_id: latestLabel.lead_id,
      label: latestLabel.label as LeadLabel,
      reason_code: (latestLabel.reason_code as LeadLabelReason) ?? null,
      icp_version_id: (latestLabel.icp_version_id as string) ?? null,
      score: isNumber(latestLabel.score) ? latestLabel.score : null,
      score_max_reachable: isNumber(latestLabel.score_max_reachable)
        ? latestLabel.score_max_reachable
        : null,
      snapshot: isRecord(latestLabel.snapshot) ? latestLabel.snapshot : null,
      created_by: (latestLabel.created_by as string) ?? null,
      created_via: (isString(latestLabel.created_via)
        ? latestLabel.created_via
        : "manual") as RecordOrigin,
      created_at: String(latestLabel.created_at),
    };
  }

  return {
    lead_id: json.lead_id,
    status: json.status,
    source: (json.source as string) ?? null,
    created_at: json.created_at,
    company: json.company,
    contact: isRecord(json.contact) ? json.contact : null,
    latest_label: parsedLabel,
    score: isNumber(json.score) ? json.score : null,
    score_max_reachable: isNumber(json.score_max_reachable)
      ? json.score_max_reachable
      : null,
    score_band: (json.score_band as string) ?? null,
    snapshot: isRecord(json.snapshot) ? json.snapshot : null,
  };
}

export function parseReviewQueuePage(json: unknown): PageReviewQueueLeadOut {
  if (!isRecord(json) || !Array.isArray(json.items)) {
    throw new ApiContractError("Unexpected Page[ReviewQueueLeadOut] response.");
  }
  const items = json.items.map(parseReviewQueueLead);
  const next_cursor = isString(json.next_cursor) ? json.next_cursor : null;
  return { items, next_cursor };
}

export function parseIcpConfig(json: unknown): IcpConfigOut {
  if (
    !isRecord(json) ||
    !isString(json.id) ||
    !isString(json.tenant_id) ||
    !isNumber(json.version_no) ||
    !isString(json.engine) ||
    !isNumber(json.schema_version) ||
    !isRecord(json.config) ||
    !isString(json.config_sha256) ||
    !isString(json.created_at)
  ) {
    throw new ApiContractError("Unexpected IcpConfigOut response.");
  }
  return {
    id: json.id,
    tenant_id: json.tenant_id,
    version_no: json.version_no,
    engine: json.engine,
    schema_version: json.schema_version,
    config: json.config,
    config_sha256: json.config_sha256,
    created_by: (json.created_by as string) ?? null,
    created_via: (isString(json.created_via)
      ? json.created_via
      : "manual") as RecordOrigin,
    created_at: json.created_at,
  };
}

export function parseLeadLabel(json: unknown): LeadLabelOut {
  if (
    !isRecord(json) ||
    !isString(json.id) ||
    !isString(json.tenant_id) ||
    !isString(json.lead_id) ||
    !isString(json.label) ||
    !isString(json.created_at)
  ) {
    throw new ApiContractError("Unexpected LeadLabelOut response.");
  }
  return {
    id: json.id,
    tenant_id: json.tenant_id,
    lead_id: json.lead_id,
    label: json.label as LeadLabel,
    reason_code: (json.reason_code as LeadLabelReason) ?? null,
    icp_version_id: (json.icp_version_id as string) ?? null,
    score: isNumber(json.score) ? json.score : null,
    score_max_reachable: isNumber(json.score_max_reachable)
      ? json.score_max_reachable
      : null,
    snapshot: isRecord(json.snapshot) ? json.snapshot : null,
    created_by: (json.created_by as string) ?? null,
    created_via: (isString(json.created_via)
      ? json.created_via
      : "manual") as RecordOrigin,
    created_at: json.created_at,
  };
}

export function parseImportBatchReport(json: unknown): ImportBatchReport {
  if (
    !isRecord(json) ||
    typeof json.replayed !== "boolean" ||
    typeof json.dry_run !== "boolean" ||
    !isRecord(json.counts) ||
    !Array.isArray(json.rows)
  ) {
    throw new ApiContractError("Unexpected ImportBatchReport response.");
  }
  const counts = json.counts;
  return {
    batch_id: (json.batch_id as string) ?? null,
    replayed: json.replayed,
    dry_run: json.dry_run,
    counts: {
      rows: Number(counts.rows ?? 0),
      created: Number(counts.created ?? 0),
      skipped_duplicate: Number(counts.skipped_duplicate ?? 0),
      ambiguous: Number(counts.ambiguous ?? 0),
      rejected: Number(counts.rejected ?? 0),
      companies_created: Number(counts.companies_created ?? 0),
      contacts_created: Number(counts.contacts_created ?? 0),
      claims_created: Number(counts.claims_created ?? 0),
    },
    rows: json.rows as ImportRowOutcome[],
  };
}

export async function fetchReviewQueue(
  accessToken: string,
  tenantId: string,
  options: {
    limit?: number;
    cursor?: string | null;
    score_band?: string | null;
    blind?: boolean;
  } = {},
): Promise<PageReviewQueueLeadOut> {
  const params = new URLSearchParams();
  if (options.limit) params.set("limit", String(options.limit));
  if (options.cursor) params.set("cursor", options.cursor);
  if (options.score_band) params.set("score_band", options.score_band);
  params.set("blind", options.blind === false ? "false" : "true");

  const qs = params.toString();
  const path = `/v1/tenants/${encodeURIComponent(tenantId)}/leads/review-queue${qs ? `?${qs}` : ""}`;
  return parseReviewQueuePage(await apiRequest(path, accessToken));
}

export async function fetchActiveIcpConfig(
  accessToken: string,
  tenantId: string,
): Promise<IcpConfigOut | null> {
  try {
    const raw = await apiRequest(
      `/v1/tenants/${encodeURIComponent(tenantId)}/icp-configs/active`,
      accessToken,
    );
    return parseIcpConfig(raw);
  } catch (err: unknown) {
    if (err instanceof ApiRequestError && err.status === 404) return null;
    throw err;
  }
}

export async function createLeadLabel(
  accessToken: string,
  tenantId: string,
  leadId: string,
  // `id` is generated once per submit attempt: the same id with the same payload is a retry (the
  // server answers 200 with the stored label), anything else under a used id is a 409.
  payload: {
    id: string;
    label: LeadLabel;
    reason_code?: LeadLabelReason | null;
  },
): Promise<LeadLabelOut> {
  const raw = await apiRequest(
    `/v1/tenants/${encodeURIComponent(tenantId)}/leads/${encodeURIComponent(leadId)}/labels`,
    accessToken,
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
  );
  return parseLeadLabel(raw);
}

export async function importLeads(
  accessToken: string,
  tenantId: string,
  payload: ImportBatchRequest,
  dryRun: boolean = false,
): Promise<ImportBatchReport> {
  const endpoint = dryRun ? "preview" : "";
  const path = `/v1/tenants/${encodeURIComponent(tenantId)}/leads/import${endpoint ? `/${endpoint}` : ""}`;
  const raw = await apiRequest(path, accessToken, {
    method: "POST",
    body: JSON.stringify(payload),
  });
  return parseImportBatchReport(raw);
}

export async function exportLeadLabels(
  accessToken: string,
  tenantId: string,
  format: ExportFormat,
): Promise<ExportDownloadResult> {
  return apiExportRequest(
    `/v1/tenants/${encodeURIComponent(tenantId)}/exports`,
    accessToken,
    {
      kind: "lead_labels",
      format,
    },
  );
}
