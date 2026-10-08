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
vi.mock("./actions", () => ({ addProductAction: vi.fn(async () => undefined) }));

import NewProductPage from "./page";

const T = "22222222-2222-2222-2222-222222222222";
const tenant = (role: string) => ({ id: T, name: "Acme", slug: "acme", role });
const props = (tenantId = T) => ({ params: Promise.resolve({ tenantId }) }) as unknown as Parameters<typeof NewProductPage>[0];
const BUTTON = "Add this product";

beforeEach(() => {
  vi.clearAllMocks();
  requireUser.mockResolvedValue({ id: "u", email: "e", accessToken: "tok", aal: "aal1" });
  fetchTenant.mockResolvedValue(tenant("admin"));
});

describe("the add a product page", () => {
  it.each(["owner", "admin"])("a %s sees the form and no second factor is asked", async (role) => {
    fetchTenant.mockResolvedValue(tenant(role));
    render(await NewProductPage(props()));
    expect(screen.getByRole("heading", { name: "Add a product" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: BUTTON })).toBeEnabled();
    expect(screen.queryByText(/authenticator/i)).toBeNull();
    expect(screen.getByLabelText("Sold by")).toHaveValue("piece");
    expect(screen.getByLabelText("Category (optional)")).not.toBeRequired();
    expect(fetchTenant).toHaveBeenCalledWith("tok", T);
  });
  it("says that no price is set here", async () => {
    render(await NewProductPage(props()));
    expect(screen.getByText(/No price is set here/)).toBeInTheDocument();
  });
  it.each(["sales", "viewer"])("a %s is told who adds products and gets no form", async (role) => {
    fetchTenant.mockResolvedValue(tenant(role));
    render(await NewProductPage(props()));
    expect(screen.getByText("An owner or an admin adds products.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: BUTTON })).toBeNull();
  });
  it("a malformed workspace id and another workspace's are the same not-found; a rejected session goes to sign-in; an outage is plain", async () => {
    await expect(NewProductPage(props("x"))).rejects.toThrow("not found");
    fetchTenant.mockRejectedValue(new ApiRequestError(404, "not_found", "x"));
    await expect(NewProductPage(props())).rejects.toThrow("not found");
    fetchTenant.mockRejectedValue(new ApiAuthError("no"));
    expect(await redirectTarget(() => NewProductPage(props()))).toBe("/login");
    fetchTenant.mockRejectedValue(new ApiRequestError(503, "api_unreachable", "x"));
    render(await NewProductPage(props()));
    expect(screen.getByRole("alert")).toHaveTextContent("Could not load this from the API.");
  });
});
