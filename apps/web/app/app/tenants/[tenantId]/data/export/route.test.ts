import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiRequestError } from "@/lib/api/client";

const T = "11111111-1111-4111-8111-111111111111";
const ID = "44444444-4444-4444-8444-444444444444";
const h = vi.hoisted(() => ({ user: null as null | { accessToken: string }, download: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (to: string) => { throw new Error(`NEXT_REDIRECT:${to}`); } }));
vi.mock("@/lib/auth/session", () => ({
  requireUser: async () => {
    if (!h.user) throw new Error("NEXT_REDIRECT:/login");
    return h.user;
  },
}));
vi.mock("@/lib/api/client", async (orig) => ({ ...(await orig<typeof import("@/lib/api/client")>()), apiDownloadRequest: (...a: unknown[]) => h.download(...a) }));

import { POST } from "./route";

const HOST = "app.example.test";
const SAME = { host: HOST, "sec-fetch-site": "same-origin", "content-type": "application/json" };
const GOOD = { export_id: ID, format: "tally_zip", from_date: "2026-09-01", to_date: "2026-09-30" };
function post(body: unknown, headers: Record<string, string> = SAME) {
  return POST(new NextRequest(`https://${HOST}/app/tenants/${T}/data/export`, { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body), headers }), { params: Promise.resolve({ tenantId: T }) });
}

beforeEach(() => {
  h.user = { accessToken: "person-token" };
  h.download.mockReset().mockResolvedValue({ bytes: new Uint8Array([80, 75]).buffer, contentType: "application/zip", filename: "accounts.zip", headers: { "x-export-sales": "3", "x-export-payments": "1" } });
});

describe("POST data/export", () => {
  it("asks the API for the file with the person's own token and hands the bytes on as a download", async () => {
    const r = await post(GOOD);
    expect(r.status).toBe(200);
    expect(new Uint8Array(await r.arrayBuffer())).toEqual(new Uint8Array([80, 75]));
    expect(r.headers.get("content-disposition")).toBe('attachment; filename="accounts.zip"');
    expect(r.headers.get("content-type")).toBe("application/zip");
    expect(r.headers.get("x-export-sales")).toBe("3");
    expect(r.headers.get("x-content-type-options")).toBe("nosniff");
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect(h.download).toHaveBeenCalledWith(`/v1/tenants/${T}/exports/accounting`, "person-token", GOOD);
  });
  it("sends only the four known fields on, even if more come in", async () => {
    await post({ ...GOOD, tenant_id: "other", extra: 1 });
    expect(h.download.mock.calls[0][2]).toEqual(GOOD);
  });
  it.each([
    ["an export id that is not a uuid", { ...GOOD, export_id: "x" }],
    ["a format we do not offer", { ...GOOD, format: "pdf" }],
    ["a date that is not a day", { ...GOOD, from_date: "yesterday" }],
    ["a missing date", { ...GOOD, to_date: undefined }],
    ["a body that is not JSON", "{{"],
  ])("refuses %s with 400 and asks the API nothing", async (_n, body) => {
    expect((await post(body)).status).toBe(400);
    expect(h.download).not.toHaveBeenCalled();
  });
  it("refuses another site (403) and an unsigned person (401)", async () => {
    expect((await post(GOOD, { host: HOST, "sec-fetch-site": "cross-site" })).status).toBe(403);
    h.user = null;
    expect((await post(GOOD)).status).toBe(401);
    expect(h.download).not.toHaveBeenCalled();
  });
  it("does not trust the type or the file name the API sent: an odd type is a plain download, an odd name is dropped", async () => {
    h.download.mockResolvedValue({ bytes: new ArrayBuffer(1), contentType: "text/html<script>", filename: null, headers: {} });
    const r = await post(GOOD);
    expect(r.headers.get("content-type")).toBe("application/octet-stream");
    expect(r.headers.get("content-disposition")).toBeNull();
  });
  it.each([
    [new ApiRequestError(403, "mfa_required", "x"), 403, "mfa"],
    [new ApiRequestError(422, "export_too_large", "x"), 422, "invalid"],
    [new ApiRequestError(429, "rate_limited", "x", undefined, undefined, 7), 429, "rate_limited"],
  ])("a refusal (%j) is our JSON shape, status %i", async (error, status, kind) => {
    h.download.mockRejectedValue(error);
    const r = await post(GOOD);
    expect(r.status).toBe(status);
    expect(await r.json()).toMatchObject({ ok: false, kind });
  });
});
