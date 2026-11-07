import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ user: vi.fn(), tenant: vi.fn(), put: vi.fn(), revalidate: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireUser: () => h.user() }));
vi.mock("@/lib/api/client", async (orig) => ({ ...(await orig<typeof import("@/lib/api/client")>()), fetchTenant: (...a: unknown[]) => h.tenant(...a) }));
vi.mock("@/lib/api/catalogue", async (orig) => ({ ...(await orig<typeof import("@/lib/api/catalogue")>()), putQuantity: (...a: unknown[]) => h.put(...a) }));
vi.mock("next/cache", () => ({ revalidatePath: (...a: unknown[]) => h.revalidate(...a) }));
vi.mock("next/navigation", () => ({ redirect: (to: string) => { throw new Error(`redirect:${to}`); } }));

import { ApiAuthError, ApiRequestError } from "@/lib/api/client";

import { setStockCountAction } from "./stock-actions";

/** app v4 part 6: "2 left": the Owner and an Admin set the count (or stop counting); Sales and Viewers do not. */
const T = "66666666-6666-4666-8666-666666666666";
const I = "ca000000-0000-4000-8000-0000000000e1";
beforeEach(() => {
  vi.stubEnv("APP_V4", "1");
  h.user.mockReset().mockResolvedValue({ accessToken: "tok" });
  h.tenant.mockReset().mockResolvedValue({ role: "owner" });
  h.put.mockReset().mockResolvedValue(undefined);
  h.revalidate.mockReset();
});

describe("set the stock count", () => {
  it("the Owner and an Admin; the count or null; the catalogue is drawn again", async () => {
    expect(await setStockCountAction(T, I, 2)).toEqual({ ok: true, quantity: 2 });
    expect(h.put).toHaveBeenCalledWith("tok", T, I, 2);
    expect(h.revalidate).toHaveBeenCalledWith(`/app/tenants/${T}/catalogue`);
    h.tenant.mockResolvedValue({ role: "admin" });
    expect(await setStockCountAction(T, I, null)).toEqual({ ok: true, quantity: null });
    expect(h.put).toHaveBeenLastCalledWith("tok", T, I, null);
  });
  it("refuses Sales and a Viewer, a count that is not a whole number in range, other ids and a server without app v4, before asking the API", async () => {
    h.put.mockClear();
    for (const role of ["sales", "viewer"]) {
      h.tenant.mockResolvedValue({ role });
      expect(await setStockCountAction(T, I, 2)).toEqual({ ok: false, error: "forbidden" });
    }
    h.tenant.mockResolvedValue({ role: "owner" });
    for (const q of ["2", 1.5, -1, 1_000_001, undefined, Number.NaN]) expect(await setStockCountAction(T, I, q)).toEqual({ ok: false, error: "invalid" });
    expect(await setStockCountAction("x", I, 2)).toEqual({ ok: false, error: "invalid" });
    expect(await setStockCountAction(T, "../x", 2)).toEqual({ ok: false, error: "invalid" });
    vi.stubEnv("APP_V4", "");
    expect(await setStockCountAction(T, I, 2)).toEqual({ ok: false, error: "not_available" });
    expect(h.put).not.toHaveBeenCalled();
  });
  it("says the API's refusals in closed words; a lapsed sign-in goes to sign in", async () => {
    h.put.mockRejectedValueOnce(new ApiRequestError(404, "not_found", "x"));
    expect(await setStockCountAction(T, I, 2)).toEqual({ ok: false, error: "gone" });
    h.put.mockRejectedValueOnce(new ApiRequestError(422, "validation_error", "x"));
    expect(await setStockCountAction(T, I, 2)).toEqual({ ok: false, error: "invalid" });
    h.put.mockRejectedValueOnce(new ApiRequestError(403, "forbidden", "x"));
    expect(await setStockCountAction(T, I, 2)).toEqual({ ok: false, error: "forbidden" });
    h.put.mockRejectedValueOnce(new ApiRequestError(503, "down", "x"));
    expect(await setStockCountAction(T, I, 2)).toEqual({ ok: false, error: "down" });
    h.put.mockRejectedValueOnce(new ApiAuthError("out"));
    await expect(setStockCountAction(T, I, 2)).rejects.toThrow("redirect:/login");
  });
});
