import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiContractError, ApiRequestError } from "./client";
import {
  createLeadLabel,
  exportLeadLabels,
  fetchActiveIcpConfig,
  fetchReviewQueue,
  importLeads,
  LEAD_LABEL_REASONS,
  parseIcpConfig,
  parseImportBatchReport,
  parseLeadLabel,
  parseReviewQueueLead,
  parseReviewQueuePage,
  SCORE_BANDS,
} from "./leads";

const TENANT = "22222222-2222-2222-2222-222222222222";
const LEAD_ID = "33333333-3333-3333-3333-333333333333";
const ICP_ID = "44444444-4444-4444-4444-444444444444";

function respond(status: number, body: unknown, headers: Record<string, string> = {}) {
  return vi.fn(
    async () =>
      new Response(typeof body === "string" ? body : JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json", ...headers },
      }),
  );
}

describe("constants", () => {
  it("defines the 11 database reason codes", () => {
    expect(LEAD_LABEL_REASONS).toHaveLength(11);
    expect(LEAD_LABEL_REASONS).toContain("not_our_market");
    expect(LEAD_LABEL_REASONS).toContain("already_customer");
    expect(LEAD_LABEL_REASONS).toContain("payment_risk");
  });

  it("defines the 4 deterministic score bands", () => {
    expect(SCORE_BANDS).toEqual([
      "priority",
      "worth_reviewing",
      "maybe",
      "low_priority",
    ]);
  });
});

describe("parseReviewQueueLead", () => {
  const validLead = {
    lead_id: LEAD_ID,
    status: "new",
    source: "trade_fair",
    created_at: "2026-10-04T12:00:00Z",
    company: { name: "Kanchipuram Silks", city: "Kanchipuram", country: "IN" },
    contact: { full_name: "Raman", email: "raman@example.test" },
    latest_label: null,
    score: 85,
    score_max_reachable: 100,
    score_band: "priority",
    snapshot: { factors: { geography_fit: { points: 20, max_points: 20 } } },
  };

  it("parses a valid unreviewed lead", () => {
    const lead = parseReviewQueueLead(validLead);
    expect(lead.lead_id).toBe(LEAD_ID);
    expect(lead.latest_label).toBeNull();
    expect(lead.score).toBe(85);
    expect(lead.score_band).toBe("priority");
  });

  it("parses a lead with a completed label and reason code", () => {
    const labeledLead = {
      ...validLead,
      latest_label: {
        id: "55555555-5555-5555-5555-555555555555",
        tenant_id: TENANT,
        lead_id: LEAD_ID,
        label: "bad",
        reason_code: "not_our_market",
        icp_version_id: ICP_ID,
        score: 40,
        score_max_reachable: 100,
        snapshot: null,
        created_by: "user-1",
        created_via: "manual",
        created_at: "2026-10-04T12:30:00Z",
      },
    };
    const lead = parseReviewQueueLead(labeledLead);
    expect(lead.latest_label?.label).toBe("bad");
    expect(lead.latest_label?.reason_code).toBe("not_our_market");
    expect(lead.latest_label?.score).toBe(40);
  });

  it("throws ApiContractError on invalid shape or missing lead_id", () => {
    expect(() => parseReviewQueueLead(null)).toThrow(ApiContractError);
    expect(() => parseReviewQueueLead({})).toThrow(ApiContractError);
    expect(() => parseReviewQueueLead({ lead_id: 123 })).toThrow(ApiContractError);
    expect(() =>
      parseReviewQueueLead({
        ...validLead,
        latest_label: { id: "bad" }, // incomplete label
      }),
    ).toThrow(ApiContractError);
  });
});

