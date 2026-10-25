import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiRequestError } from "@/lib/api/client";

const T = "11111111-1111-4111-8111-111111111111";
const BATCH = "44444444-4444-4444-8444-444444444444";
const SHA = "a".repeat(64);
const h = vi.hoisted(() => ({ user: null as null | { accessToken: string }, preview: vi.fn(), send: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (to: string) => { throw new Error(`NEXT_REDIRECT:${to}`); } }));
vi.mock("@/lib/auth/session", () => ({
  requireUser: async () => {
    if (!h.user) throw new Error("NEXT_REDIRECT:/login");
    return h.user;
  },
}));
vi.mock("@/lib/api/marks", () => ({ previewMarks: (...a: unknown[]) => h.preview(...a), sendMarks: (...a: unknown[]) => h.send(...a), listMarksBatches: vi.fn() }));

import { POST } from "./route";

const HOST = "app.example.test";
const SAME = { host: HOST, "sec-fetch-site": "same-origin", "content-type": "text/csv" };
const post = (step: string, query = "?kind=marks&language=te", body: BodyInit = "phone,student\n1,2", headers: Record<string, string> = SAME) =>
  POST(new NextRequest(`https://${HOST}/app/tenants/${T}/marks/${step}${query}`, { method: "POST", body, headers }), { params: Promise.resolve({ tenantId: T, step }) });

beforeEach(() => {
  vi.stubEnv("MARKS_SCREENS", "1");
  h.user = { accessToken: "person-token" };
  h.preview.mockReset().mockResolvedValue({ rows: 1 });
  h.send.mockReset().mockResolvedValue({ sent: 1 });
});

describe("POST marks/<step>", () => {
  it("preview: the raw file goes on with the person's own token, the kind, the language and the exam name", async () => {
    const r = await post("preview", "?kind=report_ready&language=hi&term=Term%201");
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true, data: { rows: 1 } });
    const a = h.preview.mock.calls[0];
    expect(a.slice(0, 2)).toEqual(["person-token", T]);
    expect(new TextDecoder().decode(a[2] as ArrayBuffer)).toBe("phone,student\n1,2");
    expect(a[3]).toBe("text/csv");
    expect(a[4]).toEqual({ kind: "report_ready", language: "hi", term: "Term 1" });
  });
  it("send: carries the batch id and what the preview showed (its SHA-256 and count)", async () => {
    await post("send", `?kind=marks&language=te&batch_id=${BATCH}&expect_sha256=${SHA}&expect_count=38`);
    expect(h.send.mock.calls[0][4]).toEqual({ kind: "marks", language: "te", term: "", batchId: BATCH, sha256: SHA, count: 38 });
  });
  it("refuses a send without the preview's proof, a bad kind or language, and an exam name with markup", async () => {
    expect((await post("send", "?kind=marks&language=te")).status).toBe(400);
    expect((await post("send", `?kind=marks&language=te&batch_id=nope&expect_sha256=${SHA}&expect_count=1`)).status).toBe(400);
    expect((await post("preview", "?kind=grades&language=te")).status).toBe(400);
    expect((await post("preview", "?kind=marks&language=fr")).status).toBe(400);
    expect((await post("preview", "?kind=marks&language=te&term=%3Cb%3E")).status).toBe(400);
    expect(h.preview).not.toHaveBeenCalled();
  });
  it("is off with the flag off, and refuses another site, a rejected session, an unknown step and a file over 3 MB", async () => {
    vi.stubEnv("MARKS_SCREENS", "");
    expect((await post("preview")).status).toBe(404);
    vi.stubEnv("MARKS_SCREENS", "1");
    expect((await post("preview", undefined, undefined, { host: HOST, "sec-fetch-site": "cross-site", "content-type": "text/csv" })).status).toBe(403);
    h.user = null;
    expect((await post("preview")).status).toBe(401);
    h.user = { accessToken: "x" };
    expect((await post("delete")).status).toBe(404);
    expect((await post("preview", undefined, new Uint8Array(3 * 1024 * 1024 + 1))).status).toBe(413);
  });
  it("a refusal of the API comes back as one closed shape: the second factor, a changed file and a closed plan", async () => {
    h.send.mockRejectedValueOnce(new ApiRequestError(403, "mfa_required", "x"));
    const mfa = await (await post("send", `?kind=marks&language=te&batch_id=${BATCH}&expect_sha256=${SHA}&expect_count=1`)).json();
    expect(mfa).toMatchObject({ ok: false, mfa: true });
    h.send.mockRejectedValueOnce(new ApiRequestError(409, "marks_file_changed", "x"));
    const changed = await post("send", `?kind=marks&language=te&batch_id=${BATCH}&expect_sha256=${SHA}&expect_count=1`);
    expect(changed.status).toBe(409);
    expect(await changed.json()).toMatchObject({ ok: false, code: "marks_file_changed" });
    h.preview.mockRejectedValueOnce(new ApiRequestError(403, "workspace_read_only", "x"));
    expect(await (await post("preview")).json()).toMatchObject({ ok: false, code: "workspace_read_only" });
  });
});
