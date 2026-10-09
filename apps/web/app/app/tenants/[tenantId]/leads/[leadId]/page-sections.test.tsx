import { cleanup, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { notFoundMock, redirectMock } from "@/test/helpers";

const requireUser = vi.fn();
const fetchTenant = vi.fn();
const fetchLead = vi.fn();
const fetchEvidencePage = vi.fn();
const fetchClaims = vi.fn();
const fetchLeadEnquiries = vi.fn();

vi.mock("next/navigation", () => ({ redirect: (to: string) => redirectMock(to), notFound: () => notFoundMock() }));
vi.mock("@/lib/auth/session", () => ({ requireUser: () => requireUser() }));
vi.mock("@/lib/api/client", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/api/client")>()), fetchTenant: (...a: unknown[]) => fetchTenant(...a) }));
vi.mock("@/lib/api/crm", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/api/crm")>()), fetchLead: (...a: unknown[]) => fetchLead(...a) }));
vi.mock("@/lib/api/evidence", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/api/evidence")>()), fetchEvidencePage: (...a: unknown[]) => fetchEvidencePage(...a) }));
vi.mock("@/lib/api/agents", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/api/agents")>()), fetchClaims: (...a: unknown[]) => fetchClaims(...a) }));
vi.mock("@/lib/api/enquiries", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/api/enquiries")>()), fetchLeadEnquiries: (...a: unknown[]) => fetchLeadEnquiries(...a) }));
vi.mock("../../enquiries/actions", () => ({ captureEnquiryAction: vi.fn(async () => undefined) }));
vi.mock("../../suggestion-actions", () => ({ reviewClaimAction: vi.fn(async () => undefined) }));
vi.mock("../../evidence-actions", () => ({ addEvidenceAction: vi.fn(async () => undefined) }));

import LeadPage from "./page";

const TENANT = "22222222-2222-2222-2222-222222222222";
const LEAD = "44444444-4444-4444-4444-444444444444";
const props = (query: Record<string, string> = {}) => ({ params: Promise.resolve({ tenantId: TENANT, leadId: LEAD }), searchParams: Promise.resolve(query) }) as unknown as Parameters<typeof LeadPage>[0];
const evidence = { items: [{ linkId: "l1", kind: "document", provider: "manual", url: null, reference: "doc:cat-1", snippet: "Catalogue says silk", retrievedAt: "2026-01-02T03:04:05+00:00", publishedAt: null, createdVia: "manual" }], nextCursor: "next-1" };
const claim = { id: "88888888-8888-4888-8888-888888888888", company_id: null, lead_id: null, predicate: "selftest.observation", value: "DEMO suggestion", confidence: "unverified", claim_confidence: "unverified", created_via: "agent", agent_run_id: "99999999-9999-4999-8999-999999999999", created_by: "u", created_at: "2026-10-04T12:00:00+00:00", review_state: "unreviewed", review_confidence: null, reviewed_by: null, reviewed_at: null };
const tabs = () => within(screen.getByRole("navigation", { name: "Parts of this lead" }));
const current = () => tabs().getByRole("link", { current: "page" }).textContent;

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("crypto", { randomUUID: () => "33333333-3333-3333-3333-333333333333" });
  requireUser.mockResolvedValue({ id: "u", email: "e@example.test", accessToken: "tok" });
  fetchTenant.mockResolvedValue({ id: TENANT, name: "Acme", slug: "acme", role: "owner" });
  fetchLead.mockResolvedValue({ id: LEAD, status: "qualified", source: "DEMO trade fair", created_via: "manual", created_at: "2026-02-03T04:05:06+00:00" });
  fetchEvidencePage.mockResolvedValue(evidence);
  fetchClaims.mockResolvedValue([claim]);
  fetchLeadEnquiries.mockResolvedValue([]);
});

describe("the lead screen, one part at a time", () => {
  it("opens on the overview: the summary first, then the enquiries, then 'I sent a message'; no evidence, no suggestions", async () => {
    render(await LeadPage(props()));
    expect(current()).toBe("Overview");
    const headings = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    expect(headings).toEqual(["Lead", "Enquiries", "I sent a message"]);
    expect(screen.queryByText("Catalogue says silk")).toBeNull();
  });
  it("Evidence and Suggestions are real links to the same page; the suggestions tab says how many there are", async () => {
    render(await LeadPage(props({ section: "evidence" })));
    expect(current()).toBe("Evidence");
    expect(screen.getByText("Catalogue says silk")).toBeInTheDocument();
    expect(tabs().getByRole("link", { name: "Suggestions (1)" })).toHaveAttribute("href", `/app/tenants/${TENANT}/leads/${LEAD}?section=suggestions`);
    cleanup();
    render(await LeadPage(props({ section: "suggestions" })));
    expect(current()).toBe("Suggestions (1)");
    expect(screen.queryByText("Catalogue says silk")).toBeNull();
  });
  it("a paged evidence list (?cursor=) opens on the evidence; an unknown section falls back to the overview; section=all has no tabs", async () => {
    render(await LeadPage(props({ cursor: "next-1" })));
    expect(current()).toBe("Evidence");
    cleanup();
    render(await LeadPage(props({ section: "nope" })));
    expect(current()).toBe("Overview");
    cleanup();
    render(await LeadPage(props({ section: "all" })));
    expect(screen.queryByRole("navigation", { name: "Parts of this lead" })).toBeNull();
    expect(screen.getByText("Catalogue says silk")).toBeInTheDocument();
  });
  it("still asks the API the same questions whatever part is shown (the data calls did not change)", async () => {
    render(await LeadPage(props()));
    expect(fetchEvidencePage).toHaveBeenCalledWith("tok", TENANT, "leads", LEAD, null);
    expect(fetchClaims).toHaveBeenCalled();
  });
});