describe("parseReviewQueuePage", () => {
  it("parses a valid queue page with items and next_cursor", () => {
    const page = parseReviewQueuePage({
      items: [
        {
          lead_id: LEAD_ID,
          status: "new",
          source: null,
          created_at: "2026-10-04T12:00:00Z",
          company: { name: "Test Corp" },
          contact: null,
          latest_label: null,
          score: null,
          score_max_reachable: null,
          score_band: null,
          snapshot: null,
        },
      ],
      next_cursor: "cursor-token-123",
    });
    expect(page.items).toHaveLength(1);
    expect(page.next_cursor).toBe("cursor-token-123");
  });

  it("throws ApiContractError when items is missing or not an array", () => {
    expect(() => parseReviewQueuePage({ items: "not-an-array" })).toThrow(
      ApiContractError,
    );
    expect(() => parseReviewQueuePage(null)).toThrow(ApiContractError);
  });
});

describe("parseIcpConfig", () => {
  const validIcp = {
    id: ICP_ID,
    tenant_id: TENANT,
    version_no: 1,
    engine: "icp-rules",
    schema_version: 1,
    config: { factors: [] },
    config_sha256: "abcdef1234567890",
    created_by: "user-1",
    created_via: "manual",
    created_at: "2026-10-04T10:00:00Z",
  };

  it("parses a valid ICP config", () => {
    const cfg = parseIcpConfig(validIcp);
    expect(cfg.id).toBe(ICP_ID);
    expect(cfg.version_no).toBe(1);
    expect(cfg.config_sha256).toBe("abcdef1234567890");
  });

  it("throws ApiContractError on missing required fields", () => {
    expect(() => parseIcpConfig({ ...validIcp, id: undefined })).toThrow(
      ApiContractError,
    );
    expect(() => parseIcpConfig({ ...validIcp, version_no: "not-a-number" })).toThrow(
      ApiContractError,
    );
  });
});

describe("parseLeadLabel", () => {
  it("parses a valid LeadLabelOut", () => {
    const label = parseLeadLabel({
      id: "label-1",
      tenant_id: TENANT,
      lead_id: LEAD_ID,
      label: "good",
      reason_code: null,
      icp_version_id: ICP_ID,
      score: 90,
      score_max_reachable: 100,
      snapshot: { score: 90 },
      created_by: "user-1",
      created_via: "manual",
      created_at: "2026-10-04T12:00:00Z",
    });
    expect(label.label).toBe("good");
    expect(label.score).toBe(90);
  });

  it("throws ApiContractError when missing lead_id or label", () => {
    expect(() => parseLeadLabel({})).toThrow(ApiContractError);
  });
});

describe("parseImportBatchReport", () => {
  it("parses a valid report", () => {
    const report = parseImportBatchReport({
      batch_id: "batch-1",
      replayed: false,
      dry_run: true,
      counts: {
        rows: 5,
        created: 4,
        skipped_duplicate: 1,
        ambiguous: 0,
        rejected: 0,
        companies_created: 4,
        contacts_created: 2,
        claims_created: 0,
      },
      rows: [{ index: 0, outcome: "created", company_name: "Silk Corp" }],
    });
    expect(report.dry_run).toBe(true);
    expect(report.counts.created).toBe(4);
    expect(report.rows).toHaveLength(1);
  });

  it("throws ApiContractError on invalid structure", () => {
    expect(() => parseImportBatchReport(null)).toThrow(ApiContractError);
    expect(() => parseImportBatchReport({ counts: {} })).toThrow(ApiContractError);
  });
});

