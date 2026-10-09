import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiRequestError } from "@/lib/api/client";
import { notFoundMock, redirectMock } from "@/test/helpers";

const requireUser = vi.fn();
const fetchTenant = vi.fn();
const fetchOrders = vi.fn();
const fetchMembers = vi.fn();

vi.mock("next/navigation", () => ({ redirect: (to: string) => redirectMock(to), notFound: () => notFoundMock() }));
vi.mock("@/lib/auth/session", () => ({ requireUser: () => requireUser() }));
vi.mock("@/lib/api/client", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/api/client")>()), fetchTenant: (...a: unknown[]) => fetchTenant(...a) }));
vi.mock("@/lib/api/orders", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/api/orders")>()), fetchOrders: (...a: unknown[]) => fetchOrders(...a), fetchMembers: (...a: unknown[]) => fetchMembers(...a) }));
vi.mock("./actions", () => ({ createCompanyAction: vi.fn(async () => undefined) }));

import TenantPage from "./page";

const TENANT = "22222222-2222-2222-2222-222222222222";
const props = (query: Record<string, string> = {}) => ({ params: Promise.resolve({ tenantId: TENANT }), searchParams: Promise.resolve(query) }) as unknown as Parameters<typeof TenantPage>[0];
const order = (over: Record<string, unknown>) => ({ id: "o", order_no: 1, outcome: "open", net_paise: 0, ...over });

beforeEach(() => {
  vi.clearAllMocks();
  requireUser.mockResolvedValue({ id: "user-1", email: "e@example.test", accessToken: "tok" });
  fetchTenant.mockResolvedValue({ id: TENANT, name: "Acme Silks", slug: "acme", role: "owner" });
  fetchOrders.mockResolvedValue({ items: [], next_cursor: null });
  fetchMembers.mockResolvedValue([]);
});

describe("the workspace home with no ?tab= is Today", () => {
  it("draws the greeting, the three cards from the orders it can read, and 'Not available yet' for what it cannot (nothing is made up)", async () => {
    fetchOrders.mockResolvedValue({ items: [order({ id: "1" }), order({ id: "2" }), order({ id: "3", outcome: "cancelled", net_paise: 782000 }), order({ id: "4", outcome: "won", net_paise: 500000 })], next_cursor: null });
    render(await TenantPage(props()));
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(/^Good (morning|afternoon|evening)$/); // no display name on record
    const cards = screen.getAllByRole("link").filter((a) => /Waiting for you|Customer money held|Orders in progress/.test(a.textContent ?? ""));
    expect(cards).toHaveLength(3);
    expect(cards[0]).toHaveTextContent("Waiting for youNot available yet");
    expect(cards[1]).toHaveTextContent("₹7,820.00"); // only the cancelled order's money counts as held; the won order is paid for
    expect(cards[2]).toHaveTextContent("2");
    for (const name of ["Needs you", "Your team right now", "Recently recorded"]) {
      const section = screen.getByRole("heading", { name }).closest("section")!;
      expect(within(section).getByText("Not available yet")).toBeInTheDocument();
    }
  });
  it("greets the person by the display name the members list has for them", async () => {
    fetchMembers.mockResolvedValue([{ user_id: "other", role: "sales", display_name: "Someone Else" }, { user_id: "user-1", role: "owner", display_name: "Asha Rao" }]);
    render(await TenantPage(props()));
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(/^Good (morning|afternoon|evening), Asha Rao$/);
  });
  it("a read that fails leaves only its own card at 'Not available yet'; more than 500 orders is not a number either", async () => {
    fetchOrders.mockRejectedValue(new ApiRequestError(500, "api_error", "x"));
    fetchMembers.mockRejectedValue(new ApiRequestError(500, "api_error", "x"));
    render(await TenantPage(props()));
    expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument();
    expect(screen.getAllByText("Not available yet").length).toBeGreaterThanOrEqual(6);
  });
  it("says 'Not available yet' for the orders cards when there are more orders than it reads (never a partial number)", async () => {
    fetchOrders.mockResolvedValue({ items: [order({})], next_cursor: "more" });
    render(await TenantPage(props()));
    expect(fetchOrders).toHaveBeenCalledTimes(10);
    expect(screen.queryByText("₹0.00")).toBeNull();
  });
  it("asks the API with the user's token and the workspace, and still sends a rejected session to sign in or a missing workspace to not-found", async () => {
    render(await TenantPage(props()));
    expect(fetchOrders).toHaveBeenCalledWith("tok", TENANT, { limit: 50, cursor: null });
    fetchTenant.mockRejectedValue(new ApiRequestError(404, "not_found", "x"));
    await expect(TenantPage(props())).rejects.toThrow();
  });
  it("?tab= still shows the records tables, and an unknown tab shows the companies", async () => {
    render(await TenantPage(props({ tab: "nonsense" })));
    expect(screen.queryByText("Needs you")).toBeNull();
  });
});
