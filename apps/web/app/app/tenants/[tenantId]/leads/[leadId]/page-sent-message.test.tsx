import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiAuthError, ApiRequestError } from "@/lib/api/client";
import { redirectMock, redirectTarget } from "@/test/helpers";

const requireUser = vi.fn();
const fetchTenant = vi.fn();
const fetchLead = vi.fn();
const fetchLeadContactId = vi.fn();
const formProps = vi.fn();

vi.mock("next/navigation", () => ({ redirect: (to: string) => redirectMock(to), notFound: () => { throw new Error("not found"); } }));
vi.mock("@/lib/auth/session", () => ({ requireUser: () => requireUser() }));
vi.mock("@/lib/api/client", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/api/client")>()), fetchTenant: (...a: unknown[]) => fetchTenant(...a) }));
vi.mock("@/lib/api/crm", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/api/crm")>()), fetchLead: (...a: unknown[]) => fetchLead(...a) }));
vi.mock("@/lib/api/lead-contact", () => ({ fetchLeadContactId: (...a: unknown[]) => fetchLeadContactId(...a) }));
vi.mock("@/lib/api/evidence", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/api/evidence")>()), fetchEvidencePage: vi.fn(async () => ({ items: [], nextCursor: null })) }));
vi.mock("@/lib/api/agents", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/api/agents")>()), fetchClaims: vi.fn(async () => []) }));
vi.mock("@/lib/api/enquiries", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/api/enquiries")>()), fetchLeadEnquiries: vi.fn(async () => []) }));
vi.mock("../../enquiries/actions", () => ({ captureEnquiryAction: vi.fn(async () => undefined) }));
vi.mock("../../suggestion-actions", () => ({ reviewClaimAction: vi.fn(async () => undefined) }));
vi.mock("../../evidence-actions", () => ({ addEvidenceAction: vi.fn(async () => undefined) }));
vi.mock("./sent-message-actions", () => ({ recordSentMessageAction: vi.fn(async () => undefined) }));
vi.mock("./sent-message-form", () => ({
  SentMessageForm: (props: Record<string, unknown>) => {
    formProps(props);
    return <p>SENT-MESSAGE-FORM</p>;
  },
}));

import LeadPage from "./page";

const T = "22222222-2222-2222-2222-222222222222";
const L = "44444444-4444-4444-4444-444444444444";
const C = "55555555-5555-4555-8555-555555555555";
const USER = { id: "u", email: "e@example.test", accessToken: "tok" };
const props = (tenantId = T, leadId = L) => ({ params: Promise.resolve({ tenantId, leadId }), searchParams: Promise.resolve({}) }) as unknown as Parameters<typeof LeadPage>[0];
const tenant = (role: string) => ({ id: T, name: "Acme", slug: "acme", role });
const lead = { id: L, status: "qualified", source: "phone_call", created_via: "manual", created_at: "2026-02-03T04:05:06+00:00" };

beforeEach(() => {
  vi.clearAllMocks();
  requireUser.mockResolvedValue(USER);
  fetchTenant.mockResolvedValue(tenant("owner"));
  fetchLead.mockResolvedValue(lead);
  fetchLeadContactId.mockResolvedValue(C);
});

describe("the lead page: I sent a message", () => {
  it.each(["owner", "admin", "sales"])("a %s gets the form, with this lead's contact for the consent link", async (role) => {
    fetchTenant.mockResolvedValue(tenant(role));
    render(await LeadPage(props()));
    expect(screen.getByRole("heading", { name: "I sent a message" })).toBeInTheDocument();
    expect(screen.getByText("SENT-MESSAGE-FORM")).toBeInTheDocument();
    const p = formProps.mock.calls[0][0];
    expect(p.contactId).toBe(C);
    expect(p.tenantId).toBe(T);
    expect(p.touchId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(p.maxNow).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
    expect(fetchLeadContactId).toHaveBeenCalledWith("tok", T, L);
  });
  it("a viewer is told who records messages and gets no form; the contact is not even looked up", async () => {
    fetchTenant.mockResolvedValue(tenant("viewer"));
    render(await LeadPage(props()));
    expect(screen.getByText("An owner, an admin or a sales person records that a message was sent.")).toBeInTheDocument();
    expect(screen.queryByText("SENT-MESSAGE-FORM")).toBeNull();
    expect(fetchLeadContactId).not.toHaveBeenCalled();
  });
  it("a lead with no contact says so and links to Add a customer; no form", async () => {
    fetchLeadContactId.mockResolvedValue(null);
    render(await LeadPage(props()));
    expect(screen.getByText(/This lead has no contact attached, so a message to them cannot be recorded\./)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Add the customer first →" })).toHaveAttribute("href", `/app/tenants/${T}/customers/new`);
    expect(screen.queryByText("SENT-MESSAGE-FORM")).toBeNull();
  });
  it("if the contact cannot be read the form is still offered, without a consent link (the database decides)", async () => {
    fetchLeadContactId.mockRejectedValue(new ApiRequestError(503, "api_unreachable", "x"));
    render(await LeadPage(props()));
    expect(screen.getByText("SENT-MESSAGE-FORM")).toBeInTheDocument();
    expect(formProps.mock.calls[0][0].contactId).toBeNull();
  });
  it("a rejected session on the contact lookup goes to sign-in", async () => {
    fetchLeadContactId.mockRejectedValue(new ApiAuthError("no"));
    expect(await redirectTarget(() => LeadPage(props()))).toBe("/login");
  });
  it("every render makes a new id (one per page render)", async () => {
    render(await LeadPage(props()));
    render(await LeadPage(props()));
    expect(formProps.mock.calls[0][0].touchId).not.toBe(formProps.mock.calls[1][0].touchId);
  });
  it("shows no phone number or e-mail of the person", async () => {
    const { container } = render(await LeadPage(props()));
    expect(container.textContent).not.toMatch(/@|\+00|90000/);
  });
});
