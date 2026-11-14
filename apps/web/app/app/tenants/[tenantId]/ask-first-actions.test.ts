import { beforeEach, describe, expect, it, vi } from "vitest";

const redirectMock = vi.fn((to: string) => {
  throw new Error(`REDIRECT ${to}`);
});
vi.mock("next/navigation", () => ({ redirect: (to: string) => redirectMock(to) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
const requireUser = vi.fn();
vi.mock("@/lib/auth/session", () => ({ requireUser: () => requireUser() }));
const fetchTenant = vi.fn();
const api = vi.hoisted(() => ({ ask: vi.fn(), dismiss: vi.fn() }));
vi.mock("@/lib/api/client", async (orig) => ({ ...(await orig<typeof import("@/lib/api/client")>()), fetchTenant: (...a: unknown[]) => fetchTenant(...a) }));
vi.mock("@/lib/api/ask-consent", async (orig) => ({ ...(await orig<typeof import("@/lib/api/ask-consent")>()), askConsentForTask: api.ask, dismissAskFirst: api.dismiss }));

import { ApiAuthError, ApiRequestError } from "@/lib/api/client";

import { askFirstAction, dismissAskFirstAction } from "./ask-first-actions";

const T = "22222222-2222-4222-8222-222222222222";
const TASK = "33333333-3333-4333-8333-333333333333";
const RESULT = { how: "whatsapp", asked: 3, queued: 3, blocked: 0, blockedReasons: {}, templateStatus: null, newAction: null, newTaskId: null };

beforeEach(() => {
  vi.clearAllMocks();
  requireUser.mockResolvedValue({ id: "u", accessToken: "tok" });
  fetchTenant.mockResolvedValue({ role: "owner" });
});

describe("Ask first actions (the Owner only)", () => {
  it("the Owner's ask goes to the plan's task with the way chosen, and the answer is numbers and codes", async () => {
    api.ask.mockResolvedValue(RESULT);
    expect(await askFirstAction(T, TASK, "whatsapp")).toEqual({ ok: true, result: RESULT });
    expect(api.ask).toHaveBeenCalledWith("tok", T, TASK, "whatsapp");
  });
  it("another role is refused before anything is sent; a way that is not one of the two, or a bad id, is refused", async () => {
    fetchTenant.mockResolvedValue({ role: "admin" });
    expect(await askFirstAction(T, TASK, "owner_confirms")).toEqual({ ok: false, error: "forbidden" });
    expect(await dismissAskFirstAction(T, TASK)).toEqual({ ok: false });
    fetchTenant.mockResolvedValue({ role: "owner" });
    expect(await askFirstAction(T, TASK, "email" as never)).toEqual({ ok: false, error: "down" });
    expect(await askFirstAction("nope", TASK, "whatsapp")).toEqual({ ok: false, error: "state" });
    expect(api.ask).not.toHaveBeenCalled();
    expect(api.dismiss).not.toHaveBeenCalled();
  });
  it("a refusal is one closed word; a rejected session goes to sign-in", async () => {
    api.ask.mockRejectedValueOnce(new ApiRequestError(422, "nobody_to_ask", "x"));
    expect(await askFirstAction(T, TASK, "whatsapp")).toEqual({ ok: false, error: "nobody" });
    api.ask.mockRejectedValueOnce(new ApiAuthError("rejected"));
    await expect(askFirstAction(T, TASK, "whatsapp")).rejects.toThrow("REDIRECT /login");
  });
  it("closing the item calls the API once and says so", async () => {
    api.dismiss.mockResolvedValue(undefined);
    expect(await dismissAskFirstAction(T, TASK)).toEqual({ ok: true });
    expect(api.dismiss).toHaveBeenCalledWith("tok", T, TASK);
    api.dismiss.mockRejectedValueOnce(new ApiRequestError(500, "x", "x"));
    expect(await dismissAskFirstAction(T, TASK)).toEqual({ ok: false });
  });
});
