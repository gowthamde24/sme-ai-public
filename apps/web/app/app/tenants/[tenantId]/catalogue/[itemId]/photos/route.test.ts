import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiAuthError, ApiRequestError } from "@/lib/api/client";
import { parsePhotoResult } from "@/lib/api/catalogue";
import { ITEM_A, NEW_PHOTO, PHOTO_A1, itemJson, photoJson } from "@/lib/api/catalogue-fixtures";

const requireUser = vi.fn();
const uploadCataloguePhoto = vi.fn();
vi.mock("@/lib/auth/session", () => ({ requireUser: () => requireUser() }));
vi.mock("@/lib/api/catalogue", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/api/catalogue")>()), uploadCataloguePhoto: (...a: unknown[]) => uploadCataloguePhoto(...a) }));

import { POST } from "./route";

const T = "22222222-2222-4222-8222-222222222222";
const URL_ = `http://localhost/app/tenants/${T}/catalogue/${ITEM_A}/photos?photo_id=${NEW_PHOTO}`;
const ctx = { params: Promise.resolve({ tenantId: T, itemId: ITEM_A }) };
const bytes = new Uint8Array([1, 2, 3, 4]);
const call = (over: { url?: string; headers?: Record<string, string>; body?: BodyInit | null } = {}) => {
  const req = new Request(over.url ?? URL_, { method: "POST", headers: { "content-type": "image/jpeg", "sec-fetch-site": "same-origin", ...(over.headers ?? {}) }, body: over.body === undefined ? bytes : over.body });
  return POST(Object.assign(req, { nextUrl: new URL(over.url ?? URL_) }) as never, ctx);
};
const json = async (r: Response) => (await r.json()) as Record<string, unknown>;
const result = parsePhotoResult({ photo: photoJson(NEW_PHOTO, 4), replayed: false, item: itemJson({}, [photoJson(PHOTO_A1, 1), photoJson(NEW_PHOTO, 2)]) });

beforeEach(() => {
  vi.clearAllMocks();
  requireUser.mockResolvedValue({ accessToken: "secret-access-token" });
  uploadCataloguePhoto.mockResolvedValue(result);
});

describe("the photo upload route", () => {
  it("passes the bytes on with the person's own token and the photo's own type, and answers with the photo and the saree's photos", async () => {
    const r = await call();
    expect(r.status).toBe(200);
    expect(r.headers.get("cache-control")).toBe("no-store");
    const [token, tenant, item, photo, body, type] = uploadCataloguePhoto.mock.calls[0];
    expect([token, tenant, item, photo, type]).toEqual(["secret-access-token", T, ITEM_A, NEW_PHOTO, "image/jpeg"]);
    expect(new Uint8Array(body as ArrayBuffer)).toEqual(bytes);
    const out = await json(r);
    expect(out.ok).toBe(true);
    expect((out.photos as unknown[]).length).toBe(2);
    expect(JSON.stringify(out)).not.toContain("secret-access-token");
  });

  it.each(["image/png", "image/webp", "IMAGE/JPEG; charset=x"])("accepts %s", async (type) => {
    expect((await call({ headers: { "content-type": type } })).status).toBe(200);
  });

  it("refuses a request that did not come from this site, before it looks at the session or the bytes", async () => {
    const r = await call({ headers: { "sec-fetch-site": "cross-site", origin: "https://evil.example", host: "localhost" } });
    expect(r.status).toBe(403);
    expect(requireUser).not.toHaveBeenCalled();
    expect(uploadCataloguePhoto).not.toHaveBeenCalled();
  });

  it("accepts the Origin header of this very host when the browser sends no fetch metadata", async () => {
    const r = await call({ headers: { "sec-fetch-site": "", origin: "http://localhost", host: "localhost" } });
    expect(r.status).toBe(200);
  });

  it.each(["image/gif", "text/html", "application/json", "application/octet-stream", ""])("refuses a type that is not a photo (%s) with 415 and the API's code", async (type) => {
    const r = await call({ headers: { "content-type": type } });
    expect(r.status).toBe(415);
    expect(await json(r)).toEqual({ ok: false, code: "photo_type_unsupported" });
    expect(uploadCataloguePhoto).not.toHaveBeenCalled();
  });

  it("refuses a photo that says it is bigger than 5 MB before reading it, and an empty body", async () => {
    const big = await call({ headers: { "content-length": String(6 * 1024 * 1024) } });
    expect(big.status).toBe(413);
    expect(await json(big)).toEqual({ ok: false, code: "photo_too_large" });
    const empty = await call({ body: new Uint8Array(0) });
    expect(empty.status).toBe(422);
    expect(uploadCataloguePhoto).not.toHaveBeenCalled();
  });

  it("refuses ids that are not uuids as 'not found', and a missing photo id", async () => {
    expect((await call({ url: `http://localhost/x?photo_id=nope` })).status).toBe(404);
    expect((await call({ url: `http://localhost/x` })).status).toBe(404);
    expect((await POST(Object.assign(new Request(URL_, { method: "POST" }), { nextUrl: new URL(URL_) }) as never, { params: Promise.resolve({ tenantId: "x", itemId: ITEM_A }) })).status).toBe(404);
  });

  it("a signed-out request gets 401 as plain JSON (a fetch cannot follow the sign-in redirect)", async () => {
    requireUser.mockRejectedValue(new Error("NEXT_REDIRECT"));
    const r = await call();
    expect(r.status).toBe(401);
    expect(await json(r)).toEqual({ ok: false, code: "unauthorized" });
  });

  it("answers with the API's status and CLOSED code only, never its text", async () => {
    uploadCataloguePhoto.mockRejectedValue(new ApiRequestError(422, "photo_animated", "an English sentence that must stay on the server"));
    const r = await call();
    expect(r.status).toBe(422);
    const out = await json(r);
    expect(out).toEqual({ ok: false, code: "photo_animated" });
  });

  it.each([
    [new ApiRequestError(403, "mfa_required", "x"), 403, "mfa_required"],
    [new ApiRequestError(409, "too_many_photos", "x"), 409, "too_many_photos"],
    [new ApiRequestError(503, "catalogue_unavailable", "x"), 503, "catalogue_unavailable"],
    [new ApiRequestError(200, "weird code!", "x"), 502, "http_error"],
    [new ApiAuthError("x"), 401, "unauthorized"],
    [new Error("the answer broke the contract"), 502, "bad_answer"],
  ])("maps %s to %s %s", async (error, status, code) => {
    uploadCataloguePhoto.mockRejectedValue(error);
    const r = await call();
    expect(r.status).toBe(status);
    expect((await json(r)).code).toBe(code);
  });
});
