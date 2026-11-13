import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ user: vi.fn(), tenant: vi.fn(), revalidate: vi.fn(), jar: new Map<string, string>() }));
vi.mock("@/lib/auth/session", () => ({ requireUser: () => h.user() }));
vi.mock("@/lib/api/client", async (orig) => ({ ...(await orig<typeof import("@/lib/api/client")>()), fetchTenant: (...a: unknown[]) => h.tenant(...a) }));
vi.mock("next/cache", () => ({ revalidatePath: (...a: unknown[]) => h.revalidate(...a) }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (n: string) => (h.jar.has(n) ? { value: h.jar.get(n) } : undefined),
    set: (n: string, v: string) => void h.jar.set(n, v),
  }),
}));

import { COOKIE, MAX_OFF, readOffList, setAssistant } from "@/lib/chats/assistant-switch";

import { setChatAssistantAction } from "./v6-actions";

/** The per-chat "Assistant: on/off" (design system v6): kept in a cookie of the browser while the API has no way to save it. */
const T = "66666666-6666-4666-8666-666666666666";
const lead = (n: number) => `aaaaaaaa-aaaa-4aaa-8aaa-${String(n).padStart(12, "0")}`;
beforeEach(() => {
  vi.stubEnv("DESIGN_V6", "1");
  vi.stubEnv("CHAT_ASSISTANT_SWITCH", "mock");
  h.jar.clear();
  h.user.mockReset().mockResolvedValue({ accessToken: "tok" });
  h.tenant.mockReset().mockResolvedValue({ role: "owner" });
  h.revalidate.mockReset();
});

describe("the switch in the cookie", () => {
  it("keeps the chats the assistant is OFF for, and forgets one when it is turned on again", async () => {
    expect(await readOffList()).toEqual([]);
    expect(await setAssistant(lead(1), false)).toBe(true);
    expect(await setAssistant(lead(2), false)).toBe(true);
    expect(await readOffList()).toEqual([lead(1), lead(2)]);
    expect(await setAssistant(lead(1), true)).toBe(true);
    expect(await readOffList()).toEqual([lead(2)]);
    expect(await setAssistant(lead(2), false)).toBe(true); // twice is once
    expect(await readOffList()).toEqual([lead(2)]);
  });
  it("keeps only the latest ones, and ignores anything odd in the cookie", async () => {
    for (let i = 1; i <= MAX_OFF + 3; i++) await setAssistant(lead(i), false);
    const kept = await readOffList();
    expect(kept).toHaveLength(MAX_OFF);
    expect(kept.at(-1)).toBe(lead(MAX_OFF + 3));
    h.jar.set(COOKIE, JSON.stringify([lead(1), "not-an-id", 5, null]));
    expect(await readOffList()).toEqual([lead(1)]);
    h.jar.set(COOKIE, "{broken");
    expect(await readOffList()).toEqual([]);
  });
  it("is not there when the flag is off", async () => {
    vi.stubEnv("CHAT_ASSISTANT_SWITCH", "");
    expect(await setAssistant(lead(1), false)).toBe(false);
    h.jar.set(COOKIE, JSON.stringify([lead(1)]));
    expect(await readOffList()).toEqual([]);
  });
  it("refuses a bad id", async () => {
    expect(await setAssistant("../x", false)).toBe(false);
  });
});

describe("setChatAssistantAction", () => {
  it("the Owner and an Admin turn it off and on", async () => {
    expect(await setChatAssistantAction(T, lead(1), false)).toEqual({ ok: true, on: false });
    expect(await readOffList()).toEqual([lead(1)]);
    expect(h.revalidate).toHaveBeenCalledWith(`/app/tenants/${T}/chats`);
    h.tenant.mockResolvedValue({ role: "admin" });
    expect(await setChatAssistantAction(T, lead(1), true)).toEqual({ ok: true, on: true });
    expect(await readOffList()).toEqual([]);
  });
  it("Sales and Viewer cannot; nothing is kept", async () => {
    for (const role of ["sales", "viewer"]) {
      h.tenant.mockResolvedValue({ role });
      expect(await setChatAssistantAction(T, lead(1), false)).toEqual({ ok: false, error: "forbidden" });
    }
    expect(await readOffList()).toEqual([]);
  });
  it("refuses a bad id, a non-boolean, and the flags off", async () => {
    expect((await setChatAssistantAction(T, "../x", false)).ok).toBe(false);
    expect((await setChatAssistantAction(T, lead(1), "yes")).ok).toBe(false);
    vi.stubEnv("CHAT_ASSISTANT_SWITCH", "");
    expect(await setChatAssistantAction(T, lead(1), false)).toEqual({ ok: false, error: "not_available" });
    vi.stubEnv("CHAT_ASSISTANT_SWITCH", "mock");
    vi.stubEnv("DESIGN_V6", "");
    expect(await setChatAssistantAction(T, lead(1), false)).toEqual({ ok: false, error: "not_available" });
  });
  it("a workspace that cannot be read is a refusal", async () => {
    h.tenant.mockRejectedValue(new Error("down"));
    expect(await setChatAssistantAction(T, lead(1), false)).toEqual({ ok: false, error: "forbidden" });
  });
});
