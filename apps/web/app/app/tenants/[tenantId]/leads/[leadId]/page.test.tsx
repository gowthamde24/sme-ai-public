import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  ApiAuthError,
  ApiContractError,
  ApiRequestError,
} from "@/lib/api/client";
import {
  isNotFound,
  notFoundMock,
  redirectMock,
  redirectTarget,
} from "@/test/helpers";

const requireUser = vi.fn();
const fetchTenant = vi.fn();
const fetchLead = vi.fn();
const fetchEvidencePage = vi.fn();
const fetchClaims = vi.fn();
const fetchLeadEnquiries = vi.fn();

vi.mock("next/navigation", () => ({
  redirect: (to: string) => redirectMock(to),
  notFound: () => notFoundMock(),
}));
vi.mock("@/lib/auth/session", () => ({ requireUser: () => requireUser() }));
vi.mock("@/lib/api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/client")>()),
  fetchTenant: (...a: unknown[]) => fetchTenant(...a),
}));
vi.mock("@/lib/api/crm", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/crm")>()),
  fetchLead: (...a: unknown[]) => fetchLead(...a),
}));
vi.mock("@/lib/api/evidence", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/evidence")>()),
  fetchEvidencePage: (...a: unknown[]) => fetchEvidencePage(...a),
}));
vi.mock("@/lib/api/agents", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/agents")>()),
  fetchClaims: (...a: unknown[]) => fetchClaims(...a),
}));
vi.mock("@/lib/api/enquiries", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/enquiries")>()),
  fetchLeadEnquiries: (...a: unknown[]) => fetchLeadEnquiries(...a),
}));
vi.mock("../../enquiries/actions", () => ({ captureEnquiryAction: vi.fn(async () => undefined) }));
vi.mock("../../suggestion-actions", () => ({ reviewClaimAction: vi.fn(async () => undefined) }));
vi.mock("../../evidence-actions", () => ({
  addEvidenceAction: vi.fn(async () => undefined),
}));

import LeadPage from "./page";

const TENANT = "22222222-2222-2222-2222-222222222222";
const LEAD = "44444444-4444-4444-4444-444444444444";
const FORM_ID = "33333333-3333-3333-3333-333333333333";
const USER = { id: "u", email: "e@example.test", accessToken: "tok" };

function props(
  over: {
    tenantId?: string;
    leadId?: string;
    query?: Record<string, string | string[]>;
  } = {},
) {
  return {
    params: Promise.resolve({
      tenantId: over.tenantId ?? TENANT,
      leadId: over.leadId ?? LEAD,
    }),
    searchParams: Promise.resolve(over.query ?? {}),
  } as unknown as Parameters<typeof LeadPage>[0];
}
const tenant = (role: string) => ({
  id: TENANT,
  name: "Acme Workspace",
  slug: "acme",
  role,
});
const lead = {
  id: LEAD,
  status: "qualified",
  source: "DEMO trade fair",
  created_via: "manual",
  created_at: "2026-02-03T04:05:06+00:00",
};
const evidence = {
  items: [
    {
      linkId: "l1",
      kind: "document",
      provider: "manual",
      url: null,
      reference: "doc:cat-1",
      snippet: "Catalogue says <b>silk</b>",
      retrievedAt: "2026-01-02T03:04:05+00:00",
      publishedAt: null,
      createdVia: "manual",
    },
  ],
  nextCursor: "next-1",
};

const suggestion = {
  id: "88888888-8888-4888-8888-888888888888",
  company_id: null,
  lead_id: null,
  predicate: "selftest.observation",
  value: "DEMO <i>suggestion</i>",
  confidence: "unverified",
  claim_confidence: "unverified",
  created_via: "agent",
  agent_run_id: "99999999-9999-4999-8999-999999999999",
  created_by: "u",
  created_at: "2026-10-04T12:00:00+00:00",
  review_state: "unreviewed",
  review_confidence: null,
  reviewed_by: null,
  reviewed_at: null,
};

