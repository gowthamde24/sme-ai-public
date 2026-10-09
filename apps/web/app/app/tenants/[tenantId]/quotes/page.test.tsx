import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiRequestError } from "@/lib/api/client";
import { parseQuoteSummary } from "@/lib/api/quotes";
import { SUMMARY_JSON } from "@/lib/api/quotes-fixtures";
import { notFoundMock, redirectMock } from "@/test/helpers";

const requireUser = vi.fn();
const fetchTenant = vi.fn();
const fetchQuotes = vi.fn();
vi.mock("next/navigation", () => ({ redirect: (to: string) => redirectMock(to), notFound: () => notFoundMock() }));
vi.mock("@/lib/auth/session", () => ({ requireUser: () => requireUser() }));
vi.mock("@/lib/api/client", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/api/client")>()), fetchTenant: (...a: unknown[]) => fetchTenant(...a) }));
vi.mock("@/lib/api/quotes", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/api/quotes")>()), fetchQuotes: (...a: unknown[]) => fetchQuotes(...a) }));

import QuotesPage from "./page";

const TENANT = "22222222-2222-2222-2222-222222222222";
const props = () => ({ params: Promise.resolve({ tenantId: TENANT }) }) as unknown as Parameters<typeof QuotesPage>[0];

beforeEach(() => {
  vi.clearAllMocks();
  requireUser.mockResolvedValue({ id: "user-1", email: "e@example.test", accessToken: "tok" });
  fetchTenant.mockResolvedValue({ id: TENANT, name: "Acme Silks", slug: "acme", role: "owner" });
  fetchQuotes.mockResolvedValue([parseQuoteSummary(SUMMARY_JSON)]);
});

describe("the quotes list", () => {
  it("reads the newest 50 quotes with the person's token and shows each customer's name and city, linked to the enquiry", async () => {
    render(await QuotesPage(props()));
    expect(fetchQuotes).toHaveBeenCalledWith("tok", TENANT, 50);
    const row = within(screen.getAllByRole("row")[1]);
    expect(row.getByText("Synthetic Buyer")).toBeInTheDocument();
    expect(row.getByText("Hyderabad · New customer")).toBeInTheDocument();
    expect(row.getByRole("link", { name: "Quote 3" })).toHaveAttribute("href", `/app/tenants/${TENANT}/enquiries/${SUMMARY_JSON.enquiry_id}?quote=${SUMMARY_JSON.id}`);
  });
  it("a quote whose lead has no company says 'A customer', not a made-up name", async () => {
    fetchQuotes.mockResolvedValue([parseQuoteSummary({ ...SUMMARY_JSON, customer: null, city: null, customer_kind: "repeat" })]);
    render(await QuotesPage(props()));
    expect(screen.getByText("A customer")).toBeInTheDocument();
    expect(screen.getByText("Repeat customer")).toBeInTheDocument();
  });
  it("says so when there are none, and a viewer is not shown the list or asked for it", async () => {
    fetchQuotes.mockResolvedValue([]);
    render(await QuotesPage(props()));
    expect(screen.getByText("No quotes yet.")).toBeInTheDocument();
    document.body.innerHTML = "";
    fetchQuotes.mockClear();
    fetchTenant.mockResolvedValue({ id: TENANT, name: "Acme Silks", slug: "acme", role: "viewer" });
    render(await QuotesPage(props()));
    expect(fetchQuotes).not.toHaveBeenCalled();
  });
  it("shows the page's own error when the API cannot be read", async () => {
    fetchQuotes.mockRejectedValue(new ApiRequestError(503, "api_unreachable", "x"));
    render(await QuotesPage(props()));
    expect(screen.queryByRole("table")).toBeNull();
  });
});
