import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiAuthError, ApiRequestError } from "@/lib/api/client";
import { redirectMock, redirectTarget } from "@/test/helpers";

const requireUser = vi.fn();
const fetchTenant = vi.fn();
const fetchContact = vi.fn();

vi.mock("next/navigation", () => ({
  redirect: (to: string) => redirectMock(to),
  notFound: () => {
    throw new Error("not found");
  },
}));
vi.mock("@/lib/auth/session", () => ({ requireUser: () => requireUser() }));
vi.mock("@/lib/api/client", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/api/client")>()), fetchTenant: (...a: unknown[]) => fetchTenant(...a) }));
vi.mock("@/lib/api/crm", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/api/crm")>()), fetchContact: (...a: unknown[]) => fetchContact(...a) }));
vi.mock("./actions", () => ({ recordConsentAction: vi.fn(async () => undefined) }));

import ConsentPage from "./page";

const T = "22222222-2222-2222-2222-222222222222";
const C = "44444444-4444-4444-4444-444444444444";
const tenant = (role: string) => ({ id: T, name: "Acme", slug: "acme", role });
const contact = (over: Record<string, unknown> = {}) => ({ id: C, full_name: "Synthetic Asha", email: "asha@x.example.test", phone: "+00 90000 20001", job_title: null, email_consent: "unknown", whatsapp_consent: "granted", phone_consent: "withdrawn", suppression_reason: null, created_via: "manual", ...over });
const props = (tenantId = T, contactId = C) => ({ params: Promise.resolve({ tenantId, contactId }) }) as unknown as Parameters<typeof ConsentPage>[0];
const BUTTON = "Record this";

beforeEach(() => {
  vi.clearAllMocks();
  requireUser.mockResolvedValue({ id: "u", email: "e", accessToken: "tok", aal: "aal1" });
  fetchTenant.mockResolvedValue(tenant("sales"));
  fetchContact.mockResolvedValue(contact());
});

describe("the record consent page", () => {
  it.each(["owner", "admin", "sales"])("a %s sees the name, the three states and the form", async (role) => {
    fetchTenant.mockResolvedValue(tenant(role));
    render(await ConsentPage(props()));
    expect(screen.getByText("Synthetic Asha")).toBeInTheDocument();
    expect(screen.getByText("WhatsApp: Granted")).toBeInTheDocument();
    expect(screen.getByText("Phone call: Withdrawn")).toBeInTheDocument();
    expect(screen.getByText("E-mail: Nothing recorded")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: BUTTON })).toBeInTheDocument();
    expect(fetchContact).toHaveBeenCalledWith("tok", T, C);
  });
  it("shows neither the number nor the address, and says it is only a record", async () => {
    const { container } = render(await ConsentPage(props()));
    expect(container.textContent).not.toMatch(/90000|asha@x/);
    expect(screen.getByText(/does not check it, and it is not legal advice/)).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/\b(valid|lawful|compliant|verified)\b/i);
  });
  it("a second factor is not demanded by the page", async () => {
    render(await ConsentPage(props()));
    expect(screen.queryByText(/authenticator/i)).toBeNull();
    expect(screen.getByRole("button", { name: BUTTON })).toBeEnabled();
  });
  it("tells the person when the contact is marked not to be contacted", async () => {
    fetchContact.mockResolvedValue(contact({ suppression_reason: "opted_out" }));
    render(await ConsentPage(props()));
    expect(screen.getByText(/marked as not to be contacted \(opted_out\)/)).toBeInTheDocument();
  });
  it.each(["viewer"])("a %s is told who records consent and nothing is asked of the API", async (role) => {
    fetchTenant.mockResolvedValue(tenant(role));
    render(await ConsentPage(props()));
    expect(screen.getByText("An owner, an admin or a sales person records consent.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: BUTTON })).toBeNull();
    expect(fetchContact).not.toHaveBeenCalled();
  });
  it("malformed ids and another workspace's or contact's are the same not-found; a rejected session goes to sign-in; an outage is plain", async () => {
    await expect(ConsentPage(props("x"))).rejects.toThrow("not found");
    await expect(ConsentPage(props(T, "../x"))).rejects.toThrow("not found");
    fetchTenant.mockRejectedValue(new ApiRequestError(404, "not_found", "x"));
    await expect(ConsentPage(props())).rejects.toThrow("not found");
    fetchTenant.mockResolvedValue(tenant("sales"));
    fetchContact.mockRejectedValue(new ApiRequestError(404, "not_found", "x"));
    await expect(ConsentPage(props())).rejects.toThrow("not found");
    fetchContact.mockRejectedValue(new ApiAuthError("no"));
    expect(await redirectTarget(() => ConsentPage(props()))).toBe("/login");
    fetchContact.mockRejectedValue(new ApiRequestError(503, "api_unreachable", "x"));
    render(await ConsentPage(props()));
    expect(screen.getByRole("alert")).toHaveTextContent("Could not load this from the API.");
  });
});
