import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiAuthError, ApiRequestError } from "@/lib/api/client";

const T = "11111111-1111-4111-8111-111111111111";
const JOB = "33333333-3333-4333-8333-333333333333";
const h = vi.hoisted(() => ({ user: null as null | { accessToken: string }, inspect: vi.fn(), preview: vi.fn(), confirm: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (to: string) => { throw new Error(`NEXT_REDIRECT:${to}`); } }));
vi.mock("@/lib/auth/session", () => ({
  requireUser: async () => {
    if (!h.user) throw new Error("NEXT_REDIRECT:/login");
    return h.user;
  },
}));
vi.mock("@/lib/api/data", async (orig) => ({
  ...(await orig<typeof import("@/lib/api/data")>()),
  inspectSpreadsheet: (...a: unknown[]) => h.inspect(...a),
  previewSpreadsheet: (...a: unknown[]) => h.preview(...a),
  confirmSpreadsheet: (...a: unknown[]) => h.confirm(...a),
}));

import { POST } from "./route";

const HOST = "app.example.test";
const SAME = { host: HOST, "sec-fetch-site": "same-origin", "content-type": "text/csv" };
function post(step: string, query = "", body: BodyInit = "name,phone\nRavi,98765", headers: Record<string, string> = SAME, tenant = T) {
  return POST(new NextRequest(`https://${HOST}/app/tenants/${tenant}/data/import/${step}${query}`, { method: "POST", body, headers }), { params: Promise.resolve({ tenantId: tenant, step }) });
}

beforeEach(() => {
  h.user = { accessToken: "person-token" };
  h.inspect.mockReset().mockResolvedValue({ kind: "customers" });
  h.preview.mockReset().mockResolvedValue({ job_id: JOB });
  h.confirm.mockReset().mockResolvedValue({ replay: false });
});

describe("POST data/import/<step>", () => {
  it("inspect: a school's students file is a kind of ours (job CS)", async () => {
    const r = await post("inspect", "?kind=students");
    expect(r.status).toBe(200);
    expect(h.inspect.mock.calls[0].slice(0, 3)).toEqual(["person-token", T, "students"]);
  });
  it("inspect: sends the raw file, its type and the kind with the person's own token, and answers {ok, data}", async () => {
    const r = await post("inspect", "?kind=stock");
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true, data: { kind: "customers" } });
    expect(r.headers.get("cache-control")).toBe("no-store");
    const args = h.inspect.mock.calls[0];
    expect(args.slice(0, 3)).toEqual(["person-token", T, "stock"]);
    expect(new TextDecoder().decode(args[3] as ArrayBuffer)).toBe("name,phone\nRavi,98765");
    expect(args[4]).toBe("text/csv");
  });
  it("preview: passes the job and the chosen columns", async () => {
    await post("preview", `?kind=customers&job_id=${JOB}&mapping=${encodeURIComponent('{"company_name":0}')}`);
    expect(h.preview.mock.calls[0].slice(0, 5)).toEqual(["person-token", T, "customers", JOB, { company_name: 0 }]);
  });
  it("confirm: asks the API to run the job with the same file", async () => {
    await post("confirm", `?job_id=${JOB}`);
    expect(h.confirm.mock.calls[0].slice(0, 3)).toEqual(["person-token", T, JOB]);
  });
  it.each([
    ["a mapping that is not an object", `?kind=customers&job_id=${JOB}&mapping=${encodeURIComponent("[1]")}`],
    ["a mapping with a column that is not a number", `?kind=customers&job_id=${JOB}&mapping=${encodeURIComponent('{"city":"a"}')}`],
    ["a mapping with a field word that is not closed", `?kind=customers&job_id=${JOB}&mapping=${encodeURIComponent('{"a b":1}')}`],
    ["a mapping that is not JSON", `?kind=customers&job_id=${JOB}&mapping=zzz`],
    ["a job that is not a uuid", "?kind=customers&job_id=nope"],
    ["a kind that is not one of ours", `?kind=invoices&job_id=${JOB}`],
  ])("preview refuses %s with 400 and asks the API nothing", async (_n, query) => {
    expect((await post("preview", query)).status).toBe(400);
    expect(h.preview).not.toHaveBeenCalled();
  });
  it("answers 404 to any other step", async () => {
    expect((await post("delete")).status).toBe(404);
  });
  it("refuses a request from another site (403), an unsigned person (401), and a workspace id that is not one (404)", async () => {
    expect((await post("inspect", "?kind=customers", "x", { host: HOST, "sec-fetch-site": "cross-site", "content-type": "text/csv" })).status).toBe(403);
    h.user = null;
    expect((await post("inspect", "?kind=customers")).status).toBe(401);
    h.user = { accessToken: "t" };
    expect((await post("inspect", "?kind=customers", "x", SAME, "not-a-uuid")).status).toBe(404);
    expect(h.inspect).not.toHaveBeenCalled();
  });
  it("a file over 2 MB is 413 and is not sent on", async () => {
    const big = new Uint8Array(2_000_001);
    const r = await post("inspect", "?kind=customers", big);
    expect(r.status).toBe(413);
    expect(await r.json()).toMatchObject({ ok: false, kind: "too_big" });
    expect(h.inspect).not.toHaveBeenCalled();
  });
  it.each([
    [new ApiRequestError(403, "mfa_required", "x"), 403, "mfa"],
    [new ApiRequestError(403, "forbidden", "x"), 403, "forbidden"],
    [new ApiRequestError(429, "rate_limited", "x", undefined, undefined, 20), 429, "rate_limited"],
    [new ApiRequestError(422, "file_encrypted", "x"), 422, "invalid"],
    [new ApiRequestError(409, "import_file_changed", "x"), 409, "conflict"],
    [new ApiRequestError(503, "api_unreachable", "x"), 503, "unavailable"],
  ])("a refusal (%j) becomes our shape with status %i and kind %s, with the closed code and a sentence of ours", async (error, status, kind) => {
    h.confirm.mockRejectedValue(error);
    const r = await post("confirm", `?job_id=${JOB}`);
    expect(r.status).toBe(status);
    const body = await r.json();
    expect(body).toMatchObject({ ok: false, kind });
    expect(body.error.length).toBeGreaterThan(10);
    expect(body.error).not.toBe((error as Error).message);
    if (status === 429) expect(r.headers.get("retry-after")).toBe("20");
  });
  it("a rejected session is a plain 401 (a fetch cannot follow a redirect)", async () => {
    h.inspect.mockRejectedValue(new ApiAuthError("x"));
    expect((await post("inspect", "?kind=customers")).status).toBe(401);
  });
});
