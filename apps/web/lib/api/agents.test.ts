import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  cancelRun,
  fetchAgentClaims,
  fetchAgentCost,
  parseAgentCost,
  fetchAgentSettings,
  fetchClaims,
  fetchRuns,
  parseClaim,
  parseRun,
  reviewClaim,
  setAgentsEnabled,
  startResearchRun,
  startSelftestRun,
} from "./agents";
import { ApiContractError, ApiRequestError } from "./client";

const TENANT = "22222222-2222-2222-2222-222222222222";
const TARGET = "33333333-3333-3333-3333-333333333333";
const RUN = "44444444-4444-4444-4444-444444444444";

const RUN_JSON = {
  id: RUN,
  agent_name: "selftest",
  agent_version: "selftest-1",
  status: "running",
  started_by: "55555555-5555-4555-8555-555555555555",
  company_id: TARGET,
  lead_id: null,
  created_at: "2026-10-04T12:00:00+00:00",
  expires_at: "2026-10-04T12:15:00+00:00",
  finished_at: null,
  error_code: null,
  cancel_requested: false,
  max_writes: 6,
  writes_used: 1,
  max_tool_calls: 20,
  tool_calls_used: 0,
  max_input_tokens: 20000,
  input_tokens_used: 100,
  max_output_tokens: 4000,
  output_tokens_used: 50,
  max_cost_micros: 250000,
  cost_micros_used: 0,
};
const CLAIM_JSON = {
  id: RUN,
  company_id: TARGET,
  lead_id: null,
  predicate: "selftest.observation",
  value: "text",
  confidence: "unverified",
  claim_confidence: "unverified",
  created_via: "agent",
  agent_run_id: RUN,
  created_by: null,
  created_at: "2026-10-04T12:00:00+00:00",
  review_state: "unreviewed",
  review_confidence: null,
  reviewed_by: null,
  reviewed_at: null,
};

function respond(body: unknown, status = 200) {
  return vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(
    async () => new Response(JSON.stringify(body), { status }),
  );
}

