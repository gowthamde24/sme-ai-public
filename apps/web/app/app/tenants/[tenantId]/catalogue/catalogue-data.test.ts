import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiAuthError, ApiRequestError } from "@/lib/api/client";
import { parseItemPage } from "@/lib/api/catalogue";
import { SUMMARIES, pageJson } from "@/lib/api/catalogue-fixtures";
import { EMPTY_QUERY, parseQuery } from "@/components/v2/app/catalogue/catalogue-logic";

const listCatalogueItems = vi.fn();
vi.mock("@/lib/api/catalogue", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/api/catalogue")>()), listCatalogueItems: (...a: unknown[]) => listCatalogueItems(...a) }));

import { readCatalogue } from "./catalogue-data";

const T = "22222222-2222-4222-8222-222222222222";
const page = (items: Record<string, unknown>[], next: string | null) => parseItemPage(pageJson(items, next));
const row = (i: number, over: Record<string, unknown> = {}) => ({ ...SUMMARIES[0], id: `5a1c0d62-3b2e-4a8e-9e31-${String(i).padStart(12, "0")}`, name: `Saree ${i}`, ...over });
beforeEach(() => vi.resetAllMocks());

describe("reading the catalogue list", () => {
  it("one request of 24 when the API can do all the filtering, with the API's words, and the cursor handed back", async () => {
    listCatalogueItems.mockResolvedValue(page([row(1), row(2)], "NEXT"));
    const out = await readCatalogue("tok", T, parseQuery({ fabric: "soft_silk", colour: "red", stock: "available" }), false, null);
    expect(listCatalogueItems).toHaveBeenCalledTimes(1);
    expect(listCatalogueItems).toHaveBeenCalledWith("tok", T, { fabric: "soft_silk", colours: ["red"], inStock: true, after: null, limit: 24 });
    expect(out.items?.map((i) => i.name)).toEqual(["Saree 1", "Saree 2"]);
    expect(out.more).toBe("NEXT");
  });

  it("asks for the hidden ones only for owner and admin", async () => {
    listCatalogueItems.mockResolvedValue(page([], null));
    await readCatalogue("tok", T, EMPTY_QUERY, true, null);
    expect(listCatalogueItems.mock.calls[0][2]).toMatchObject({ includeInactive: true });
    await readCatalogue("tok", T, EMPTY_QUERY, false, null);
    expect(listCatalogueItems.mock.calls[1][2]).not.toHaveProperty("includeInactive");
  });

  it("carries on from a cursor, and refuses a cursor that is absurdly long", async () => {
    listCatalogueItems.mockResolvedValue(page([], null));
    await readCatalogue("tok", T, EMPTY_QUERY, false, "ABC");
    expect(listCatalogueItems.mock.calls[0][2].after).toBe("ABC");
    await readCatalogue("tok", T, EMPTY_QUERY, false, "x".repeat(401));
    expect(listCatalogueItems.mock.calls[1][2].after).toBeNull();
  });

  it("a name search reads on, page after page of 50, until a screenful matches or the end; and counts only what matches", async () => {
    listCatalogueItems
      .mockResolvedValueOnce(page(Array.from({ length: 50 }, (_, i) => row(i, { name: i % 10 === 0 ? `Blue ${i}` : `Red ${i}` })), "P2"))
      .mockResolvedValueOnce(page(Array.from({ length: 50 }, (_, i) => row(100 + i, { name: `Blue ${i}` })), "P3"))
      .mockResolvedValueOnce(page([row(999)], null));
    const out = await readCatalogue("tok", T, parseQuery({ q: "blue" }), false, null);
    expect(listCatalogueItems.mock.calls.map((c) => [c[2].limit, c[2].after])).toEqual([[50, null], [50, "P2"]]);
    expect(out.items).toHaveLength(55); // 5 + 50: enough for a screen (24), so it stops reading
    expect(out.more).toBe("P3");
  });

  it("never reads more than 200 items for one screen, even if nothing matches; 'more' lets the person carry on", async () => {
    listCatalogueItems.mockImplementation(async () => page(Array.from({ length: 50 }, (_, i) => row(i)), "MORE"));
    const out = await readCatalogue("tok", T, parseQuery({ q: "zzz" }), false, null);
    expect(listCatalogueItems).toHaveBeenCalledTimes(4);
    expect(out.items).toEqual([]);
    expect(out.more).toBe("MORE");
  });

  it("'few left' and 'made to order' are picked from what was read", async () => {
    listCatalogueItems.mockResolvedValue(page(SUMMARIES, null));
    expect((await readCatalogue("tok", T, parseQuery({ stock: "made_to_order" }), true, null)).items?.map((i) => i.stock_status)).toEqual(["made_to_order"]);
    expect(listCatalogueItems.mock.calls[0][2]).toMatchObject({ limit: 50, includeInactive: true });
    expect(listCatalogueItems.mock.calls[0][2]).not.toHaveProperty("inStock");
  });

  it("a read that fails is 'could not be read' (null), not an empty catalogue; a rejected session is thrown on", async () => {
    listCatalogueItems.mockRejectedValue(new ApiRequestError(503, "catalogue_unavailable", "x"));
    expect(await readCatalogue("tok", T, EMPTY_QUERY, false, null)).toEqual({ items: null, more: null });
    listCatalogueItems.mockRejectedValue(new Error("contract"));
    expect(await readCatalogue("tok", T, EMPTY_QUERY, false, null)).toEqual({ items: null, more: null });
    listCatalogueItems.mockRejectedValue(new ApiAuthError("x"));
    await expect(readCatalogue("tok", T, EMPTY_QUERY, false, null)).rejects.toBeInstanceOf(ApiAuthError);
  });
});
