import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiAuthError, ApiRequestError } from "@/lib/api/client";
import { parseMembers, parseOrderDetail, parseOrderPage } from "@/lib/api/orders";
import { DETAIL_JSON, MEMBERS_JSON, ORDER, ORDER_JSON, TENANT } from "@/lib/api/orders-fixtures";
import { redirectMock, redirectTarget } from "@/test/helpers";

const requireUser = vi.fn();
const fetchTenant = vi.fn();
const orders = { fetchOrders: vi.fn(), fetchOrder: vi.fn(), fetchMembers: vi.fn() };

vi.mock("next/navigation", () => ({
  redirect: (to: string) => redirectMock(to),
  notFound: () => {
    throw new Error("not found");
  },
}));
vi.mock("@/lib/auth/session", () => ({ requireUser: () => requireUser() }));
vi.mock("@/lib/api/client", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/api/client")>()), fetchTenant: (...a: unknown[]) => fetchTenant(...a) }));
vi.mock("@/lib/api/orders", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/orders")>()),
  fetchOrders: (...a: unknown[]) => orders.fetchOrders(...a),
  fetchOrder: (...a: unknown[]) => orders.fetchOrder(...a),
  fetchMembers: (...a: unknown[]) => orders.fetchMembers(...a),
}));
vi.mock("./order-actions", () => ({ recordEventAction: vi.fn(async () => undefined), startOrderAction: vi.fn(async () => undefined) }));

import OrderPage from "./[orderId]/page";
import OrdersPage from "./page";

const tenant = (role: string) => ({ id: TENANT, name: "Acme", slug: "acme", role });
const listProps = (query: Record<string, string> = {}) =>
  ({ params: Promise.resolve({ tenantId: TENANT }), searchParams: Promise.resolve(query) }) as unknown as Parameters<typeof OrdersPage>[0];
const orderProps = (orderId = ORDER, tenantId = TENANT) => ({ params: Promise.resolve({ tenantId, orderId }) }) as unknown as Parameters<typeof OrderPage>[0];

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("crypto", { randomUUID: () => "77777777-7777-4777-8777-777777777777" });
  requireUser.mockResolvedValue({ id: "u", email: "e", accessToken: "tok", aal: "aal2" });
  fetchTenant.mockResolvedValue(tenant("owner"));
  orders.fetchOrders.mockResolvedValue(parseOrderPage({ items: [ORDER_JSON], next_cursor: null }));
  orders.fetchOrder.mockResolvedValue(parseOrderDetail(DETAIL_JSON));
  orders.fetchMembers.mockResolvedValue(parseMembers(MEMBERS_JSON));
});

