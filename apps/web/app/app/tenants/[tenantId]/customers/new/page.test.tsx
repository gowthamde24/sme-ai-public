import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiAuthError, ApiRequestError } from "@/lib/api/client";
import { redirectMock, redirectTarget } from "@/test/helpers";

const requireUser = vi.fn();
const fetchTenant = vi.fn();

vi.mock("next/navigation", () => ({
  redirect: (to: string) => redirectMock(to),
  notFound: () => {
    throw new Error("not found");
  },
}));
vi.mock("@/lib/auth/session", () => ({ requireUser: () => requireUser() }));
vi.mock("@/lib/api/client", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/api/client")>()), fetchTenant: (...a: unknown[]) => fetchTenant(...a) }));
vi.mock("./actions", () => ({ addCustomerAction: vi.fn(async () => undefined) }));

import NewCustomerPage from "./page";

const T = "22222222-2222-2222-2222-222222222222";
const tenant = (role: string) => ({ id: T, name: "Acme", slug: "acme", role });
const props = (tenantId = T) => ({ params: Promise.resolve({ tenantId }) }) as unknown as Parameters<typeof NewCustomerPage>[0];
const BUTTON = "Add this customer";

beforeEach(() => {
  vi.clearAllMocks();
  requireUser.mockResolvedValue({ id: "u", email: "e", accessToken: "tok", aal: "aal2" });
  fetchTenant.mockResolvedValue(tenant("sales"));
});

describe("the add a customer page", () => {
  it.each(["owner", "admin", "sales"])("a %s sees the form with the promise that nothing is sent", async (role) => {
    fetchTenant.mockResolvedValue(tenant(role));
    render(await NewCustomerPage(props()));
    expect(screen.getByRole("heading", { name: "Add a customer" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: BUTTON })).toBeInTheDocument();
    expect(screen.getByText(/Nothing is sent to anyone/)).toBeInTheDocument();
    expect(fetchTenant).toHaveBeenCalledWith("tok", T);
  });
  it("the form asks for a phone and leaves the e-mail optional", async () => {
    render(await NewCustomerPage(props()));
    expect(screen.getByLabelText("WhatsApp or phone number")).toBeRequired();
    expect(screen.getByLabelText("E-mail (optional)")).not.toBeRequired();
    expect(screen.getByLabelText("Customer's name")).toBeRequired();
    expect(screen.getByLabelText("How did the enquiry come?")).toHaveValue("phone_call");
  });
  it("a viewer is told who adds customers and gets no form", async () => {
    fetchTenant.mockResolvedValue(tenant("viewer"));
    render(await NewCustomerPage(props()));
    expect(screen.getByText("An owner, an admin or a sales person adds customers.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: BUTTON })).toBeNull();
  });
  it("a malformed workspace id and another workspace's are the same not-found; a rejected session goes to sign-in; an outage is plain", async () => {
    await expect(NewCustomerPage(props("x"))).rejects.toThrow("not found");
    fetchTenant.mockRejectedValue(new ApiRequestError(404, "not_found", "x"));
    await expect(NewCustomerPage(props())).rejects.toThrow("not found");
    fetchTenant.mockRejectedValue(new ApiAuthError("no"));
    expect(await redirectTarget(() => NewCustomerPage(props()))).toBe("/login");
    fetchTenant.mockRejectedValue(new ApiRequestError(503, "api_unreachable", "x"));
    render(await NewCustomerPage(props()));
    expect(screen.getByRole("alert")).toHaveTextContent("Could not load this from the API.");
  });
});
