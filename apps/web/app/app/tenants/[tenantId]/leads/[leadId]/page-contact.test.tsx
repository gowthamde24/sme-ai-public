import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiRequestError } from "@/lib/api/client";
import { redirectMock } from "@/test/helpers";

const requireUser = vi.fn();
const fetchTenant = vi.fn();
const fetchLead = vi.fn();
const fetchLeadContactId = vi.fn();
const getLang = vi.fn();

vi.mock("next/navigation", () => ({ redirect: (to: string) => redirectMock(to), notFound: () => { throw new Error("not found"); } }));
vi.mock("@/lib/auth/session", () => ({ requireUser: () => requireUser() }));
vi.mock("@/i18n/get-lang", () => ({ getLang: () => getLang() }));
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
vi.mock("./contact-actions", () => ({ contactWhatsAppAction: vi.fn(async () => undefined), requestCallAction: vi.fn(async () => undefined) }));

import LeadPage from "./page";

const T = "22222222-2222-2222-2222-222222222222";
const L = "44444444-4444-4444-4444-444444444444";
const C = "55555555-5555-4555-8555-555555555555";
const props = () => ({ params: Promise.resolve({ tenantId: T, leadId: L }), searchParams: Promise.resolve({}) }) as unknown as Parameters<typeof LeadPage>[0];
const tenant = (role: string) => ({ id: T, name: "Acme", slug: "acme", role });

beforeEach(() => {
  vi.clearAllMocks();
  requireUser.mockResolvedValue({ id: "u", email: "e@example.test", accessToken: "tok" });
  fetchTenant.mockResolvedValue(tenant("owner"));
  fetchLead.mockResolvedValue({ id: L, status: "qualified", source: "phone_call", created_via: "manual", created_at: "2026-02-03T04:05:06+00:00" });
  fetchLeadContactId.mockResolvedValue(C);
  getLang.mockResolvedValue("en");
});

describe("the lead page: Contact this lead", () => {
  it.each(["owner", "admin", "sales"])("a %s gets the two ways to reach the lead and the visit button, FIRST on the page", async (role) => {
    fetchTenant.mockResolvedValue(tenant(role));
    render(await LeadPage(props()));
    const headings = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    expect(headings[0]).toBe("Contact this lead");
    expect(screen.getByRole("button", { name: "Contact on WhatsApp" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Request a call" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Book a store visit" })).toHaveAttribute("href", `/app/tenants/${T}/visits?lead=${L}#book`);
    expect(screen.getByRole("checkbox", { name: /Keep a record of this/ })).toBeChecked();
  });
  it("a Viewer gets none of it", async () => {
    fetchTenant.mockResolvedValue(tenant("viewer"));
    render(await LeadPage(props()));
    expect(screen.queryByRole("heading", { name: "Contact this lead" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Contact on WhatsApp" })).toBeNull();
  });
  it("a lead with no contact says so and offers only the visit", async () => {
    fetchLeadContactId.mockResolvedValue(null);
    render(await LeadPage(props()));
    expect(screen.getByRole("heading", { name: "Contact this lead" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Contact on WhatsApp" })).toBeNull();
    expect(screen.getByRole("link", { name: "Book a store visit" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Add the customer" })).toBeInTheDocument();
  });
  it("a contact that could not be read still offers the buttons (the database decides)", async () => {
    fetchLeadContactId.mockRejectedValue(new ApiRequestError(503, "api_unreachable", "x"));
    render(await LeadPage(props()));
    expect(screen.getByRole("button", { name: "Contact on WhatsApp" })).toBeInTheDocument();
  });
  it("is in the person's language", async () => {
    getLang.mockResolvedValue("hi");
    render(await LeadPage(props()));
    expect(screen.getByRole("heading", { name: "इस लीड से संपर्क करें" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "WhatsApp पर संपर्क करें" })).toBeInTheDocument();
  });
  it("never draws a number, a wa.me link or a tel: link", async () => {
    render(await LeadPage(props()));
    expect(document.querySelector('a[href*="wa.me"], a[href^="tel:"]')).toBeNull();
  });
});
