import { NextRequest } from "next/server";
import { forgetTenants } from "@/lib/api/tenant-kept";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ tenant: vi.fn(), user: vi.fn(), live: vi.fn(), lead: vi.fn(), speech: vi.fn() }));
vi.mock("@/lib/api/speech", async (orig) => ({ ...(await orig<typeof import("@/lib/api/speech")>()), transcribeSpeech: (...a: unknown[]) => h.speech(...a) }));
vi.mock("@/lib/auth/session", () => ({ requireUser: () => h.user() }));
vi.mock("@/lib/api/client", async (orig) => ({ ...(await orig<typeof import("@/lib/api/client")>()), fetchTenant: (...a: unknown[]) => h.tenant(...a) }));
vi.mock("@/lib/api/calls", async (orig) => ({ ...(await orig<typeof import("@/lib/api/calls")>()), listLiveCalls: (...a: unknown[]) => h.live(...a) }));
vi.mock("@/lib/api/crm", async (orig) => ({ ...(await orig<typeof import("@/lib/api/crm")>()), fetchLead: (...a: unknown[]) => h.lead(...a) }));

import { ApiAuthError, ApiRequestError } from "@/lib/api/client";

import { GET } from "./route";

const T = "22222222-2222-4222-8222-222222222222";
const C1 = "33333333-3333-4333-8333-333333333331";
const C2 = "33333333-3333-4333-8333-333333333332";
const L = "44444444-4444-4444-8444-444444444444";
const get = (t = T, headers: Record<string, string> = { "sec-fetch-site": "same-origin" }) => GET(new NextRequest(`http://x/app/tenants/${t}/live-calls`, { headers }), { params: Promise.resolve({ tenantId: t }) });
const row = (id: string, o: Record<string, unknown> = {}) => ({ id, direction: "inbound", state: "in_progress", live: true, who: "Lakshmi", purpose: null, language: "te", createdAt: "2026-11-09T10:00:00Z", answeredAt: null, endedAt: null, elapsedS: 4, outcome: null, category: null, summaryShort: "private words", refuseReason: null, leadId: L, sandbox: false, simulated: false, canTakeOver: true, ...o });

beforeEach(() => {
  forgetTenants();
  h.tenant.mockReset().mockResolvedValue({ role: "owner" });
  h.user.mockReset().mockResolvedValue({ accessToken: "tok" });
  h.live.mockReset().mockResolvedValue({ items: [row(C1)], nextCursor: null, pollAfterS: 5 });
  h.lead.mockReset().mockResolvedValue({ source: "indiamart" });
  vi.unstubAllEnvs();
  vi.stubEnv("APP_V4", "1");
});

