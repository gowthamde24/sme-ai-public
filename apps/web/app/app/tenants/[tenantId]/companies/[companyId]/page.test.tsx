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
const fetchCompany = vi.fn();
const fetchEvidencePage = vi.fn();
const fetchClaims = vi.fn();

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
  fetchCompany: (...a: unknown[]) => fetchCompany(...a),
}));
vi.mock("@/lib/api/evidence", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/evidence")>()),
  fetchEvidencePage: (...a: unknown[]) => fetchEvidencePage(...a),
}));
vi.mock("@/lib/api/agents", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/agents")>()),
  fetchClaims: (...a: unknown[]) => fetchClaims(...a),
}));
vi.mock("../../suggestion-actions", () => ({ reviewClaimAction: vi.fn(async () => undefined) }));
vi.mock("../../evidence-actions", () => ({
  addEvidenceAction: vi.fn(async () => undefined),
}));

import CompanyPage from "./page";

const TENANT = "22222222-2222-2222-2222-222222222222";
const COMPANY = "44444444-4444-4444-4444-444444444444";
const FORM_ID = "33333333-3333-3333-3333-333333333333";
const USER = { id: "u", email: "e@example.test", accessToken: "tok" };

function props(
  over: {
    tenantId?: string;
    companyId?: string;
    query?: Record<string, string | string[]>;
  } = {},
) {
  return {
    params: Promise.resolve({
      tenantId: over.tenantId ?? TENANT,
      companyId: over.companyId ?? COMPANY,
    }),
    searchParams: Promise.resolve({ section: "all", ...over.query }),
  } as unknown as Parameters<typeof CompanyPage>[0];
}
const tenant = (role: string) => ({
  id: TENANT,
  name: "Acme Workspace",
  slug: "acme",
  role,
});
const company = {
  id: COMPANY,
  name: "DEMO Meridian Textiles",
  type: "prospect",
  website: "https://demo.example.test",
  country: "IN",
  city: null,
  industry: "Silk",
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

describe("/app/tenants/[tenantId]/companies/[companyId]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("crypto", { randomUUID: () => FORM_ID });
    requireUser.mockResolvedValue(USER);
    fetchTenant.mockResolvedValue(tenant("owner"));
    fetchCompany.mockResolvedValue(company);
    fetchEvidencePage.mockResolvedValue(evidence);
    fetchClaims.mockResolvedValue([suggestion]);
  });

  it("authenticates FIRST: with no session nothing else is called", async () => {
    requireUser.mockImplementation(() => redirectMock("/login"));
    expect(await redirectTarget(() => CompanyPage(props()))).toBe("/login");
    expect(fetchTenant).not.toHaveBeenCalled();
    expect(fetchCompany).not.toHaveBeenCalled();
    expect(fetchEvidencePage).not.toHaveBeenCalled();
  });

  it("asks OUR API with the user's token: tenant, company, then the evidence", async () => {
    render(await CompanyPage(props()));
    expect(fetchTenant).toHaveBeenCalledWith("tok", TENANT);
    expect(fetchCompany).toHaveBeenCalledWith("tok", TENANT, COMPANY);
    expect(fetchEvidencePage).toHaveBeenCalledWith(
      "tok",
      TENANT,
      "companies",
      COMPANY,
      null,
    );
  });

  it("shows a short summary and the evidence as text", async () => {
    render(await CompanyPage(props()));
    expect(
      screen.getByRole("heading", { level: 1, name: "DEMO Meridian Textiles" }),
    ).toBeInTheDocument();
    for (const text of [
      "prospect",
      "https://demo.example.test",
      "IN",
      "Silk",
      "2026-02-03",
      "manual",
    ])
      expect(screen.getAllByText(text).length).toBeGreaterThan(0);
    expect(screen.getByText("Catalogue says <b>silk</b>")).toBeInTheDocument();
    expect(screen.getByText("doc:cat-1")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /Acme Workspace/ }),
    ).toHaveAttribute("href", `/app/tenants/${TENANT}?tab=companies`);
  });

  it("passes the opaque cursor on, and ignores an absurdly long one", async () => {
    render(await CompanyPage(props({ query: { cursor: "abc" } })));
    expect(fetchEvidencePage).toHaveBeenLastCalledWith(
      "tok",
      TENANT,
      "companies",
      COMPANY,
      "abc",
    );
    await CompanyPage(props({ query: { cursor: "x".repeat(301) } }));
    expect(fetchEvidencePage).toHaveBeenLastCalledWith(
      "tok",
      TENANT,
      "companies",
      COMPANY,
      null,
    );
  });

  it("offers Load more when the API issued a cursor", async () => {
    render(await CompanyPage(props()));
    expect(screen.getByRole("link", { name: "Load more" })).toHaveAttribute(
      "href",
      `/app/tenants/${TENANT}/companies/${COMPANY}?cursor=next-1`,
    );
  });

  // ---------------------------------------------------------------------- not found, always the same
  it("an unknown / foreign tenant is the not-found page and nothing else is read", async () => {
    fetchTenant.mockRejectedValue(
      new ApiRequestError(404, "not_found", "Not found."),
    );
    expect(await isNotFound(() => CompanyPage(props()))).toBe(true);
    expect(fetchCompany).not.toHaveBeenCalled();
    expect(fetchEvidencePage).not.toHaveBeenCalled();
  });

  it("an unknown / foreign company is the same not-found page and the evidence is never requested", async () => {
    fetchCompany.mockRejectedValue(
      new ApiRequestError(404, "not_found", "Not found."),
    );
    expect(await isNotFound(() => CompanyPage(props()))).toBe(true);
    expect(fetchEvidencePage).not.toHaveBeenCalled();
  });

  it("malformed tenant or company ids are not-found and never reach the API", async () => {
    for (const over of [
      { tenantId: "not-a-uuid" },
      { companyId: "../me" },
      { companyId: COMPANY.replaceAll("-", "") },
      { companyId: "x".repeat(200) },
    ])
      expect(await isNotFound(() => CompanyPage(props(over)))).toBe(true);
    expect(fetchTenant).not.toHaveBeenCalled();
    expect(fetchCompany).not.toHaveBeenCalled();
  });

  it("the evidence request turning 404 (access removed mid-visit) is not-found, not data", async () => {
    fetchEvidencePage.mockRejectedValue(
      new ApiRequestError(404, "not_found", "Not found."),
    );
    expect(await isNotFound(() => CompanyPage(props()))).toBe(true);
  });

  it("a rejected session goes to /login at any step", async () => {
    fetchTenant.mockRejectedValue(new ApiAuthError("expired"));
    expect(await redirectTarget(() => CompanyPage(props()))).toBe("/login");
    fetchTenant.mockResolvedValue(tenant("owner"));
    fetchEvidencePage.mockRejectedValue(new ApiAuthError("expired"));
    expect(await redirectTarget(() => CompanyPage(props()))).toBe("/login");
  });

  // ------------------------------------------------------------------------------------- API down
  it("API down for the record: an error state and no placeholder data", async () => {
    fetchCompany.mockRejectedValue(
      new ApiRequestError(503, "api_unreachable", "The API is unreachable."),
    );
    render(await CompanyPage(props()));
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Could not load this from the API",
    );
    expect(screen.queryByText("DEMO Meridian Textiles")).toBeNull();
    expect(screen.queryByText("No evidence yet.")).toBeNull();
  });

  it("an unexpected response shape is an error state, not rendered", async () => {
    fetchCompany.mockRejectedValue(new ApiContractError("bad"));
    render(await CompanyPage(props()));
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("API down for the evidence only: the summary stays, the evidence section shows an error", async () => {
    fetchClaims.mockResolvedValue([]);
    fetchEvidencePage.mockRejectedValue(
      new ApiRequestError(502, "upstream_error", "x"),
    );
    render(await CompanyPage(props()));
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "DEMO Meridian Textiles",
    );
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
    render(await CompanyPage(props()));
    expect(!!screen.queryByRole("form", { name: "Add evidence" })).toBe(shown);
  });

  it("the form carries one id per render", async () => {
    render(await CompanyPage(props()));
    const hidden = document.querySelector(
      'form[aria-label="Add evidence"] input[name="id"]',
    ) as HTMLInputElement;
    expect(hidden.value).toBe(FORM_ID);
  });

  it("renders no claims and no archive control", async () => {
    render(await CompanyPage(props()));
    expect(screen.queryByText(/claim/i)).toBeNull();
    expect(
      screen.queryByRole("button", { name: /archive|delete/i }),
    ).toBeNull();
  });

  // ---------------------------------------------------------------------- agent suggestions (T006)
  it("asks OUR API for the companie's claims with the user's token and shows them as 'agent suggestion, unreviewed'", async () => {
    render(await CompanyPage(props()));
    expect(fetchClaims).toHaveBeenCalledWith("tok", TENANT, "companies", COMPANY);
    expect(screen.getByText(/agent suggestion, unreviewed/)).toBeInTheDocument();
    expect(screen.getByText("DEMO <i>suggestion</i>")).toBeInTheDocument();
  });

  it("shows the review forms to an owner or admin only; Sales and Viewers see the suggestion but no forms", async () => {
    for (const role of ["owner", "admin"]) {
      fetchTenant.mockResolvedValue(tenant(role));
      const { unmount } = render(await CompanyPage(props()));
      expect(screen.getByRole("button", { name: "Accept" })).toBeInTheDocument();
      unmount();
    }
    for (const role of ["sales", "viewer"]) {
      fetchTenant.mockResolvedValue(tenant(role));
      const { unmount } = render(await CompanyPage(props()));
      expect(screen.getByText(/agent suggestion, unreviewed/)).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Accept" })).toBeNull();
      unmount();
    }
  });

  it("generates the review ids on the server, one pair per suggestion per render", async () => {
    let n = 0;
    vi.stubGlobal("crypto", { randomUUID: () => `id-${n++}` });
    fetchTenant.mockResolvedValue(tenant("owner"));
    render(await CompanyPage(props()));
    const ids = Array.from(document.querySelectorAll<HTMLInputElement>('input[name="review_id"]')).map((i) => i.value);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2); // accept and reject never share an id
  });

  it("a failing claims request shows an error in that section only; the rest of the page is intact", async () => {
    fetchClaims.mockRejectedValue(new ApiRequestError(503, "api_unreachable", "x"));
    render(await CompanyPage(props()));
    expect(screen.getByText(/Could not load the suggestions/)).toBeInTheDocument();
    expect(screen.getByText("Catalogue says <b>silk</b>")).toBeInTheDocument();
  });

  it("the claims request turning 404 is the not-found page", async () => {
    fetchClaims.mockRejectedValue(new ApiRequestError(404, "not_found", "Not found."));
    expect(await isNotFound(() => CompanyPage(props()))).toBe(true);
  });
});
