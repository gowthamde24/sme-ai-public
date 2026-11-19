import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ user: vi.fn(), tenant: vi.fn(), jar: new Map<string, string>(), api: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireUser: () => h.user() }));
vi.mock("@/lib/api/client", async (orig) => ({ ...(await orig<typeof import("@/lib/api/client")>()), fetchTenant: (...a: unknown[]) => h.tenant(...a), apiRequest: (...a: unknown[]) => h.api(...a) }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (n: string) => (h.jar.has(n) ? { value: h.jar.get(n) } : undefined),
    set: (n: string, v: string) => void h.jar.set(n, v),
  }),
}));
vi.mock("next/navigation", () => ({ redirect: (to: string) => { throw new Error(`redirect ${to}`); } }));

import { cancelQueuedAction, pollQueuedAction, queueMessageAction } from "./queue-actions";

/** The server actions of the composer queue, with CHAT_QUEUE_SCREENS=mock (the cookie) and a role from the workspace. */
const T = "66666666-6666-4666-8666-666666666666";
const L = "aaaaaaaa-aaaa-4aaa-8aaa-000000000001";
const C1 = "bbbbbbbb-bbbb-4bbb-8bbb-0000000000c1";
beforeEach(() => {
  vi.stubEnv("CHAT_QUEUE_SCREENS", "mock");
  h.jar.clear();
  h.api.mockReset();
  h.user.mockReset().mockResolvedValue({ accessToken: "tok" });
  h.tenant.mockReset().mockResolvedValue({ role: "owner" });
});

describe("queue actions (mock)", () => {
  it("an owner queues, polls and cancels; nothing is sent to an API", async () => {
    const q = await queueMessageAction(T, L, C1, "Hello Ravi");
    expect(q).toMatchObject({ ok: true, data: { id: C1, status: "waiting_for_reply" } });
    expect(await pollQueuedAction(T, L)).toMatchObject({ ok: true, data: { id: C1, status: "waiting_for_reply", text: "Hello Ravi" } });
    expect(await cancelQueuedAction(T, L, C1)).toEqual({ ok: true, data: { id: C1, status: "cancelled" } });
    expect(await pollQueuedAction(T, L)).toMatchObject({ ok: true, data: { status: "cancelled" } });
    expect(h.api).not.toHaveBeenCalled();
  });
  it("Owner, Admin and Sales may queue; a Viewer cannot (a closed word, nothing stored)", async () => {
    for (const role of ["admin", "sales"]) {
      h.tenant.mockResolvedValue({ role });
      h.jar.clear();
      expect(await queueMessageAction(T, L, C1, "Hi")).toMatchObject({ ok: true });
    }
    h.jar.clear();
    h.tenant.mockResolvedValue({ role: "viewer" });
    expect(await queueMessageAction(T, L, C1, "Hi")).toEqual({ ok: false, refusal: "forbidden" });
    expect(await cancelQueuedAction(T, L, C1)).toEqual({ ok: false, refusal: "forbidden" });
    expect(h.jar.size).toBe(0);
  });
  it("odd ids or text are refused before anything happens", async () => {
    expect(await queueMessageAction("x", L, C1, "Hi")).toEqual({ ok: false, refusal: "text_invalid" });
    expect(await queueMessageAction(T, L, "not-a-uuid", "Hi")).toEqual({ ok: false, refusal: "text_invalid" });
    expect(await queueMessageAction(T, L, C1, "")).toEqual({ ok: false, refusal: "text_invalid" });
    expect(await queueMessageAction(T, L, C1, 5 as unknown as string)).toEqual({ ok: false, refusal: "text_invalid" });
  });
  it("a poll that cannot read says down, never throws", async () => {
    vi.stubEnv("CHAT_QUEUE_SCREENS", "1");
    h.api.mockRejectedValueOnce(new Error("network"));
    expect(await pollQueuedAction(T, L)).toEqual({ ok: false, refusal: "down" });
  });
  it("flag off: the part says it is not there", async () => {
    vi.stubEnv("CHAT_QUEUE_SCREENS", "");
    expect(await queueMessageAction(T, L, C1, "Hi")).toEqual({ ok: false, refusal: "not_available" });
    expect(await pollQueuedAction(T, L)).toEqual({ ok: true, data: undefined });
  });
});