describe("the orders list", () => {
  it("a viewer sees no order and nothing is asked of the API for them", async () => {
    fetchTenant.mockResolvedValue(tenant("viewer"));
    render(await OrdersPage(listProps()));
    expect(screen.getByText("Orders are shown to owners, admins and sales users.")).toBeInTheDocument();
    expect(orders.fetchOrders).not.toHaveBeenCalled();
    expect(screen.queryByText(/₹/)).toBeNull();
  });

  it.each(["owner", "admin", "sales"])("a %s user sees the orders with amounts, read with their own token", async (role) => {
    fetchTenant.mockResolvedValue(tenant(role));
    render(await OrdersPage(listProps()));
    expect(orders.fetchOrders).toHaveBeenCalledWith("tok", TENANT, { cursor: null });
    const item = within(screen.getByRole("list", { name: "Orders, newest first" })).getByRole("listitem");
    expect(item).toHaveTextContent("Order 7");
    expect(item).toHaveTextContent("Open · Quote approved");
    expect(item).toHaveTextContent("Total ₹1,50,000.00");
    expect(screen.getByRole("link", { name: "Order 7" })).toHaveAttribute("href", `/app/tenants/${TENANT}/orders/${ORDER}`);
    expect(screen.getByRole("note")).toHaveTextContent("Nothing is sent by this system");
  });

  it("a closed order that holds money says so in the list too; a paid or empty one does not (step F8)", async () => {
    const held = { ...ORDER_JSON, id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2", order_no: 8, state: "cancelled", outcome: "cancelled", paid_paise: 882000, refunded_paise: 100000, net_paise: 782000 };
    const paid = { ...ORDER_JSON, id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3", order_no: 9, state: "closed_paid", outcome: "won", paid_paise: 15000000, net_paise: 15000000, balance_paise: 0 };
    const empty = { ...ORDER_JSON, id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb4", order_no: 10, state: "declined", outcome: "lost" };
    orders.fetchOrders.mockResolvedValue(parseOrderPage({ items: [held, paid, empty], next_cursor: null }));
    render(await OrdersPage(listProps()));
    const items = within(screen.getByRole("list", { name: "Orders, newest first" })).getAllByRole("listitem");
    expect(items[0]).toHaveTextContent("Money still held: ₹7,820.00. A refund may be owed to the customer.");
    expect(items[1]).not.toHaveTextContent("Money still held");
    expect(items[2]).not.toHaveTextContent("Money still held");
  });

  it("says so when there are no orders, and pages with the API's cursor", async () => {
    orders.fetchOrders.mockResolvedValue(parseOrderPage({ items: [], next_cursor: null }));
    render(await OrdersPage(listProps()));
    expect(screen.getByText(/No orders yet/)).toBeInTheDocument();
    orders.fetchOrders.mockResolvedValue(parseOrderPage({ items: [ORDER_JSON], next_cursor: "a b" }));
    render(await OrdersPage(listProps({ cursor: "xyz" })));
    expect(orders.fetchOrders).toHaveBeenLastCalledWith("tok", TENANT, { cursor: "xyz" });
    expect(screen.getByRole("link", { name: "Older orders →" })).toHaveAttribute("href", `/app/tenants/${TENANT}/orders?cursor=a%20b`);
  });

  it("a malformed workspace id is not found; a rejected session goes to sign-in; an API outage is said plainly", async () => {
    await expect(OrdersPage({ params: Promise.resolve({ tenantId: "x" }), searchParams: Promise.resolve({}) } as never)).rejects.toThrow("not found");
    orders.fetchOrders.mockRejectedValue(new ApiAuthError("no"));
    expect(await redirectTarget(() => OrdersPage(listProps()))).toBe("/login");
    orders.fetchOrders.mockRejectedValue(new ApiRequestError(503, "api_unreachable", "x"));
    render(await OrdersPage(listProps()));
    expect(screen.getByRole("alert")).toHaveTextContent("Could not load this from the API.");
  });
});

describe("the order page", () => {
  it("a viewer sees no order", async () => {
    fetchTenant.mockResolvedValue(tenant("viewer"));
    render(await OrderPage(orderProps()));
    expect(screen.getByText("Orders are shown to owners, admins and sales users.")).toBeInTheDocument();
    expect(orders.fetchOrder).not.toHaveBeenCalled();
  });

  it("an owner is offered a form for every event the API's guidance lists, and the order is read with their token", async () => {
    render(await OrderPage(orderProps()));
    expect(orders.fetchOrder).toHaveBeenCalledWith("tok", TENANT, ORDER);
    expect(screen.getByRole("heading", { name: "Order 7" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "I sent the quote" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Cancel this order" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "A payment was received" })).toBeNull(); // the rules did not offer it
    expect(screen.getByText(/guidance: the database decides again/)).toBeInTheDocument();
  });

  it("sales is not offered the cancellation the owner is; the guidance is narrowed to the role", async () => {
    fetchTenant.mockResolvedValue(tenant("sales"));
    render(await OrderPage(orderProps()));
    expect(screen.getByRole("heading", { name: "I sent the quote" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Cancel this order" })).toBeNull();
  });

  it("an admin is not offered a refund", async () => {
    fetchTenant.mockResolvedValue(tenant("admin"));
    orders.fetchOrder.mockResolvedValue(parseOrderDetail({ ...DETAIL_JSON, state: "accepted", allowed_next_events: ["record_payment", "record_refund", "cancel"], paid_paise: 500 }));
    render(await OrderPage(orderProps()));
    expect(screen.getByRole("heading", { name: "A payment was received" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "A refund was given" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Cancel this order" })).toBeNull(); // it carries money: the owner's
  });

  it("without the second factor a money form is a notice, and a plain one is still a form", async () => {
    requireUser.mockResolvedValue({ id: "u", email: "e", accessToken: "tok", aal: "aal1" });
    orders.fetchOrder.mockResolvedValue(parseOrderDetail({ ...DETAIL_JSON, state: "accepted", allowed_next_events: ["request_advance", "record_payment"] }));
    render(await OrderPage(orderProps()));
    expect(screen.getByRole("button", { name: "Record: advance asked for" })).toBeInTheDocument();
    expect(screen.getAllByText(/This needs your authenticator app\./)).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "Record this payment" })).toBeNull();
  });

  it.each([
    ["cancel", "Cancel this order"],
    ["record_refund", "A refund was given"],
    ["record_payment", "A payment was received"],
  ])("without the second factor the owner's %s form is only a notice", async (type, title) => {
    requireUser.mockResolvedValue({ id: "u", email: "e", accessToken: "tok", aal: "aal1" });
    orders.fetchOrder.mockResolvedValue(parseOrderDetail({ ...DETAIL_JSON, state: "accepted", allowed_next_events: [type], paid_paise: 500 }));
    render(await OrderPage(orderProps()));
    expect(screen.getByRole("heading", { name: title })).toBeInTheDocument();
    expect(screen.getByText(/This needs your authenticator app\./)).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("a closed order offers nothing and says so", async () => {
    orders.fetchOrder.mockResolvedValue(parseOrderDetail({ ...DETAIL_JSON, state: "closed_paid", outcome: "won", allowed_next_events: [] }));
    render(await OrderPage(orderProps()));
    expect(screen.getByText("Nothing more can be recorded: this order is closed.")).toBeInTheDocument();
    expect(screen.queryByRole("form")).toBeNull();
  });

  it("when the role has nothing left to record it says who does", async () => {
    fetchTenant.mockResolvedValue(tenant("sales"));
    orders.fetchOrder.mockResolvedValue(parseOrderDetail({ ...DETAIL_JSON, state: "accepted", allowed_next_events: ["record_payment"] }));
    render(await OrderPage(orderProps()));
    expect(screen.getByText(/Nothing is left for your role to record/)).toBeInTheDocument();
  });

  it("works without the member names (a nicety, never a dependency)", async () => {
    orders.fetchMembers.mockRejectedValue(new ApiRequestError(403, "forbidden", "x"));
    render(await OrderPage(orderProps()));
    expect(screen.getByRole("heading", { name: "Order 7" })).toBeInTheDocument();
    expect(screen.getByText(/recorded by A team member/)).toBeInTheDocument();
  });

  it("an unknown order and another workspace's are the same not-found; a malformed id too", async () => {
    orders.fetchOrder.mockRejectedValue(new ApiRequestError(404, "not_found", "x"));
    await expect(OrderPage(orderProps())).rejects.toThrow("not found");
    await expect(OrderPage(orderProps("not-a-uuid"))).rejects.toThrow("not found");
    await expect(OrderPage(orderProps(ORDER, "nope"))).rejects.toThrow("not found");
    fetchTenant.mockRejectedValue(new ApiRequestError(404, "not_found", "x"));
    await expect(OrderPage(orderProps())).rejects.toThrow("not found");
  });

  it("a rejected session goes to sign-in and an outage is said plainly", async () => {
    orders.fetchOrder.mockRejectedValue(new ApiAuthError("no"));
    expect(await redirectTarget(() => OrderPage(orderProps()))).toBe("/login");
    orders.fetchOrder.mockRejectedValue(new ApiRequestError(503, "api_unreachable", "x"));
    render(await OrderPage(orderProps()));
    expect(screen.getByRole("alert")).toHaveTextContent("Could not load this from the API.");
  });
});
