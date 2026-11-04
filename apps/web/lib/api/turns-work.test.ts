import { beforeEach, describe, expect, it, vi } from "vitest";

import { SECRET_JSON } from "@/lib/assistant-work/fixtures";

const stream = vi.fn();
vi.mock("./client", async (orig) => ({ ...(await orig<typeof import("./client")>()), apiStreamRequest: (...a: unknown[]) => stream(...a) }));
vi.mock("./assistant", async (orig) => ({ ...(await orig<typeof import("./assistant")>()), readSse: async function* () {} }));

import { parseTurnEvent, sendTurn } from "./turns";

const T = "22222222-2222-4222-8222-222222222222";
const M = "44444444-4444-4444-8444-444444444444";
const F = "b2000000-0000-4000-8000-000000000001";
beforeEach(() => stream.mockReset().mockResolvedValue({ body: {} }));

describe("turns: the assistant does the work (ASSUMED until docs/contracts/assistant-tools.md)", () => {
  it("a work_card event carries its card on; anything that is not an object is dropped", () => {
    expect(parseTurnEvent("work_card", { type: "work_card", card: SECRET_JSON })).toEqual({ type: "work_card", card: SECRET_JSON });
    expect(parseTurnEvent("work_card", { type: "work_card", card: "x" })).toBeNull();
    expect(parseTurnEvent("work_card", { type: "work_card", card: [1] })).toBeNull();
  });
  it("sends the upload ids as attachment_ids (canonical only, at most five), and nothing when there are none", async () => {
    for await (const _ of sendTurn("tok", T, { messageId: M, conversationId: null, text: "add these", attachmentIds: [F, "x", F, F, F, F, F] })) void _;
    expect(stream).toHaveBeenLastCalledWith(`/v1/tenants/${T}/assistant/turns`, "tok", { message_id: M, conversation_id: null, text: "add these", language_hint: null, attachment_ids: [F, F, F, F, F] });
    for await (const _ of sendTurn("tok", T, { messageId: M, conversationId: null, text: "hi", attachmentIds: [] })) void _;
    expect(stream).toHaveBeenLastCalledWith(`/v1/tenants/${T}/assistant/turns`, "tok", { message_id: M, conversation_id: null, text: "hi", language_hint: null });
  });
});
