import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PREVIEW_JSON } from "@/lib/assistant-work/fixtures";

/** The assistant does the work (C1's contract, docs/contracts/assistant-tools.md): the files go with the turn as upload ids, and a work card comes back as it was written (the browser reads it strictly). */
const T = "11111111-1111-4111-8111-111111111111";
const M = "22222222-2222-4222-8222-222222222222";
const C = "33333333-3333-4333-8333-333333333333";
const F = "b2000000-0000-4000-8000-000000000001";
const h = vi.hoisted(() => ({ turn: vi.fn() }));
vi.mock("@/lib/api/turns", async (orig) => ({ ...(await orig<typeof import("@/lib/api/turns")>()), sendTurn: (...a: unknown[]) => h.turn(...a) }));
vi.mock("@/lib/auth/session", () => ({ requireUser: async () => ({ accessToken: "tok" }) }));
vi.mock("@/lib/api/assistant", () => ({ sendAssistantMessage: vi.fn() }));
vi.mock("@/lib/api/quotes", () => ({ fetchQuote: vi.fn() }));

import { POST } from "./route";

const HOST = "app.example.test";
const post = (body: unknown) => POST(new NextRequest(`https://${HOST}/app/tenants/${T}/ask`, { method: "POST", headers: { origin: `https://${HOST}`, host: HOST }, body: JSON.stringify(body) }), { params: Promise.resolve({ tenantId: T }) });
const lines = async (r: Response) => (await r.text()).split("\n").filter(Boolean).map((l) => JSON.parse(l));

beforeEach(() => {
  h.turn.mockReset();
  vi.stubEnv("BROWSER_VOICE", "1");
  h.turn.mockImplementation(async function* () {
    yield { type: "work_card", card: PREVIEW_JSON };
    yield { type: "done", conversation_id: C, message_id: M, language: "en", kind: "answer" };
  });
});

describe("the ask route and the work cards", () => {
  it("passes the upload ids on (canonical uuids only, at most five) and the card back unchanged", async () => {
    const r = await post({ text: "add these", messageId: M, conversationId: C, attachmentIds: [F, "not-an-id", 7, ...Array.from({ length: 6 }, () => F)] });
    expect(await lines(r)).toEqual([{ type: "work_card", card: PREVIEW_JSON }, { type: "done", conversationId: C, kind: "answer" }]);
    expect(h.turn).toHaveBeenCalledWith("tok", T, { messageId: M, conversationId: C, text: "add these", attachmentIds: [F, F, F, F, F] });
  });
  it("sends no attachment field when there are none", async () => {
    await lines(await post({ text: "hi", messageId: M, conversationId: C }));
    expect(h.turn).toHaveBeenCalledWith("tok", T, { messageId: M, conversationId: C, text: "hi" });
  });
});