describe("agents API client", () => {
  const original = globalThis.fetch;
  beforeEach(() => {
    process.env.NEXT_PUBLIC_API_BASE_URL = "http://api.test";
  });
  afterEach(() => {
    globalThis.fetch = original;
    vi.restoreAllMocks();
  });

  it("parses a run and refuses one that does not match the contract", () => {
    expect(parseRun(RUN_JSON).status).toBe("running");
    for (const broken of [
      { ...RUN_JSON, status: "done" },
      { ...RUN_JSON, writes_used: "1" },
      { ...RUN_JSON, cancel_requested: "no" },
      { ...RUN_JSON, error_code: "weird" },
      { ...RUN_JSON, id: undefined },
      "text",
      null,
    ])
      expect(() => parseRun(broken)).toThrow(ApiContractError);
  });

  it("parses a claim and refuses an unknown state, origin or confidence", () => {
    expect(parseClaim(CLAIM_JSON).review_state).toBe("unreviewed");
    for (const broken of [
      { ...CLAIM_JSON, review_state: "approved" },
      { ...CLAIM_JSON, created_via: "robot" },
      { ...CLAIM_JSON, confidence: "certain" },
      { ...CLAIM_JSON, review_confidence: "unverified" },
      { ...CLAIM_JSON, value: 5 },
    ])
      expect(() => parseClaim(broken)).toThrow(ApiContractError);
  });

  it("reads the settings and the runs with the user's token", async () => {
    const f = respond({ enabled: true });
    globalThis.fetch = f as unknown as typeof fetch;
    expect(await fetchAgentSettings("tok", TENANT)).toEqual({ enabled: true });
    expect(f.mock.calls[0][0]).toBe(`http://api.test/v1/tenants/${TENANT}/agent-settings`);
    globalThis.fetch = respond({ items: [RUN_JSON], next_cursor: null }) as unknown as typeof fetch;
    const page = await fetchRuns("tok", TENANT);
    expect(page.items).toHaveLength(1);
  });

  it("PUTs the switch, starts a selftest run with the caller's id, cancels, and reviews", async () => {
    const f = respond({ enabled: false });
    globalThis.fetch = f as unknown as typeof fetch;
    await setAgentsEnabled("tok", TENANT, false);
    const [, put] = f.mock.calls[0];
    expect(put?.method).toBe("PUT");
    expect(JSON.parse(String(put?.body))).toEqual({ enabled: false });

    const start = respond(RUN_JSON, 202);
    globalThis.fetch = start as unknown as typeof fetch;
    await startSelftestRun("tok", TENANT, { id: RUN, companyId: TARGET });
    const [url, init] = start.mock.calls[0];
    expect(url).toBe(`http://api.test/v1/tenants/${TENANT}/agent-runs`);
    expect(JSON.parse(String(init?.body))).toEqual({
      id: RUN,
      agent: "selftest",
      target_kind: "company",
      target_id: TARGET,
    });

    const cancel = respond({ status: "cancelled", replayed: false });
    globalThis.fetch = cancel as unknown as typeof fetch;
    await cancelRun("tok", TENANT, RUN);
    expect(cancel.mock.calls[0][0]).toBe(`http://api.test/v1/tenants/${TENANT}/agent-runs/${RUN}/cancel`);

    const review = respond({ review_id: RUN, replayed: false, self_review: false }, 201);
    globalThis.fetch = review as unknown as typeof fetch;
    await reviewClaim("tok", TENANT, TARGET, { id: RUN, decision: "accepted", confidence: "low" });
    const [rurl, rinit] = review.mock.calls[0];
    expect(rurl).toBe(`http://api.test/v1/tenants/${TENANT}/claims/${TARGET}/reviews`);
    expect(JSON.parse(String(rinit?.body))).toEqual({ id: RUN, decision: "accepted", confidence: "low" });
  });

  it("reads the claims of a company or a lead", async () => {
    const f = respond([CLAIM_JSON]);
    globalThis.fetch = f as unknown as typeof fetch;
    expect(await fetchClaims("tok", TENANT, "leads", TARGET)).toHaveLength(1);
    expect(f.mock.calls[0][0]).toBe(`http://api.test/v1/tenants/${TENANT}/leads/${TARGET}/claims`);
    globalThis.fetch = respond({ not: "a list" }) as unknown as typeof fetch;
    await expect(fetchClaims("tok", TENANT, "companies", TARGET)).rejects.toThrow(ApiContractError);
  });

  it("never lets a malformed id reach the API", async () => {
    const f = respond({});
    globalThis.fetch = f as unknown as typeof fetch;
    await expect(fetchRuns("tok", "../me")).rejects.toThrow(ApiContractError);
    await expect(cancelRun("tok", TENANT, "x")).rejects.toThrow(ApiContractError);
    await expect(fetchClaims("tok", TENANT, "leads", "x")).rejects.toThrow(ApiContractError);
    await expect(startSelftestRun("tok", TENANT, { id: "x", companyId: TARGET })).rejects.toThrow(ApiContractError);
    expect(f).not.toHaveBeenCalled();
  });

  it("surfaces an API refusal as an ApiRequestError with the API's code", async () => {
    globalThis.fetch = respond({ error: { code: "agents_disabled", message: "m" } }, 409) as unknown as typeof fetch;
    await expect(startSelftestRun("tok", TENANT, { id: RUN, companyId: TARGET })).rejects.toMatchObject({
      status: 409,
      code: "agents_disabled",
    });
    expect(ApiRequestError).toBeDefined();
  });

  it("POSTs a research run on a LEAD with the caller's id", async () => {
    const start = respond(RUN_JSON, 202);
    globalThis.fetch = start as unknown as typeof fetch;
    await startResearchRun("tok", TENANT, { id: RUN, leadId: TARGET });
    const [url, init] = start.mock.calls[0];
    expect(url).toBe(`http://api.test/v1/tenants/${TENANT}/agent-runs`);
    expect(JSON.parse(String(init?.body))).toEqual({
      id: RUN,
      agent: "research",
      target_kind: "lead",
      target_id: TARGET,
    });
    await expect(startResearchRun("tok", TENANT, { id: "x", leadId: TARGET })).rejects.toThrow(ApiContractError);
    await expect(startResearchRun("tok", TENANT, { id: RUN, leadId: "y" })).rejects.toThrow(ApiContractError);
  });

  it("parses the evidence a suggestion cites and the company it is about, as data", () => {
    const base = {
      id: RUN, company_id: TARGET, lead_id: null, predicate: "buyer_type", value: "wholesaler", confidence: "unverified",
      claim_confidence: "unverified", created_via: "agent", agent_run_id: RUN, created_by: null, created_at: "2026-10-04T12:00:00+00:00",
      review_state: "unreviewed", review_confidence: null, reviewed_by: null, reviewed_at: null,
    };
    const claim = parseClaim({
      ...base,
      company_name: "Saree House",
      evidence: [{ kind: "web_page", stance: "supports", provider: "agent.research", host: "h.test", path: "/a", quote: "<script>x</script>" }],
    });
    expect(claim.company_name).toBe("Saree House");
    expect(claim.evidence?.[0]).toEqual({ kind: "web_page", stance: "supports", provider: "agent.research", host: "h.test", path: "/a", quote: "<script>x</script>" });
    expect(parseClaim(base).evidence).toEqual([]);
    expect(parseClaim(base).company_name).toBeNull();
    expect(() => parseClaim({ ...base, evidence: "x" })).toThrow(ApiContractError);
    expect(() => parseClaim({ ...base, evidence: [{ kind: "web_page", stance: "maybe", provider: "p", host: null, path: null, quote: null }] })).toThrow(ApiContractError);
  });

  it("GETs the workspace's agent suggestions with a state and a limit", async () => {
    const f = respond([]);
    globalThis.fetch = f as unknown as typeof fetch;
    expect(await fetchAgentClaims("tok", TENANT, "all", 100)).toEqual([]);
    expect(f.mock.calls[0][0]).toBe(`http://api.test/v1/tenants/${TENANT}/agent-claims?state=all&limit=100`);
    await expect(fetchAgentClaims("tok", "x")).rejects.toThrow(ApiContractError);
    globalThis.fetch = respond({ not: "a list" }) as unknown as typeof fetch;
    await expect(fetchAgentClaims("tok", TENANT)).rejects.toThrow(ApiContractError);
  });

  it("GETs today's agent spending and parses it strictly", async () => {
    const body = { day: "2026-10-04", cap_micros: 2000000, settled_micros: 400, open_micros: 900, open: [{ run_id: RUN, step_key: "usage-2", reserved_micros: 700, run_status: "cancelled", created_at: "2026-10-04T12:00:00+00:00" }] };
    const f = respond(body);
    globalThis.fetch = f as unknown as typeof fetch;
    expect((await fetchAgentCost("tok", TENANT)).open[0].run_status).toBe("cancelled");
    expect(f.mock.calls[0][0]).toBe(`http://api.test/v1/tenants/${TENANT}/agent-cost`);
    expect(() => parseAgentCost({ ...body, open: [{ ...body.open[0], run_status: "paused" }] })).toThrow(ApiContractError);
    expect(() => parseAgentCost({ ...body, settled_micros: "400" })).toThrow(ApiContractError);
    expect(() => parseAgentCost({ day: "x" })).toThrow(ApiContractError);
    await expect(fetchAgentCost("tok", "x")).rejects.toThrow(ApiContractError);
  });
});
