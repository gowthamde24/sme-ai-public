import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { wordsFor } from "@/i18n/app-words";
import { ApiAuthError, ApiRequestError } from "@/lib/api/client";
import type { LoadedPriceList } from "@/lib/api/pricelists";
import { redirectMock, redirectTarget } from "@/test/helpers";

const fetchLoaded = vi.fn();
vi.mock("next/navigation", () => ({ redirect: (to: string) => redirectMock(to) }));
vi.mock("@/lib/api/pricelists", async (orig) => ({ ...(await orig<typeof import("@/lib/api/pricelists")>()), fetchLoadedPriceList: (...a: unknown[]) => fetchLoaded(...a) }));

import { LoadedPriceListSection } from "./loaded-price-list";

const T = "22222222-2222-4222-8222-222222222222";
const WORDS = wordsFor("en", ["pl."], ["nav.item.catalogue"]);
const row = (n: number) => ({ sku: `SAREE-00${n}`, name: `Maroon Kanchi pattu ${n}`, sale_unit: "piece", unit_price_paise: 3850000 + n * 100, minimum_order_quantity: 1, tax_bps: 500 });
const loaded = (over: Partial<LoadedPriceList> = {}): LoadedPriceList => ({ current: { version_no: 2, effective_from: "2026-11-13", item_count: 7, sample: [row(1), row(2)] }, upcoming: null, ...over });
const show = async () => render(await LoadedPriceListSection({ accessToken: "tok", tenantId: T, words: WORDS }));

beforeEach(() => {
  vi.clearAllMocks();
  fetchLoaded.mockResolvedValue(loaded());
});

describe("Your price list now (the loaded price list on the Price lists page)", () => {
  it("says which version is in force, the day it starts and how many products, with the first rows in rupees and GST in percent", async () => {
    await show();
    expect(fetchLoaded).toHaveBeenCalledWith("tok", T);
    expect(screen.getByRole("heading", { level: 2, name: "Your price list now" })).toBeInTheDocument();
    expect(screen.getByText("Version 2 · starts 13 Nov 2026 · 7 products")).toBeInTheDocument();
    const table = screen.getByRole("table", { name: "Your price list now" });
    expect(within(table).getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["Name", "Code", "Unit", "Price", "Smallest order", "GST"]);
    const first = within(table).getByText("Maroon Kanchi pattu 1").closest("tr") as HTMLElement;
    expect(within(first).getAllByRole("cell").map((c) => c.textContent)).toEqual(["SAREE-001", "piece", "₹38,501.00", "1", "5%"]);
    expect(within(first).getAllByRole("cell").map((c) => c.getAttribute("data-label"))).toEqual(["Code", "Unit", "Price", "Smallest order", "GST"]); // a phone shows each cell with its name
    expect(screen.getByText("Showing the first 2 of 7.")).toBeInTheDocument();
  });
  it("no sample note when every product is shown; a later version waiting is named", async () => {
    fetchLoaded.mockResolvedValue(loaded({ current: { version_no: 3, effective_from: "2026-11-13", item_count: 2, sample: [row(1), row(2)] }, upcoming: { version_no: 4, effective_from: "2026-12-01", item_count: 9 } }));
    await show();
    expect(screen.queryByText(/Showing the first/)).toBeNull();
    expect(screen.getByText("Next: version 4 starts 1 Dec 2026 · 9 products")).toBeInTheDocument();
  });
  it("a workspace that has loaded nothing says so, and where to load one", async () => {
    fetchLoaded.mockResolvedValue({ current: null, upcoming: null });
    await show();
    expect(screen.getByText("No price list is loaded yet. Load one below.")).toBeInTheDocument();
    expect(screen.queryByRole("table")).toBeNull();
  });
  it("a list that cannot be read says so in one sentence, never the API's words", async () => {
    fetchLoaded.mockRejectedValue(new ApiRequestError(500, "boom", "CANARY-9z"));
    const { container } = await show();
    expect(screen.getByRole("alert")).toHaveTextContent("Your loaded price list cannot be shown right now.");
    expect(container.textContent).not.toContain("CANARY");
  });
  it("an expired session goes to sign-in", async () => {
    fetchLoaded.mockRejectedValue(new ApiAuthError("x"));
    expect(await redirectTarget(async () => { render(await LoadedPriceListSection({ accessToken: "tok", tenantId: T, words: WORDS })); })).toBe("/login");
  });
});