describe("leads API methods", () => {
  const original = globalThis.fetch;
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_API_BASE_URL", "http://api.test");
  });
  afterEach(() => {
    globalThis.fetch = original;
    vi.unstubAllEnvs();
  });

  it("fetchReviewQueue passes blind, cursor, and score_band parameters", async () => {
    const mock = respond(200, { items: [], next_cursor: null });
    globalThis.fetch = mock as unknown as typeof fetch;

    await fetchReviewQueue("user-tok", TENANT, {
      limit: 10,
      cursor: "cur123",
      score_band: "priority",
      blind: false,
    });

    const [url, init] = mock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(
      `http://api.test/v1/tenants/${TENANT}/leads/review-queue?limit=10&cursor=cur123&score_band=priority&blind=false`,
    );
    expect((init.headers as Record<string, string>).Authorization).toBe(
      "Bearer user-tok",
    );
  });

  it("fetchActiveIcpConfig returns config on 200, or null on 404", async () => {
    const validIcp = {
      id: ICP_ID,
      tenant_id: TENANT,
      version_no: 1,
      engine: "icp-rules",
      schema_version: 1,
      config: {},
      config_sha256: "sha256",
      created_by: null,
      created_via: "manual",
      created_at: "2026-10-04T00:00:00Z",
    };
    globalThis.fetch = respond(200, validIcp) as unknown as typeof fetch;
    const cfg = await fetchActiveIcpConfig("tok", TENANT);
    expect(cfg?.id).toBe(ICP_ID);

    globalThis.fetch = respond(404, {
      error: { code: "not_found", message: "No active config" },
    }) as unknown as typeof fetch;
    const nullCfg = await fetchActiveIcpConfig("tok", TENANT);
    expect(nullCfg).toBeNull();
  });

  it("fetchActiveIcpConfig propagates non-404 errors", async () => {
    globalThis.fetch = respond(500, {
      error: { code: "internal", message: "Boom" },
    }) as unknown as typeof fetch;
    await expect(fetchActiveIcpConfig("tok", TENANT)).rejects.toBeInstanceOf(
      ApiRequestError,
    );
  });

  it("createLeadLabel POSTs label and reason_code to leads/{leadId}/labels", async () => {
    const labelResp = {
      id: "label-1",
      tenant_id: TENANT,
      lead_id: LEAD_ID,
      label: "bad",
      reason_code: "duplicate",
      icp_version_id: null,
      score: null,
      score_max_reachable: null,
      snapshot: null,
      created_by: "u1",
      created_via: "manual",
      created_at: "2026-10-04T00:00:00Z",
    };
    const mock = respond(201, labelResp);
    globalThis.fetch = mock as unknown as typeof fetch;

    const res = await createLeadLabel("tok", TENANT, LEAD_ID, {
      id: "55555555-5555-4555-8555-555555555555",
      label: "bad",
      reason_code: "duplicate",
    });

    expect(res.label).toBe("bad");
    expect(res.reason_code).toBe("duplicate");
    const [url, init] = mock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(
      `http://api.test/v1/tenants/${TENANT}/leads/${LEAD_ID}/labels`,
    );
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({
      id: "55555555-5555-4555-8555-555555555555",
      label: "bad",
      reason_code: "duplicate",
    });
  });

  it("importLeads POSTs batch to import endpoint (or preview on dryRun)", async () => {
    const reportResp = {
      batch_id: "batch-1",
      replayed: false,
      dry_run: true,
      counts: {
        rows: 1,
        created: 1,
        skipped_duplicate: 0,
        ambiguous: 0,
        rejected: 0,
        companies_created: 1,
        contacts_created: 0,
        claims_created: 0,
      },
      rows: [],
    };
    const mock = respond(200, reportResp);
    globalThis.fetch = mock as unknown as typeof fetch;

    await importLeads(
      "tok",
      TENANT,
      {
        batch_id: "batch-1",
        label: "test import",
        rows: [{ company_name: "Silk Corp" }],
      },
      true, // dryRun
    );

    const [url, init] = mock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`http://api.test/v1/tenants/${TENANT}/leads/import/preview`);
    expect(init.method).toBe("POST");
  });

  it("exportLeadLabels calls apiExportRequest with format", async () => {
    const csvContent = "lead_id,company_name,label\n1,Acme,good\n";
    const mock = respond(
      200,
      csvContent,
      {
        "Content-Type": "text/csv; charset=utf-8",
        "X-Export-Sha256": "fake-sha-256",
        "X-Export-Rows": "1",
      },
    );
    globalThis.fetch = mock as unknown as typeof fetch;

    const res = await exportLeadLabels("tok", TENANT, "csv");
    expect(res.content).toBe(csvContent);
    expect(res.sha256).toBe("fake-sha-256");
    expect(res.rowCount).toBe(1);

    const [url, init] = mock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`http://api.test/v1/tenants/${TENANT}/exports`);
    expect(JSON.parse(init.body as string)).toEqual({
      kind: "lead_labels",
      format: "csv",
    });
  });
});
