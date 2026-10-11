import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiAuthError, ApiRequestError } from "@/lib/api/client";
import { parseItem, parseItemPage } from "@/lib/api/catalogue";
import { ITEM_A, ITEM_HIDDEN, SUMMARIES, itemJson, pageJson, photoJson } from "@/lib/api/catalogue-fixtures";
import { NotFoundSignal, RedirectError, notFoundMock, redirectMock } from "@/test/helpers";

const requireUser = vi.fn();
const fetchTenant = vi.fn();
const listCatalogueItems = vi.fn();
const getCatalogueItem = vi.fn();
const readLeadLabel = vi.fn();
vi.mock("next/navigation", () => ({ redirect: (to: string) => redirectMock(to), notFound: () => notFoundMock(), useRouter: () => ({ refresh: () => undefined, push: () => undefined }) }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/auth/session", () => ({ requireUser: () => requireUser() }));
vi.mock("@/i18n/get-lang", () => ({ getLang: async () => "en" }));
vi.mock("@/lib/api/client", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/api/client")>()), fetchTenant: (...a: unknown[]) => fetchTenant(...a) }));
vi.mock("@/lib/api/catalogue", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/api/catalogue")>()), listCatalogueItems: (...a: unknown[]) => listCatalogueItems(...a), getCatalogueItem: (...a: unknown[]) => getCatalogueItem(...a) }));
vi.mock("../visits/visits-data", () => ({ readLeadLabel: (...a: unknown[]) => readLeadLabel(...a) }));

import EditPage from "./[itemId]/edit/page";
import ItemPage from "./[itemId]/page";
import NewPage from "./new/page";
import ListPage from "./page";

const T = "22222222-2222-2222-2222-222222222222";
const LEAD = "c5c78ed6-e536-46af-a5c3-872bb2d844a2";
const role = (r: string) => fetchTenant.mockResolvedValue({ id: T, name: "Acme", slug: "acme", role: r });
const listProps = (q: Record<string, string> = {}) => ({ params: Promise.resolve({ tenantId: T }), searchParams: Promise.resolve(q) }) as never;
const itemProps = (itemId: string, q: Record<string, string> = {}) => ({ params: Promise.resolve({ tenantId: T, itemId }), searchParams: Promise.resolve(q) }) as never;
const draw = async (ui: Promise<React.ReactElement> | React.ReactElement) => {
  const el = await ui;
  await act(async () => void render(el));
};

beforeEach(() => {
  vi.resetAllMocks();
  redirectMock.mockImplementation((to: string) => {
    throw new RedirectError(to);
  });
  notFoundMock.mockImplementation((): never => {
    throw new NotFoundSignal();
  });
  requireUser.mockResolvedValue({ id: "u", email: "e@example.test", accessToken: "tok" });
  role("owner");
  listCatalogueItems.mockResolvedValue(parseItemPage(pageJson()));
  getCatalogueItem.mockResolvedValue(parseItem(itemJson()));
  readLeadLabel.mockResolvedValue({ leadId: LEAD, label: "Priya S." });
});
afterEach(cleanup);

describe("the catalogue page", () => {
  it("reads the list with the person's token; owner and admin ask for the hidden sarees too, sales and viewer do not", async () => {
    await draw(ListPage(listProps()));
    expect(listCatalogueItems).toHaveBeenCalledWith("tok", T, expect.objectContaining({ includeInactive: true, limit: 24 }));
    expect(screen.getByText("4 sarees")).toBeInTheDocument();
    for (const r of ["sales", "viewer"]) {
      cleanup();
      listCatalogueItems.mockClear();
      role(r);
      await draw(ListPage(listProps()));
      expect(listCatalogueItems.mock.calls[0][2]).not.toHaveProperty("includeInactive");
    }
  });

  it("turns the address into filters for the API: fabric, colours, bands; the search word is the page's own", async () => {
    await draw(ListPage(listProps({ fabric: "soft_silk", colour: "red,blue", band: "5k_10k", stock: "available", q: "peacock" })));
    expect(listCatalogueItems).toHaveBeenCalledWith("tok", T, expect.objectContaining({ fabric: "soft_silk", colours: ["red", "blue"], priceBands: ["5k_10k"], inStock: true }));
    expect(screen.getByLabelText("Search by name")).toHaveValue("peacock");
  });

  it("reads the customer's name when a saree is being chosen for one; a viewer is not asked (they cannot send)", async () => {
    await draw(ListPage(listProps({ lead: LEAD })));
    expect(readLeadLabel).toHaveBeenCalledWith("tok", T, LEAD);
    expect(screen.getByText(/Choose a saree to send to Priya S\./)).toBeInTheDocument();
    cleanup();
    readLeadLabel.mockClear();
    role("viewer");
    await draw(ListPage(listProps({ lead: LEAD })));
    expect(readLeadLabel).not.toHaveBeenCalled();
  });

  it("an empty catalogue is the owl and 'Add your first saree'; one that cannot be read says so", async () => {
    listCatalogueItems.mockResolvedValue(parseItemPage(pageJson([])));
    await draw(ListPage(listProps()));
    expect(screen.getByText("Add your first saree")).toBeInTheDocument();
    cleanup();
    listCatalogueItems.mockRejectedValue(new ApiRequestError(503, "catalogue_unavailable", "x"));
    await draw(ListPage(listProps()));
    expect(screen.getByText("Not available yet")).toBeInTheDocument();
  });

  it("sends a rejected session to sign-in, a workspace that is not theirs to 'not found', and an API that is down to the plain message", async () => {
    listCatalogueItems.mockRejectedValue(new ApiAuthError("x"));
    await expect(ListPage(listProps())).rejects.toBeInstanceOf(RedirectError);
    fetchTenant.mockRejectedValue(new ApiRequestError(404, "not_found", "x"));
    await expect(ListPage(listProps())).rejects.toBeInstanceOf(NotFoundSignal);
    fetchTenant.mockRejectedValue(new ApiRequestError(503, "api_unreachable", "x"));
    await draw(ListPage(listProps()));
    expect(screen.getByRole("alert")).toHaveTextContent("Could not load this from the API");
    await expect(ListPage({ params: Promise.resolve({ tenantId: "nope" }), searchParams: Promise.resolve({}) } as never)).rejects.toBeInstanceOf(NotFoundSignal);
  });
});

describe("a saree's page", () => {
  it("shows the photos and the details; the owner, admin and sales may send it, a viewer may not", async () => {
    for (const [r, send] of [["owner", true], ["admin", true], ["sales", true], ["viewer", false]] as const) {
      cleanup();
      role(r);
      await draw(ItemPage(itemProps(ITEM_A)));
      expect(screen.getByRole("heading", { level: 1, name: "DEMO Maroon Kanchi pattu" })).toBeInTheDocument();
      expect(screen.queryByRole("heading", { name: "Send to a customer" }) !== null, r).toBe(send);
      expect(screen.queryByRole("link", { name: "Edit this saree" }) !== null, r).toBe(r === "owner" || r === "admin");
    }
  });

  it("a hidden saree is for the owner and admin only: everyone else gets 'not found', as if it did not exist", async () => {
    getCatalogueItem.mockResolvedValue(parseItem(itemJson({ id: ITEM_HIDDEN, active: false }, [photoJson("0f8a927d-5555-4a55-8a55-000000000001", 1)])));
    for (const r of ["sales", "viewer"]) {
      role(r);
      await expect(ItemPage(itemProps(ITEM_HIDDEN)), r).rejects.toBeInstanceOf(NotFoundSignal);
    }
    role("admin");
    await draw(ItemPage(itemProps(ITEM_HIDDEN)));
    expect(screen.getByText(/This saree is hidden/)).toBeInTheDocument();
    expect(screen.getByText("Show this saree to customers before you send it.")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Send to a customer" })).toBeNull();
  });

  it("says it was just saved when the address says so", async () => {
    await draw(ItemPage(itemProps(ITEM_A, { saved: "1" })));
    expect(screen.getByRole("status")).toHaveTextContent("Saved. DEMO Maroon Kanchi pattu is shown to customers.");
  });

  it("chooses the customer when the address names one", async () => {
    await draw(ItemPage(itemProps(ITEM_A, { lead: LEAD })));
    expect(screen.getByText("Sending to Priya S.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /All sarees/ })).toHaveAttribute("href", `/app/tenants/${T}/catalogue?lead=${LEAD}`);
  });

  it("a saree that is not there, or an id that is not an id, is 'not found'; a dead API is the plain message", async () => {
    getCatalogueItem.mockRejectedValue(new ApiRequestError(404, "not_found", "x"));
    await expect(ItemPage(itemProps(ITEM_A))).rejects.toBeInstanceOf(NotFoundSignal);
    getCatalogueItem.mockRejectedValue(new ApiRequestError(422, "invalid_reference", "x"));
    await expect(ItemPage(itemProps(ITEM_A))).rejects.toBeInstanceOf(NotFoundSignal);
    await expect(ItemPage(itemProps("not-an-id"))).rejects.toBeInstanceOf(NotFoundSignal);
    getCatalogueItem.mockRejectedValue(new ApiRequestError(503, "api_unreachable", "x"));
    await draw(ItemPage(itemProps(ITEM_A)));
    expect(screen.getByRole("alert")).toHaveTextContent("Could not load this from the API");
    getCatalogueItem.mockRejectedValue(new ApiAuthError("x"));
    await expect(ItemPage(itemProps(ITEM_A))).rejects.toBeInstanceOf(RedirectError);
  });
});

describe("adding and changing a saree", () => {
  it("the owner and admin get the form; anyone else is sent back to the catalogue", async () => {
    for (const r of ["owner", "admin"]) {
      cleanup();
      role(r);
      await draw(NewPage(listProps()));
      expect(screen.getByRole("heading", { level: 1, name: "Add a saree" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Take a photo" })).toBeInTheDocument();
    }
    for (const r of ["sales", "viewer"]) {
      role(r);
      await expect(NewPage(listProps()), r).rejects.toMatchObject({ to: `/app/tenants/${T}/catalogue` });
    }
  });

  it("a new saree gets its own id from the page, a different one each time", async () => {
    const findUpload = (node: unknown): string | undefined => {
      if (!node || typeof node !== "object") return undefined;
      const el = node as { props?: { uploadUrl?: string; children?: unknown } };
      if (el.props?.uploadUrl) return el.props.uploadUrl;
      const kids = el.props?.children;
      return (Array.isArray(kids) ? kids : [kids]).map(findUpload).find(Boolean);
    };
    const a = findUpload(await NewPage(listProps()));
    const b = findUpload(await NewPage(listProps()));
    expect(a).toMatch(new RegExp(`^/app/tenants/${T}/catalogue/[0-9a-f-]{36}/photos$`));
    expect(a).not.toBe(b);
  });

  it("the edit page starts from the saree; an admin has no price field, the owner has one; sales and viewer are sent to the saree's page", async () => {
    await draw(EditPage(itemProps(ITEM_A)));
    expect(screen.getByLabelText("Name")).toHaveValue("DEMO Maroon Kanchi pattu");
    expect(screen.getByLabelText(/Exact price/)).toBeInTheDocument();
    cleanup();
    role("admin");
    await draw(EditPage(itemProps(ITEM_A)));
    expect(screen.queryByLabelText(/Exact price/)).toBeNull();
    for (const r of ["sales", "viewer"]) {
      role(r);
      await expect(EditPage(itemProps(ITEM_A)), r).rejects.toMatchObject({ to: `/app/tenants/${T}/catalogue/${ITEM_A}` });
    }
    expect(getCatalogueItem).toHaveBeenCalledTimes(2); // the others were sent away before the saree was read
  });

  it("a saree that is not there is 'not found' on the edit page too", async () => {
    getCatalogueItem.mockRejectedValue(new ApiRequestError(404, "not_found", "x"));
    await expect(EditPage(itemProps(ITEM_A))).rejects.toBeInstanceOf(NotFoundSignal);
  });
});
void SUMMARIES;
