import { beforeEach, describe, expect, it, vi } from "vitest";

const T = "11111111-1111-4111-8111-111111111111";
const h = vi.hoisted(() => ({ member: true, load: vi.fn(), save: vi.fn(), undo: vi.fn(), preview: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (to: string) => { throw new Error(`REDIRECT ${to}`); } }));
vi.mock("@/lib/auth/session", () => ({ requireUser: async () => ({ accessToken: "tok" }) }));
vi.mock("@/lib/api/client", async (orig) => ({
  ...(await orig<typeof import("@/lib/api/client")>()),
  fetchTenant: async () => {
    if (!h.member) throw new Error("not a member");
    return { id: T, name: "x", slug: "x", role: "sales" };
  },
}));
vi.mock("@/lib/talk-prefs/source", () => ({ loadTalkPrefs: (...a: unknown[]) => h.load(...a), saveTalkPrefs: (...a: unknown[]) => h.save(...a), undoTalkChange: (...a: unknown[]) => h.undo(...a), previewOption: (...a: unknown[]) => h.preview(...a) }));

import { loadTalkPrefsAction, previewTalkPrefsAction, saveTalkPrefsAction, undoTalkPrefsAction } from "./talk-prefs-actions";

beforeEach(() => {
  h.member = true;
  for (const f of [h.load, h.save, h.undo, h.preview]) f.mockReset().mockResolvedValue({ ok: true, data: {} });
});

describe("How it talks to you: the actions", () => {
  it("any member (even a sales person: the choices are their own) can read, save, undo and hear; the token is the person's, not the business's", async () => {
    await loadTalkPrefsAction(T, "te");
    await saveTalkPrefsAction(T, "te", { speed: "slower" });
    await undoTalkPrefsAction(T, "te", "tok-1234567");
    await previewTalkPrefsAction(T, "te", { style: "friendly" });
    expect(h.load).toHaveBeenCalledWith("tok", "te");
    expect(h.save).toHaveBeenCalledWith("tok", "te", { speed: "slower" });
    expect(h.undo).toHaveBeenCalledWith("tok", "te", "tok-1234567");
    expect(h.preview).toHaveBeenCalledWith("tok", "te", { style: "friendly" });
  });
  it("someone who is not a member of the workspace, or a tenant id that is not an id, gets 'not available' and nothing is called", async () => {
    h.member = false;
    expect(await saveTalkPrefsAction(T, "te", { speed: "slower" })).toEqual({ ok: false, error: "not_available" });
    h.member = true;
    expect(await loadTalkPrefsAction("not-an-id", "te")).toEqual({ ok: false, error: "not_available" });
    expect(h.save).not.toHaveBeenCalled();
    expect(h.load).not.toHaveBeenCalled();
  });
});
