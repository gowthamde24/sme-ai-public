import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiAuthError, ApiRequestError } from "@/lib/api/client";
import { TENANT } from "@/lib/api/orders-fixtures";
import { notFoundMock, redirectMock } from "@/test/helpers";

const requireUser = vi.fn();
const fetchTenant = vi.fn();
const getResearchStatus = vi.fn();
vi.mock("next/navigation", () => ({ redirect: (to: string) => redirectMock(to), notFound: () => notFoundMock(), useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/auth/session", () => ({ requireUser: () => requireUser() }));
vi.mock("@/lib/api/client", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/api/client")>()), fetchTenant: (...a: unknown[]) => fetchTenant(...a) }));
vi.mock("@/lib/api/retailers", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/api/retailers")>()), getResearchStatus: (...a: unknown[]) => getResearchStatus(...a) }));
vi.mock("./actions", () => ({ confirmPlaceAction: vi.fn() }));

import RetailersPage from "./page";

const props = () => ({ params: Promise.resolve({ tenantId: TENANT }) }) as unknown as Parameters<typeof RetailersPage>[0];
const tenant = (role: string) => ({ id: TENANT, name: "Acme Silks", slug: "acme-silks", role });
const STATUS = { web_search: { enabled: false, used_today: null, daily_limit: null }, read_page: { enabled: false, used_today: null, daily_limit: null }, find_retailers: { enabled: true, used_today: 3, daily_limit: 10 }, metal_prices: { enabled: false, used_today: null, daily_limit: null } };

beforeEach(() => {
  vi.clearAllMocks();
  requireUser.mockResolvedValue({ id: "u", email: "e@example.test", accessToken: "tok" });
  fetchTenant.mockResolvedValue(tenant("owner"));
  getResearchStatus.mockResolvedValue(STATUS);
});

describe("/retailers", () => {
  it("an owner sees the search and how much of the day's allowance is used", async () => {
    render(await RetailersPage(props()));
    expect(screen.getByRole("heading", { level: 1, name: "Find retailers" })).toBeInTheDocument();
    expect(screen.getByText("Map search is on. Used today: 3 of 10.")).toBeInTheDocument();
    expect(getResearchStatus).toHaveBeenCalledWith("tok", TENANT);
  });
  it("a salesperson gets the search without the status (the API shows it to owners and admins), and is not asked for it", async () => {
    fetchTenant.mockResolvedValue(tenant("sales"));
    render(await RetailersPage(props()));
    expect(getResearchStatus).not.toHaveBeenCalled();
    expect(screen.getByText(/We cannot tell from here whether map search is on/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Search" })).toBeEnabled();
  });
  it("a viewer is told this is not theirs", async () => {
    fetchTenant.mockResolvedValue(tenant("viewer"));
    render(await RetailersPage(props()));
    expect(screen.getByText(/Finding retailers is for the owner, admins and sales/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Search" })).toBeNull();
  });
  it.each([[new ApiRequestError(403, "forbidden", "x")], [new ApiRequestError(429, "rate_limited", "x")], [new ApiRequestError(503, "api_unreachable", "x")]])("a status that cannot be read (%j) leaves the search usable and says it cannot tell", async (error) => {
    getResearchStatus.mockRejectedValue(error);
    render(await RetailersPage(props()));
    expect(screen.getByText(/We cannot tell from here/)).toBeInTheDocument();
  });
  it("a rejected session goes to sign-in, an unknown workspace is not found, an unreachable API says so", async () => {
    getResearchStatus.mockRejectedValue(new ApiAuthError("x"));
    await expect(RetailersPage(props())).rejects.toThrow("/login");
    fetchTenant.mockRejectedValue(new ApiRequestError(404, "not_found", "x"));
    await expect(RetailersPage(props())).rejects.toThrow("NEXT_NOT_FOUND");
    fetchTenant.mockRejectedValue(new ApiRequestError(503, "api_unreachable", "x"));
    render(await RetailersPage(props()));
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });
});

describe("a refused or rate-limited read goes to the friendly pages (job CC, screen 7)", () => {
  it.each([[403, "/app/problem/403"], [429, "/app/problem/429"]])("the workspace read answering %i goes to %s", async (status, to) => {
    fetchTenant.mockRejectedValue(new ApiRequestError(status, status === 429 ? "rate_limited" : "forbidden", "x"));
    await expect(RetailersPage(props())).rejects.toThrow(`NEXT_REDIRECT:${to}`);
  });
});
