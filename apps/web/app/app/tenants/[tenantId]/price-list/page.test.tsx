import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiAuthError, ApiRequestError } from "@/lib/api/client";
import { TENANT } from "@/lib/api/pricelists-fixtures";
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
vi.mock("./price-list-actions", () => ({ previewPriceListAction: vi.fn(async () => undefined), commitPriceListAction: vi.fn(async () => undefined) }));

import PriceListPage from "./page";

const tenant = (role: string) => ({ id: TENANT, name: "Acme", slug: "acme", role });
const props = (tenantId = TENANT) => ({ params: Promise.resolve({ tenantId }) }) as unknown as Parameters<typeof PriceListPage>[0];

beforeEach(() => {
  vi.clearAllMocks();
  requireUser.mockResolvedValue({ id: "u", email: "e", accessToken: "tok", aal: "aal2" });
  fetchTenant.mockResolvedValue(tenant("owner"));
});

describe("the price list page", () => {
  it.each(["owner", "admin"])("a %s sees the form, with the promise that nothing is sent", async (role) => {
    fetchTenant.mockResolvedValue(tenant(role));
    render(await PriceListPage(props()));
    expect(screen.getByRole("heading", { name: "Load a price list" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Check the file" })).toBeInTheDocument();
    expect(screen.getByText(/nothing is sent to anyone/)).toBeInTheDocument();
    expect(fetchTenant).toHaveBeenCalledWith("tok", TENANT);
  });

  it.each(["sales", "viewer"])("a %s is told who loads the price list and gets no form", async (role) => {
    fetchTenant.mockResolvedValue(tenant(role));
    render(await PriceListPage(props()));
    expect(screen.getByText("An owner or admin loads the price list.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Check the file" })).toBeNull();
  });

  it("a malformed workspace id and another workspace's are the same not-found; a rejected session goes to sign-in; an outage is plain", async () => {
    await expect(PriceListPage(props("x"))).rejects.toThrow("not found");
    fetchTenant.mockRejectedValue(new ApiRequestError(404, "not_found", "x"));
    await expect(PriceListPage(props())).rejects.toThrow("not found");
    fetchTenant.mockRejectedValue(new ApiAuthError("no"));
    expect(await redirectTarget(() => PriceListPage(props()))).toBe("/login");
    fetchTenant.mockRejectedValue(new ApiRequestError(503, "api_unreachable", "x"));
    render(await PriceListPage(props()));
    expect(screen.getByRole("alert")).toHaveTextContent("Could not load this from the API.");
  });
});