describe("GET live-calls", () => {
  it("lists the live calls with their source, and nothing private: no summary, no lead id, no number", async () => {
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const body = await res.json();
    expect(body).toEqual({ calls: [{ id: C1, who: "Lakshmi", elapsed_s: 4, answered: true, source: "indiamart", can_take_over: true }], poll_after_s: 5 });
    expect(JSON.stringify(body)).not.toContain("private words");
    expect(JSON.stringify(body)).not.toContain(L);
  });
  it("Take over is the Owner's and Admin's, for a call that has been answered; Sales may read along only", async () => {
    h.tenant.mockResolvedValue({ role: "sales" });
    expect((await (await get()).json()).calls[0].can_take_over).toBe(false);
    h.tenant.mockResolvedValue({ role: "admin" });
    h.live.mockResolvedValue({ items: [row(C1, { state: "ringing" })], nextCursor: null, pollAfterS: 5 });
    expect((await (await get()).json()).calls[0]).toMatchObject({ can_take_over: false, answered: false });
  });
  it("Take over is offered only when the API says it works for that call, whatever the role", async () => {
    h.live.mockResolvedValue({ items: [row(C1, { canTakeOver: false })], nextCursor: null, pollAfterS: 5 });
    expect((await (await get()).json()).calls[0].can_take_over).toBe(false);
  });
  it("finished calls are never in the bar, and a lead's source is read once for ten minutes, not on every poll", async () => {
    h.live.mockResolvedValue({ items: [row(C2, { live: false, state: "completed" }), row(C1, { leadId: "55555555-5555-4555-8555-555555555555" })], nextCursor: null, pollAfterS: 5 });
    expect((await (await get()).json()).calls).toHaveLength(1);
    await get();
    await get();
    expect(h.lead).toHaveBeenCalledTimes(1);
  });
  it("a call live for more than 10 minutes is left out", async () => {
    h.live.mockResolvedValue({ items: [row(C1, { elapsedS: 601 }), row(C2, { elapsedS: 599 })], nextCursor: null, pollAfterS: 5 });
    expect((await (await get()).json()).calls.map((c: { id: string }) => c.id)).toEqual([C2]);
  });
  it("a source that cannot be read is left out, not made up", async () => {
    h.lead.mockRejectedValue(new Error("down"));
    h.live.mockResolvedValue({ items: [row(C1, { leadId: "66666666-6666-4666-8666-666666666666" })], nextCursor: null, pollAfterS: 5 });
    expect((await (await get()).json()).calls[0].source).toBeNull();
  });
  it("refuses a Viewer, a bad id, another site and a server without app v4", async () => {
    h.tenant.mockResolvedValue({ role: "viewer" });
    expect((await get()).status).toBe(404);
    h.tenant.mockResolvedValue({ role: "owner" });
    expect((await get("x")).status).toBe(404);
    expect((await get(T, { "sec-fetch-site": "cross-site" })).status).toBe(403);
    vi.stubEnv("APP_V4", "");
    expect((await get()).status).toBe(404);
  });
  it("signed out is 401; the API refusing the role is 404; any other failure is 503", async () => {
    h.user.mockRejectedValueOnce(new Error("redirect"));
    expect((await get()).status).toBe(401);
    h.live.mockRejectedValueOnce(new ApiAuthError("no"));
    expect((await get()).status).toBe(401);
    h.live.mockRejectedValueOnce(new ApiRequestError(403, "forbidden", "x"));
    expect((await get()).status).toBe(404);
    h.live.mockRejectedValueOnce(new Error("down"));
    expect((await get()).status).toBe(503);
  });
});

describe("POST speech-transcribe (typing by voice)", () => {
  const post = async (o: { audio?: Blob | null; language?: string; headers?: Record<string, string>; tenant?: string } = {}) => {
    const { POST } = await import("../speech-transcribe/route");
    const form = new FormData();
    if (o.audio !== null) form.set("audio", o.audio ?? new Blob([new Uint8Array(100)], { type: "audio/webm" }), "speech");
    form.set("language", o.language ?? "te");
    const t = o.tenant ?? T;
    return POST(new NextRequest(`http://x/app/tenants/${t}/speech-transcribe`, { method: "POST", body: form, headers: o.headers ?? { "sec-fetch-site": "same-origin" } }), { params: Promise.resolve({ tenantId: t }) });
  };
  it("passes the recording and the language on with the person's token and answers with the words", async () => {
    h.speech.mockResolvedValue({ text: "నమస్తే Stack19", language: "te" });
    const res = await post({ language: "auto" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ text: "నమస్తే Stack19", language: "te" });
    expect(h.speech).toHaveBeenCalledWith("tok", T, expect.objectContaining({ size: 100 }), "auto");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });
  it("the API's own refusal comes back with its status, code, message and wait; a Viewer, another site, another language, an empty or huge recording and a server without app v4 never reach the API", async () => {
    h.speech.mockRejectedValueOnce(new ApiRequestError(429, "cap_reached", "Used up for today", undefined, undefined, 3600));
    const refused = await post();
    expect(refused.status).toBe(429);
    expect(await refused.json()).toEqual({ error: { code: "cap_reached", message: "Used up for today", retry_after: 3600 } });
    h.speech.mockClear();
    h.tenant.mockResolvedValue({ role: "viewer" });
    expect((await post()).status).toBe(404);
    h.tenant.mockResolvedValue({ role: "owner" });
    expect((await post({ headers: { "sec-fetch-site": "cross-site" } })).status).toBe(403);
    expect((await post({ language: "ta" })).status).toBe(415);
    expect((await post({ audio: new Blob([]) })).status).toBe(422);
    expect((await post({ audio: new Blob([new Uint8Array(2_100_000)]) })).status).toBe(422);
    expect((await post({ audio: null })).status).toBe(422);
    vi.stubEnv("APP_V4", "");
    expect((await post()).status).toBe(404);
    expect(h.speech).not.toHaveBeenCalled();
  });
});
