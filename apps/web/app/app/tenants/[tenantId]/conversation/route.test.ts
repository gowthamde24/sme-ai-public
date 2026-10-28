import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ user: vi.fn(), tenant: vi.fn(), list: vi.fn(), history: vi.fn(), archive: vi.fn(), confirm: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireUser: () => h.user() }));
vi.mock("@/lib/api/client", async (orig) => ({ ...(await orig<typeof import("@/lib/api/client")>()), fetchTenant: (...a: unknown[]) => h.tenant(...a) }));
vi.mock("@/lib/api/turns", () => ({ listConversations: (...a: unknown[]) => h.list(...a), getHistory: (...a: unknown[]) => h.history(...a), archiveConversation: (...a: unknown[]) => h.archive(...a), confirmAction: (...a: unknown[]) => h.confirm(...a) }));

import { ApiAuthError, ApiRequestError } from "@/lib/api/client";

import { POST } from "./route";

const T = "22222222-2222-4222-8222-222222222222";
const A = "33333333-3333-4333-8333-333333333333";
const post = (body: unknown, id = T, headers: Record<string, string> = { "sec-fetch-site": "same-origin" }) => POST(new NextRequest(`http://x/app/tenants/${id}/conversation`, { method: "POST", headers, body: JSON.stringify(body) }), { params: Promise.resolve({ tenantId: id }) });
beforeEach(() => {
  vi.unstubAllEnvs();
  vi.stubEnv("BROWSER_VOICE", "1");
  h.user.mockReset().mockResolvedValue({ accessToken: "tok" });
  h.tenant.mockReset().mockResolvedValue({ role: "owner" });
  for (const f of [h.list, h.history, h.archive, h.confirm]) f.mockReset();
});

describe("POST conversation (the panel's side calls)", () => {
  it("is not there with the panel off, from another site, or for a workspace id that is not a uuid", async () => {
    vi.stubEnv("BROWSER_VOICE", "");
    expect((await post({ op: "list" })).status).toBe(404);
    vi.stubEnv("BROWSER_VOICE", "1");
    expect((await post({ op: "list" }, T, { "sec-fetch-site": "cross-site" })).status).toBe(404);
    expect((await post({ op: "list" }, "x")).status).toBe(404);
    expect(h.list).not.toHaveBeenCalled();
  });
  it("lists, opens and hides a conversation with the person's own token; a bad id is a 400; a Viewer is refused", async () => {
    h.list.mockResolvedValue({ items: [], nextBefore: null });
    expect(await (await post({ op: "list" })).json()).toEqual({ items: [], nextBefore: null });
    expect(h.list).toHaveBeenCalledWith("tok", T, undefined);
    h.history.mockResolvedValue([{ id: A, role: "user", text: "hi" }]);
    expect(await (await post({ op: "open", id: A })).json()).toEqual({ id: A, messages: [{ id: A, role: "user", text: "hi" }] });
    h.archive.mockResolvedValue(undefined);
    expect(await (await post({ op: "archive", id: A })).json()).toEqual({ ok: true });
    expect((await post({ op: "open", id: "nope" })).status).toBe(400);
    expect((await post({ op: "weird" })).status).toBe(400);
    h.tenant.mockResolvedValue({ role: "viewer" });
    expect((await post({ op: "list" })).status).toBe(404);
  });
  it("the Owner's yes or no goes to the API; refusals become closed words (the second factor, expired, state, down); only the Owner may answer", async () => {
    h.confirm.mockResolvedValue({ status: "confirmed" });
    expect(await (await post({ op: "confirm", actionId: A, decision: "yes" })).json()).toEqual({ ok: true, status: "confirmed" });
    expect(h.confirm).toHaveBeenCalledWith("tok", T, A, "yes");
    for (const [error, word] of [[new ApiRequestError(403, "mfa_required", "x"), "mfa"], [new ApiRequestError(409, "action_expired", "x"), "expired"], [new ApiRequestError(409, "action_state", "x"), "state"], [new ApiRequestError(403, "forbidden", "x"), "forbidden"], [new Error("down"), "down"]] as const) {
      h.confirm.mockRejectedValueOnce(error);
      expect(await (await post({ op: "confirm", actionId: A, decision: "no" })).json()).toEqual({ ok: false, error: word });
    }
    h.confirm.mockRejectedValueOnce(new ApiAuthError("x"));
    expect((await post({ op: "confirm", actionId: A, decision: "yes" })).status).toBe(401);
    expect((await post({ op: "confirm", actionId: A, decision: "maybe" })).status).toBe(400);
    h.tenant.mockResolvedValue({ role: "sales" });
    expect(await (await post({ op: "confirm", actionId: A, decision: "yes" })).json()).toEqual({ ok: false, error: "forbidden" });
  });
});
