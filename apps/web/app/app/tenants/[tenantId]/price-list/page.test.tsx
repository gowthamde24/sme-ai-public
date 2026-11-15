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
vi.mock("../item-types/price-ranges", () => ({ PriceRanges: (p: { role: string }) => <section id="price-ranges">PRICE-RANGES-{p.role}</section> }));
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
    expect(screen.getByRole("heading", { level: 1, name: "Price lists" })).toBeInTheDocument(); // the title of the tab
    expect(screen.getByRole("heading", { level: 2, name: "Load a price list" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Check the file" })).toBeInTheDocument();
    // the price list is on top, the Price ranges section is under it, and there is no second row of tabs
    const load = document.querySelector('[data-part="load-price-list"]') as HTMLElement;
    const ranges = document.getElementById("price-ranges") as HTMLElement;
    expect(load.compareDocumentPosition(ranges) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByText(`PRICE-RANGES-${role}`)).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: /Parts of/ })).toBeNull();
    expect(screen.getByText(/nothing is sent to anyone/)).toBeInTheDocument();
    expect(fetchTenant).toHaveBeenCalledWith("tok", TENANT);
  });

  it("a sales user is told who loads the price list, gets no form, and reads the Price ranges", async () => {
    fetchTenant.mockResolvedValue(tenant("sales"));
    render(await PriceListPage(props()));
    expect(screen.getByText("An owner or admin loads the price list.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Check the file" })).toBeNull();
    expect(screen.getByText("PRICE-RANGES-sales")).toBeInTheDocument();
  });
  it("a viewer gets the title and one plain sentence: no form, and no price ranges are read", async () => {
    fetchTenant.mockResolvedValue(tenant("viewer"));
    render(await PriceListPage(props()));
    expect(screen.getByRole("heading", { level: 1, name: "Price lists" })).toBeInTheDocument();
    expect(screen.getByText("An owner or admin loads the price list.")).toBeInTheDocument();
    expect(screen.queryByText(/PRICE-RANGES/)).toBeNull();
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
