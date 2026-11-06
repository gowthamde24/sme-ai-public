import { afterEach, describe, expect, it, vi } from "vitest";

import { cleanEdit, fromApi, toApi } from "@/lib/talk-training/types";

import { getTalkTraining, parsePracticeReply, parseTalkTraining, practiceCall, putTalkTraining, resetTalkTraining } from "./talk-training";

const T = "11111111-1111-4111-8111-111111111111";
const DOC = {
  greeting: { en: "Namaste! Thanks for calling {business}, I am the AI assistant.", bn: "not drawn" },
  address: "plain",
  questions: ["What is the saree for?", "Which colours do you like?"],
  never_say: ["guaranteed", "free delivery"],
  objections: [{ hears: "Too costly", answer: "We have sarees in many ranges; the team can show you options that fit." }],
  examples: [{ customer: "Do you have Kanjivaram?", answer: "Yes, we keep Kanjivaram silks; would you like to visit?" }],
};
const OUT = { training: DOC, saved: false, defaults: DOC, rules: ["Always says it is an AI."], updated_at: null, wording: "draft" };

describe("the talk-training document (C1's docs/contracts/talk-training.md)", () => {
  it("reads the API's shape into the screen's and back, leaving out languages the screens do not have", () => {
    const doc = fromApi(DOC)!;
    expect(doc.greeting).toEqual({ en: DOC.greeting.en });
    expect(doc.objections).toEqual([{ a: "Too costly", b: DOC.objections[0].answer }]);
    expect(toApi(doc)).toEqual({ ...DOC, greeting: { en: DOC.greeting.en }, say_like: [] }); // an API without "say it like this" is read as none
  });

  it('"Say it like this" (app v4, C1 #392): read, written back whole, checked again; a save always carries it', () => {
    const say_like = [{ say: "pattu cheera", instead_of: "silk saree" }, { say: "మా షాప్", instead_of: null }];
    const doc = fromApi({ ...DOC, say_like })!;
    expect(doc.sayLike).toEqual([{ say: "pattu cheera", insteadOf: "silk saree" }, { say: "మా షాప్", insteadOf: null }]);
    expect(toApi(doc).say_like).toEqual(say_like);
    expect(fromApi({ ...DOC, say_like: Array(21).fill({ say: "pattu", instead_of: null }) })).toBeNull();
    expect(fromApi({ ...DOC, say_like: [{ say: "x", instead_of: null }] })).toBeNull();
    const base = { greeting: {}, address: "plain", questions: [], neverSay: [], objections: [], examples: [] };
    expect(cleanEdit({ ...base, sayLike: [{ say: " pattu cheera ", insteadOf: "  " }, { say: "", insteadOf: "dropped" }] })).toMatchObject({ ok: true, data: { sayLike: [{ say: "pattu cheera", insteadOf: null }] } });
    expect(cleanEdit({ ...base, sayLike: [{ say: "Pattu", insteadOf: null }, { say: "pattu", insteadOf: "silk" }] })).toEqual({ ok: false, error: "duplicate" });
    expect(cleanEdit({ ...base, sayLike: Array.from({ length: 21 }, (_, i) => ({ say: `word ${i}`, insteadOf: null })) })).toEqual({ ok: false, error: "too_many_say_like" });
  });

  it("refuses a body that breaks the contract, whole", () => {
    expect(() => parseTalkTraining({ ...OUT, saved: "no" })).toThrow();
    expect(() => parseTalkTraining({ ...OUT, training: { ...DOC, address: "boss" } })).toThrow();
    expect(() => parseTalkTraining({ ...OUT, training: { ...DOC, questions: Array(9).fill("Which colour?") } })).toThrow();
    expect(parseTalkTraining(OUT)).toMatchObject({ saved: false, rules: ["Always says it is an AI."], updatedAt: null });
  });

  it("checks what the browser sends again: trims, drops empty rows, refuses too many and the same line twice", () => {
    const base = { greeting: { en: "  Hello from {business}, the AI assistant.  " }, address: "garu", questions: [" Which colour? ", ""], neverSay: ["guaranteed"], objections: [{ a: "", b: "" }], examples: [] };
    expect(cleanEdit(base)).toEqual({ ok: true, data: { greeting: { en: "Hello from {business}, the AI assistant." }, address: "garu", questions: ["Which colour?"], neverSay: ["guaranteed"], objections: [], examples: [], sayLike: [] } });
    expect(cleanEdit({ ...base, questions: Array(9).fill("Which colour?") })).toEqual({ ok: false, error: "too_many_questions" });
    expect(cleanEdit({ ...base, neverSay: ["Free delivery", "free  delivery!"] })).toEqual({ ok: false, error: "duplicate" });
    expect(cleanEdit({ ...base, address: "boss" })).toEqual({ ok: false, error: "invalid" });
    expect(cleanEdit({ ...base, greeting: { xx: "Hello there" } })).toEqual({ ok: false, error: "invalid" });
    expect(cleanEdit({ ...base, objections: [{ a: "Too costly", b: "" }] })).toEqual({ ok: false, error: "invalid" });
  });
});

describe("the three calls", () => {
  afterEach(() => vi.unstubAllGlobals());
  const stub = () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(OUT), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  };
  it("GET, PUT the whole document, POST reset, each under the workspace", async () => {
    const f = stub();
    await getTalkTraining("tok", T);
    await putTalkTraining("tok", T, fromApi(DOC)!);
    await resetTalkTraining("tok", T);
    const calls = f.mock.calls as unknown as [string, RequestInit][];
    expect(calls.map(([u, i]) => [String(u).replace(/^.*\/v1/, "/v1"), i?.method ?? "GET"])).toEqual([
      [`/v1/tenants/${T}/talk-training`, "GET"],
      [`/v1/tenants/${T}/talk-training`, "PUT"],
      [`/v1/tenants/${T}/talk-training/reset`, "POST"],
    ]);
    expect(JSON.parse(String(calls[1][1].body))).toMatchObject({ never_say: DOC.never_say, examples: DOC.examples });
  });
  it("a practice call (app v4): POST with the language, the turns and the unsaved training; the answer is checked", async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ reply: "Namaste! Which saree are you looking for?", ended: false, handover: false, simulated: true }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", f);
    const draft = fromApi(DOC)!;
    expect(await practiceCall("tok", T, "te", [{ who: "customer", text: "Hello" }], draft)).toEqual({ reply: "Namaste! Which saree are you looking for?", ended: false, handover: false });
    await practiceCall("tok", T, "en", [{ who: "customer", text: "Hi" }], null);
    const calls = f.mock.calls as unknown as [string, RequestInit][];
    expect(String(calls[0][0])).toMatch(new RegExp(`/v1/tenants/${T}/talk-training/practice$`));
    expect(JSON.parse(String(calls[0][1].body))).toEqual({ language: "te", turns: [{ who: "customer", text: "Hello" }], training: toApi(draft) });
    expect(JSON.parse(String(calls[1][1].body))).not.toHaveProperty("training");
    expect(() => parsePracticeReply({ reply: "", ended: false })).toThrow();
    expect(() => parsePracticeReply({ reply: "ok" })).toThrow();
  });
  it("never asks for a workspace id that is not one", async () => {
    stub();
    await expect(getTalkTraining("tok", "../x")).rejects.toThrow();
  });
});