describe("/app/tenants/[tenantId]/leads/[leadId]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("crypto", { randomUUID: () => FORM_ID });
    requireUser.mockResolvedValue(USER);
    fetchTenant.mockResolvedValue(tenant("owner"));
    fetchLead.mockResolvedValue(lead);
    fetchEvidencePage.mockResolvedValue(evidence);
    fetchClaims.mockResolvedValue([suggestion]);
    fetchLeadEnquiries.mockResolvedValue([]);
  });

  it("authenticates FIRST: with no session nothing else is called", async () => {
    requireUser.mockImplementation(() => redirectMock("/login"));
    expect(await redirectTarget(() => LeadPage(props()))).toBe("/login");
    expect(fetchTenant).not.toHaveBeenCalled();
    expect(fetchLead).not.toHaveBeenCalled();
    expect(fetchEvidencePage).not.toHaveBeenCalled();
  });

  it("asks OUR API with the user's token: tenant, lead, then the evidence", async () => {
    render(await LeadPage(props()));
    expect(fetchTenant).toHaveBeenCalledWith("tok", TENANT);
    expect(fetchLead).toHaveBeenCalledWith("tok", TENANT, LEAD);
    expect(fetchEvidencePage).toHaveBeenCalledWith(
      "tok",
      TENANT,
      "leads",
      LEAD,
      null,
    );
  });

  it("shows a short summary and the evidence as text", async () => {
    render(await LeadPage(props()));
    expect(
      screen.getByRole("heading", { level: 1, name: "Lead" }),
    ).toBeInTheDocument();
    for (const text of ["qualified", "DEMO trade fair", "2026-02-03", "manual"])
      expect(screen.getAllByText(text).length).toBeGreaterThan(0);
    expect(screen.getByText("Catalogue says <b>silk</b>")).toBeInTheDocument();
    expect(screen.getByText("doc:cat-1")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /Acme Workspace/ }),
    ).toHaveAttribute("href", `/app/tenants/${TENANT}?tab=leads`);
  });

  it("passes the opaque cursor on, and ignores an absurdly long one", async () => {
    render(await LeadPage(props({ query: { cursor: "abc" } })));
    expect(fetchEvidencePage).toHaveBeenLastCalledWith(
      "tok",
      TENANT,
      "leads",
      LEAD,
      "abc",
    );
    await LeadPage(props({ query: { cursor: "x".repeat(301) } }));
    expect(fetchEvidencePage).toHaveBeenLastCalledWith(
      "tok",
      TENANT,
      "leads",
      LEAD,
      null,
    );
  });

  it("offers Load more when the API issued a cursor", async () => {
    render(await LeadPage(props()));
    expect(screen.getByRole("link", { name: "Load more" })).toHaveAttribute(
      "href",
      `/app/tenants/${TENANT}/leads/${LEAD}?cursor=next-1`,
    );
  });

  // ---------------------------------------------------------------------- not found, always the same
  it("an unknown / foreign tenant is the not-found page and nothing else is read", async () => {
    fetchTenant.mockRejectedValue(
      new ApiRequestError(404, "not_found", "Not found."),
    );
    expect(await isNotFound(() => LeadPage(props()))).toBe(true);
    expect(fetchLead).not.toHaveBeenCalled();
    expect(fetchEvidencePage).not.toHaveBeenCalled();
  });

  it("an unknown / foreign lead is the same not-found page and the evidence is never requested", async () => {
    fetchLead.mockRejectedValue(
      new ApiRequestError(404, "not_found", "Not found."),
    );
    expect(await isNotFound(() => LeadPage(props()))).toBe(true);
    expect(fetchEvidencePage).not.toHaveBeenCalled();
  });

  it("malformed tenant or lead ids are not-found and never reach the API", async () => {
    for (const over of [
      { tenantId: "not-a-uuid" },
      { leadId: "../me" },
      { leadId: LEAD.replaceAll("-", "") },
      { leadId: "x".repeat(200) },
    ])
      expect(await isNotFound(() => LeadPage(props(over)))).toBe(true);
    expect(fetchTenant).not.toHaveBeenCalled();
    expect(fetchLead).not.toHaveBeenCalled();
  });

  it("the evidence request turning 404 (access removed mid-visit) is not-found, not data", async () => {
    fetchEvidencePage.mockRejectedValue(
      new ApiRequestError(404, "not_found", "Not found."),
    );
    expect(await isNotFound(() => LeadPage(props()))).toBe(true);
  });

  it("a rejected session goes to /login at any step", async () => {
    fetchTenant.mockRejectedValue(new ApiAuthError("expired"));
    expect(await redirectTarget(() => LeadPage(props()))).toBe("/login");
    fetchTenant.mockResolvedValue(tenant("owner"));
    fetchEvidencePage.mockRejectedValue(new ApiAuthError("expired"));
    expect(await redirectTarget(() => LeadPage(props()))).toBe("/login");
  });

  // ------------------------------------------------------------------------------------- API down
  it("API down for the record: an error state and no placeholder data", async () => {
    fetchLead.mockRejectedValue(
      new ApiRequestError(503, "api_unreachable", "The API is unreachable."),
    );
    render(await LeadPage(props()));
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Could not load this from the API",
    );
    expect(screen.queryByText("DEMO trade fair")).toBeNull();
    expect(screen.queryByText("No evidence yet.")).toBeNull();
  });

  it("an unexpected response shape is an error state, not rendered", async () => {
    fetchLead.mockRejectedValue(new ApiContractError("bad"));
    render(await LeadPage(props()));
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("API down for the evidence only: the summary stays, the evidence section shows an error", async () => {
    fetchClaims.mockResolvedValue([]);
    fetchEvidencePage.mockRejectedValue(
      new ApiRequestError(502, "upstream_error", "x"),
    );
    render(await LeadPage(props()));
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Lead");
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Could not load the evidence",
    );
    expect(screen.queryByRole("list")).toBeNull();
  });

  // --------------------------------------------------------------------------------------- roles
  it.each([
    ["owner", true],
    ["admin", true],
    ["sales", true],
    ["viewer", false],
  ])("the add form is shown to %s: %s", async (role, shown) => {
    fetchTenant.mockResolvedValue(tenant(role));
    render(await LeadPage(props()));
    expect(!!screen.queryByRole("form", { name: "Add evidence" })).toBe(shown);
  });

  it.each([
    ["owner", true],
    ["admin", true],
    ["sales", true],
    ["viewer", false],
  ])("the follow-up link is shown to %s: %s", async (role, shown) => {
    fetchTenant.mockResolvedValue(tenant(role));
    render(await LeadPage(props()));
    const link = screen.queryByRole("link", { name: "Follow-up for this lead →" });
    expect(link !== null).toBe(shown);
    if (link) expect(link).toHaveAttribute("href", expect.stringMatching(/\/leads\/[0-9a-f-]{36}\/followup$/));
  });

  it("the form carries one id per render", async () => {
    render(await LeadPage(props()));
    const hidden = document.querySelector(
      'form[aria-label="Add evidence"] input[name="id"]',
    ) as HTMLInputElement;
    expect(hidden.value).toBe(FORM_ID);
  });

  it("renders no claims and no archive control", async () => {
    render(await LeadPage(props()));
    expect(screen.queryByText(/claim/i)).toBeNull();
    expect(
      screen.queryByRole("button", { name: /archive|delete/i }),
    ).toBeNull();
  });

  // ---------------------------------------------------------------------- agent suggestions (T006)
  it("asks OUR API for the lead's claims with the user's token and shows them as 'agent suggestion, unreviewed'", async () => {
    render(await LeadPage(props()));
    expect(fetchClaims).toHaveBeenCalledWith("tok", TENANT, "leads", LEAD);
    expect(screen.getByText(/agent suggestion, unreviewed/)).toBeInTheDocument();
    expect(screen.getByText("DEMO <i>suggestion</i>")).toBeInTheDocument();
  });

  it("shows the review forms to an owner or admin only; Sales and Viewers see the suggestion but no forms", async () => {
    for (const role of ["owner", "admin"]) {
      fetchTenant.mockResolvedValue(tenant(role));
      const { unmount } = render(await LeadPage(props()));
      expect(screen.getByRole("button", { name: "Accept" })).toBeInTheDocument();
      unmount();
    }
    for (const role of ["sales", "viewer"]) {
      fetchTenant.mockResolvedValue(tenant(role));
      const { unmount } = render(await LeadPage(props()));
      expect(screen.getByText(/agent suggestion, unreviewed/)).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Accept" })).toBeNull();
      unmount();
    }
  });

  it("generates the review ids on the server, one pair per suggestion per render", async () => {
    let n = 0;
    vi.stubGlobal("crypto", { randomUUID: () => `id-${n++}` });
    fetchTenant.mockResolvedValue(tenant("owner"));
    render(await LeadPage(props()));
    const ids = Array.from(document.querySelectorAll<HTMLInputElement>('input[name="review_id"]')).map((i) => i.value);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2); // accept and reject never share an id
  });

  it("a failing claims request shows an error in that section only; the rest of the page is intact", async () => {
    fetchClaims.mockRejectedValue(new ApiRequestError(503, "api_unreachable", "x"));
    render(await LeadPage(props()));
    expect(screen.getByText(/Could not load the suggestions/)).toBeInTheDocument();
    expect(screen.getByText("Catalogue says <b>silk</b>")).toBeInTheDocument();
  });

  it("the claims request turning 404 is the not-found page", async () => {
    fetchClaims.mockRejectedValue(new ApiRequestError(404, "not_found", "Not found."));
    expect(await isNotFound(() => LeadPage(props()))).toBe(true);
  });

  it("shows the lead's enquiries section and asks the API for the lead's enquiries with the user's token", async () => {
    render(await LeadPage(props()));
    expect(screen.getByRole("heading", { name: "Enquiries" })).toBeInTheDocument();
    expect(fetchLeadEnquiries).toHaveBeenCalledWith("tok", TENANT, LEAD);
    expect(screen.getByText("Paste a new enquiry")).toBeInTheDocument();
  });

  it("an API failure on the enquiries shows an error in that section only", async () => {
    fetchLeadEnquiries.mockRejectedValue(new ApiRequestError(502, "upstream_error", "x"));
    render(await LeadPage(props()));
    expect(screen.getByRole("alert")).toHaveTextContent(/Could not load the enquiries/);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Lead");
  });
});
