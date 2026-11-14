import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ user: vi.fn(), tenant: vi.fn(), list: vi.fn(), history: vi.fn(), archive: vi.fn(), confirm: vi.fn(), approve: vi.fn(), cancel: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireUser: () => h.user() }));
vi.mock("@/lib/api/client", async (orig) => ({ ...(await orig<typeof import("@/lib/api/client")>()), fetchTenant: (...a: unknown[]) => h.tenant(...a) }));
vi.mock("@/lib/api/lead-finder", () => ({ approveSearch: (...a: unknown[]) => h.approve(...a), cancelSearch: (...a: unknown[]) => h.cancel(...a) }));
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
  for (const f of [h.list, h.history, h.archive, h.confirm, h.approve, h.cancel]) f.mockReset();
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
    expect(h.confirm).toHaveBeenCalledWith("tok", T, A, "yes", false);
    // a big plan: the second yes carries the flag; the API's refusal of a plain yes is the closed word "second"
    expect(await (await post({ op: "confirm", actionId: A, decision: "yes", secondConfirm: true })).json()).toEqual({ ok: true, status: "confirmed" });
    expect(h.confirm).toHaveBeenLastCalledWith("tok", T, A, "yes", true);
    h.confirm.mockRejectedValueOnce(new ApiRequestError(409, "second_yes_required", "x"));
    expect(await (await post({ op: "confirm", actionId: A, decision: "yes" })).json()).toEqual({ ok: false, error: "second" });
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
  it("the Lead Finder card's OK and Cancel go to the API with the person's own token (Owner, Admin); refusals become closed words; Sales is refused before any call", async () => {
    const S = "a1a1a1a1-0000-4000-8000-000000000001";
    h.approve.mockResolvedValue({ id: S, state: "done" });
    expect(await (await post({ op: "lf_approve", searchId: S })).json()).toEqual({ ok: true, search: { id: S, state: "done" } });
    expect(h.approve).toHaveBeenCalledWith("tok", T, S);
    h.cancel.mockResolvedValue({ id: S, state: "cancelled" });
    h.tenant.mockResolvedValue({ role: "admin" });
    expect(await (await post({ op: "lf_cancel", searchId: S })).json()).toEqual({ ok: true, search: { id: S, state: "cancelled" } });
    expect(h.cancel).toHaveBeenCalledWith("tok", T, S);
    for (const [error, word] of [[new ApiRequestError(429, "search_cap_reached", "x"), "cap"], [new ApiRequestError(409, "prospect_state", "x"), "state"], [new ApiRequestError(409, "lead_finder_off", "x"), "off"], [new ApiRequestError(403, "lead_finder_not_available", "x"), "off"], [new ApiRequestError(403, "forbidden", "x"), "forbidden"], [new Error("down"), "down"]] as const) {
      h.approve.mockRejectedValueOnce(error);
      expect(await (await post({ op: "lf_approve", searchId: S })).json()).toEqual({ ok: false, error: word });
    }
    h.approve.mockRejectedValueOnce(new ApiAuthError("x"));
    expect((await post({ op: "lf_approve", searchId: S })).status).toBe(401);
    expect((await post({ op: "lf_approve", searchId: "nope" })).status).toBe(400);
    h.tenant.mockResolvedValue({ role: "sales" });
    h.approve.mockClear();
    expect(await (await post({ op: "lf_approve", searchId: S })).json()).toEqual({ ok: false, error: "forbidden" });
    expect(await (await post({ op: "lf_cancel", searchId: S })).json()).toEqual({ ok: false, error: "forbidden" });
    expect(h.approve).not.toHaveBeenCalled();
  });
  it("a Lead Desk plan (owner decision 4 Nov): no search runs from the chat, the card is told `plan`; the API's own 403 not_in_plan is `plan` too", async () => {
    const S = "a1a1a1a1-0000-4000-8000-000000000001";
    h.tenant.mockResolvedValue({ role: "owner" });
    vi.stubEnv("PLAN_TIER_SCREENS", "mock");
    vi.stubEnv("PLAN_TIER_MOCK", "lead_desk");
    expect(await (await post({ op: "lf_approve", searchId: S })).json()).toEqual({ ok: false, error: "plan" });
    expect(h.approve).not.toHaveBeenCalled();
    vi.stubEnv("PLAN_TIER_SCREENS", "");
    h.approve.mockRejectedValueOnce(new ApiRequestError(403, "not_in_plan", "x"));
    expect(await (await post({ op: "lf_approve", searchId: S })).json()).toEqual({ ok: false, error: "plan" });
  });
});
