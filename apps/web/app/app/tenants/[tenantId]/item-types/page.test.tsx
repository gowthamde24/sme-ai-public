import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiAuthError, ApiRequestError } from "@/lib/api/client";
import { parseItemTypes } from "@/lib/api/item-types";
import { TYPE_A_JSON, TYPE_B_JSON, TYPE_C_JSON } from "@/lib/api/quotes-fixtures";
import { NotFoundSignal, isNotFound, notFoundMock, redirectMock, redirectTarget } from "@/test/helpers";

const requireUser = vi.fn();
const fetchTenant = vi.fn();
const fetchItemTypes = vi.fn();

vi.mock("next/navigation", () => ({ redirect: (to: string) => redirectMock(to), notFound: () => notFoundMock() }));
vi.mock("@/lib/auth/session", () => ({ requireUser: () => requireUser() }));
vi.mock("@/lib/api/client", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/api/client")>()), fetchTenant: (...a: unknown[]) => fetchTenant(...a) }));
vi.mock("@/lib/api/item-types", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/api/item-types")>()), fetchItemTypes: (...a: unknown[]) => fetchItemTypes(...a) }));
vi.mock("./item-types-actions", () => ({ addItemTypeAction: vi.fn(async () => undefined), saveItemTypeAction: vi.fn(async () => undefined) }));

import ItemTypesPage from "./page";

const T = "22222222-2222-4222-8222-222222222222";
const USER = { id: "u", email: "e@example.test", accessToken: "tok", aal: "aal2" };
const props = (tenantId = T) => ({ params: Promise.resolve({ tenantId }) }) as unknown as Parameters<typeof ItemTypesPage>[0];
const tenant = (role: string) => ({ id: T, name: "Acme", slug: "acme", role });

beforeEach(() => {
  vi.clearAllMocks();
  requireUser.mockResolvedValue(USER);
  fetchTenant.mockResolvedValue(tenant("owner"));
  fetchItemTypes.mockResolvedValue(parseItemTypes([TYPE_B_JSON, TYPE_C_JSON, TYPE_A_JSON]));
});

/** The data rows of the item types table, in the order shown (the header row and the edit-form rows are not among them). */
const typeRows = () => screen.getAllByRole("rowheader").map((h) => h.closest("tr") as HTMLElement);

async function show(role: string, aal = "aal2") {
  fetchTenant.mockResolvedValue(tenant(role));
  requireUser.mockResolvedValue({ ...USER, aal });
  render(await ItemTypesPage(props()));
}

describe("/app/tenants/[tenantId]/item-types", () => {
  it("asks who the user is first, and reads the list with their own token", async () => {
    await show("owner");
    expect(requireUser).toHaveBeenCalled();
    expect(fetchItemTypes).toHaveBeenCalledWith("tok", T);
  });
  it("lists every item type in the owner's order with its name, code, switch and prices in rupees", async () => {
    await show("owner");
    const items = typeRows().map((tr) => tr.textContent ?? "");
    expect(items).toHaveLength(3);
    expect(items[0]).toContain("Type C (not sold)");
    expect(items[1]).toContain("Type A");
    expect(items[2]).toContain("Type B");
    expect(items[0]).toContain("No, switched off");
    expect(items[2]).toContain("₹500.00");
    expect(items[2]).toContain("₹4,000.00");
    expect(items[1]).toContain("none");
  });
  it("shows the types as one table with a column for each fact, and each cell says which fact it is", async () => {
    await show("owner");
    const table = screen.getByRole("table", { name: "Item types, in order" });
    const heads = within(table).getAllByRole("columnheader").map((h) => h.textContent);
    expect(heads).toEqual(["Name", "Code", "Can be used", "Position", "Lowest price", "Highest price", "Edit"]);
    const b = typeRows()[2];
    expect(within(b).getByRole("rowheader")).toHaveTextContent("Type B");
    expect(within(b).getAllByRole("cell").map((c) => c.getAttribute("data-label"))).toEqual(["Code", "Can be used", "Position", "Lowest price", "Highest price", null]);
    expect(within(b).getAllByRole("cell").slice(0, 5).map((c) => c.textContent)).toEqual(["B", "Yes", "2", "₹500.00", "₹4,000.00"]);
  });
  it("puts each edit control in the row of its type, and its form in the row under it", async () => {
    await show("owner");
    const [c, a] = typeRows();
    expect(within(c).getByText("Edit Type C (not sold)")).toBeInTheDocument();
    expect(within(a).getByText("Edit Type A")).toBeInTheDocument();
    const form = (a.nextElementSibling as HTMLElement).querySelector("form");
    expect(form).not.toBeNull();
    expect(within(form as HTMLElement).getByLabelText("Name")).toHaveValue("Type A");
  });
  it("says in plain words that a price outside the range only warns and never stops a quote", async () => {
    await show("owner");
    expect(screen.getByText("A price outside the lowest and highest price only gives a warning when a quote is made. It never stops a quote.")).toBeInTheDocument();
  });
  it.each(["owner", "admin"])("a %s with the authenticator app gets the add form and an edit control for every type", async (role) => {
    await show(role);
    expect(screen.getByRole("heading", { name: "Add an item type" })).toBeInTheDocument();
    expect(screen.getAllByText(/^Edit Type/)).toHaveLength(3);
    expect(screen.getAllByRole("button", { name: "Save changes" })).toHaveLength(3);
    expect(screen.getByText(/typed once and can never be changed/)).toBeInTheDocument();
  });
  it.each(["owner", "admin"])("a %s without the authenticator app sees the list, one sentence with the link, and NO control", async (role) => {
    await show(role, "aal1");
    expect(typeRows()).toHaveLength(3);
    expect(screen.queryByRole("columnheader", { name: "Edit" })).toBeNull();
    expect(screen.getByText(/needs your authenticator app/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Security page/ })).toHaveAttribute("href", "/app/security");
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByRole("heading", { name: "Add an item type" })).toBeNull();
  });
  it("a sales user reads the list and is offered no edit control at all", async () => {
    await show("sales");
    expect(typeRows()).toHaveLength(3);
    expect(screen.getAllByRole("row")).toHaveLength(4); // the header and the three types: no edit-form row either
    expect(screen.queryByRole("columnheader", { name: "Edit" })).toBeNull();
    expect(document.querySelector("details, summary, form, .edit-row")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.queryByText(/^Edit /)).toBeNull();
    expect(screen.queryByRole("heading", { name: "Add an item type" })).toBeNull();
    expect(screen.getByText("Only an owner or an admin can add or change item types.")).toBeInTheDocument();
  });
  it("a viewer gets one plain sentence and nothing is asked of the API", async () => {
    await show("viewer");
    expect(screen.getByText("Item types are shown to owners, admins and sales users.")).toBeInTheDocument();
    expect(fetchItemTypes).not.toHaveBeenCalled();
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
    expect(document.querySelector("details, summary, form")).toBeNull();
  });
  it("an empty workspace says so, and offers the first add to a writer only", async () => {
    fetchItemTypes.mockResolvedValue([]);
    await show("owner");
    expect(screen.getByText(/No item types yet\. Add the first one below\./)).toBeInTheDocument();
    document.body.innerHTML = "";
    await show("sales");
    expect(screen.getByText("No item types yet.")).toBeInTheDocument();
  });
  it("uses no jargon on the page", async () => {
    await show("owner");
    expect(document.body.textContent).not.toMatch(/aal2|SKU|basis point|\bbps\b|paise/i);
  });
  it("an unknown or malformed workspace is the same not-found page", async () => {
    expect(await isNotFound(async () => { render(await ItemTypesPage(props("not-a-uuid"))); })).toBe(true);
    fetchTenant.mockRejectedValue(new ApiRequestError(404, "not_found", "x"));
    expect(await isNotFound(async () => { render(await ItemTypesPage(props())); })).toBe(true);
    expect(NotFoundSignal).toBeDefined();
  });
  it("an expired session goes to the login page; a failing list shows the API-down page", async () => {
    fetchTenant.mockRejectedValue(new ApiAuthError("expired"));
    expect(await redirectTarget(async () => { render(await ItemTypesPage(props())); })).toBe("/login");
    fetchTenant.mockResolvedValue(tenant("owner"));
    fetchItemTypes.mockRejectedValue(new ApiRequestError(503, "quotes_unavailable", "x"));
    render(await ItemTypesPage(props()));
    expect(screen.getByText(/Could not load this from the API/)).toBeInTheDocument();
  });
});
