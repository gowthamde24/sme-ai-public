import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ listHistory: vi.fn(), openHistory: vi.fn() }));
vi.mock("./conversation-api", () => api);

import { useRestoreThread } from "./use-restore-thread";
import type { AskSession } from "./use-ask-session";

const THREAD = [{ asked: "send Kalyani: how are you?", heardByVoice: false, answer: "Done.", sources: [], drafts: [], errorCode: null, failed: false, task: null }];
const session = (over: Record<string, unknown> = {}) => {
  const s = { base: "/app/tenants/T", earlier: [], phase: "idle", conversationId: () => null, newChat: vi.fn(), ...over };
  return s as unknown as AskSession & { newChat: ReturnType<typeof vi.fn> };
};

beforeEach(() => {
  api.listHistory.mockReset();
  api.openHistory.mockReset();
});

describe("the one conversation survives a reload", () => {
  it("opens the most recent conversation once, when this page's conversation is empty", async () => {
    api.listHistory.mockResolvedValue([{ id: "c-new", title: "x", updatedAt: "", messageCount: 2, lastText: "" }, { id: "c-old", title: "y", updatedAt: "", messageCount: 2, lastText: "" }]);
    api.openHistory.mockResolvedValue(THREAD);
    const s = session();
    const { rerender } = renderHook(({ x }) => useRestoreThread(x), { initialProps: { x: s as AskSession | null } });
    await waitFor(() => expect(s.newChat).toHaveBeenCalledWith("c-new", THREAD));
    expect(api.openHistory).toHaveBeenCalledWith("/app/tenants/T", "c-new");
    rerender({ x: s });
    expect(api.listHistory).toHaveBeenCalledTimes(1);
  });

  it("does nothing when a conversation is already going on in this tab, or there is no history", async () => {
    const busy = session({ conversationId: () => "c-now" });
    renderHook(() => useRestoreThread(busy));
    const typed = session({ earlier: THREAD });
    renderHook(() => useRestoreThread(typed));
    api.listHistory.mockResolvedValue([]);
    const empty = session();
    renderHook(() => useRestoreThread(empty));
    await waitFor(() => expect(api.listHistory).toHaveBeenCalledTimes(1)); // only the empty page asked
    expect(busy.newChat).not.toHaveBeenCalled();
    expect(typed.newChat).not.toHaveBeenCalled();
    expect(empty.newChat).not.toHaveBeenCalled();
  });

  it("a message sent while the old one was loading wins", async () => {
    api.listHistory.mockResolvedValue([{ id: "c-new", title: "x", updatedAt: "", messageCount: 2, lastText: "" }]);
    let finish: (t: unknown) => void = () => undefined;
    api.openHistory.mockReturnValue(new Promise((r) => (finish = r)));
    let conv: string | null = null;
    const s = session({ conversationId: () => conv });
    renderHook(() => useRestoreThread(s));
    await waitFor(() => expect(api.openHistory).toHaveBeenCalled());
    conv = "c-typed"; // the owner typed meanwhile
    finish(THREAD);
    await new Promise((r) => setTimeout(r, 20));
    expect(s.newChat).not.toHaveBeenCalled();
  });
});
