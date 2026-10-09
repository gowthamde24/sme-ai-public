import { cleanup, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { notFoundMock, redirectMock } from "@/test/helpers";

const requireUser = vi.fn();
const fetchTenant = vi.fn();
const fetchCompany = vi.fn();
const fetchEvidencePage = vi.fn();
const fetchClaims = vi.fn();

vi.mock("next/navigation", () => ({ redirect: (to: string) => redirectMock(to), notFound: () => notFoundMock() }));
vi.mock("@/lib/auth/session", () => ({ requireUser: () => requireUser() }));
vi.mock("@/lib/api/client", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/api/client")>()), fetchTenant: (...a: unknown[]) => fetchTenant(...a) }));
vi.mock("@/lib/api/crm", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/api/crm")>()), fetchCompany: (...a: unknown[]) => fetchCompany(...a) }));
vi.mock("@/lib/api/evidence", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/api/evidence")>()), fetchEvidencePage: (...a: unknown[]) => fetchEvidencePage(...a) }));
vi.mock("@/lib/api/agents", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/api/agents")>()), fetchClaims: (...a: unknown[]) => fetchClaims(...a) }));
vi.mock("../../suggestion-actions", () => ({ reviewClaimAction: vi.fn(async () => undefined) }));
vi.mock("../../evidence-actions", () => ({ addEvidenceAction: vi.fn(async () => undefined) }));

import CompanyPage from "./page";

const TENANT = "22222222-2222-2222-2222-222222222222";
const COMPANY = "44444444-4444-4444-4444-444444444444";
const props = (query: Record<string, string> = {}) => ({ params: Promise.resolve({ tenantId: TENANT, companyId: COMPANY }), searchParams: Promise.resolve(query) }) as unknown as Parameters<typeof CompanyPage>[0];
const evidence = { items: [{ linkId: "l1", kind: "document", provider: "manual", url: null, reference: "doc:cat-1", snippet: "Catalogue says silk", retrievedAt: "2026-01-02T03:04:05+00:00", publishedAt: null, createdVia: "manual" }], nextCursor: "next-1" };
const claim = { id: "88888888-8888-4888-8888-888888888888", company_id: null, lead_id: null, predicate: "selftest.observation", value: "DEMO suggestion", confidence: "unverified", claim_confidence: "unverified", created_via: "agent", agent_run_id: "99999999-9999-4999-8999-999999999999", created_by: "u", created_at: "2026-10-04T12:00:00+00:00", review_state: "unreviewed", review_confidence: null, reviewed_by: null, reviewed_at: null };
const tenant = (role: string) => ({ id: TENANT, name: "Acme", slug: "acme", role });
const tabs = () => within(screen.getByRole("navigation", { name: "Parts of this company" }));
const current = () => tabs().getByRole("link", { current: "page" }).textContent;

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("crypto", { randomUUID: () => "33333333-3333-3333-3333-333333333333" });
  requireUser.mockResolvedValue({ id: "u", email: "e@example.test", accessToken: "tok" });
  fetchTenant.mockResolvedValue(tenant("owner"));
  fetchCompany.mockResolvedValue({ id: COMPANY, name: "DEMO Silks", type: "customer", website: null, country: "IN", city: "Chennai", industry: null, created_via: "manual", created_at: "2026-02-03T04:05:06+00:00" });
  fetchEvidencePage.mockResolvedValue(evidence);
  fetchClaims.mockResolvedValue([claim]);
});

describe("the company screen, one part at a time", () => {
  it("opens on the details: the summary only, no evidence and no suggestions", async () => {
    render(await CompanyPage(props()));
    expect(current()).toBe("Details");
    expect(screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent)).toEqual(["Company"]);
    expect(screen.queryByText("Catalogue says silk")).toBeNull();
    expect(screen.queryByText("DEMO suggestion")).toBeNull();
  });
  it("Evidence and Suggestions are real links to the same page; the suggestions tab says how many there are", async () => {
    render(await CompanyPage(props({ section: "evidence" })));
    expect(current()).toBe("Evidence");
    expect(screen.getByText("Catalogue says silk")).toBeInTheDocument();
    expect(tabs().getByRole("link", { name: "Suggestions (1)" })).toHaveAttribute("href", `/app/tenants/${TENANT}/companies/${COMPANY}?section=suggestions`);
    cleanup();
    render(await CompanyPage(props({ section: "suggestions" })));
    expect(current()).toBe("Suggestions (1)");
    expect(screen.getByText("DEMO suggestion")).toBeInTheDocument();
    expect(screen.queryByText("Catalogue says silk")).toBeNull();
  });
  it("an unknown section word falls back to the details; a paged evidence list (?cursor=) opens on the evidence", async () => {
    for (const word of ["nope", "<script>", ""]) {
      render(await CompanyPage(props({ section: word })));
      expect(current()).toBe("Details");
      cleanup();
    }
    render(await CompanyPage(props({ cursor: "next-1" })));
    expect(current()).toBe("Evidence");
  });
  it("?section=all draws every part with no tabs", async () => {
    render(await CompanyPage(props({ section: "all" })));
    expect(screen.queryByRole("navigation", { name: "Parts of this company" })).toBeNull();
    for (const name of ["Company", "Evidence", "Agent suggestions"]) expect(screen.getByRole("heading", { level: 2, name })).toBeInTheDocument();
    expect(screen.getByText("Catalogue says silk")).toBeInTheDocument();
    expect(screen.getByText("DEMO suggestion")).toBeInTheDocument();
  });
  it("the role only changes the controls inside a part, never which parts exist: a viewer sees the same tabs but no add-evidence form and no review buttons; sales can add but not review", async () => {
    fetchTenant.mockResolvedValue(tenant("viewer"));
    render(await CompanyPage(props({ section: "evidence" })));
    expect(tabs().getAllByRole("link").map((a) => a.textContent)).toEqual(["Details", "Evidence", "Suggestions (1)"]);
    expect(screen.queryByRole("heading", { name: "Add evidence" })).toBeNull();
    cleanup();
    render(await CompanyPage(props({ section: "suggestions" })));
    expect(screen.queryByRole("button", { name: "Accept" })).toBeNull();
    cleanup();
    fetchTenant.mockResolvedValue(tenant("sales"));
    render(await CompanyPage(props({ section: "evidence" })));
    expect(screen.getByRole("heading", { name: "Add evidence" })).toBeInTheDocument();
    cleanup();
    render(await CompanyPage(props({ section: "suggestions" })));
    expect(screen.queryByRole("button", { name: "Accept" })).toBeNull();
    cleanup();
    fetchTenant.mockResolvedValue(tenant("owner"));
    render(await CompanyPage(props({ section: "suggestions" })));
    expect(screen.getByRole("button", { name: "Accept" })).toBeInTheDocument();
  });
  it("still asks the API the same questions whatever part is shown (the data calls did not change)", async () => {
    render(await CompanyPage(props()));
    expect(fetchEvidencePage).toHaveBeenCalledWith("tok", TENANT, "companies", COMPANY, null);
    expect(fetchClaims).toHaveBeenCalled();
  });
});
