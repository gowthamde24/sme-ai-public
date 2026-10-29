import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ jar: new Map<string, string>(), get: vi.fn(), put: vi.fn(), cget: vi.fn(), cput: vi.fn(), preview: vi.fn(), spoken: vi.fn(), saved: vi.fn(), Unsupported: class extends Error {} }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: (k: string) => (h.jar.has(k) ? { name: k, value: h.jar.get(k) } : undefined), set: (k: string, v: string) => void h.jar.set(k, v), delete: (k: string) => void h.jar.delete(k) }) }));
vi.mock("@/lib/api/opening-line", () => ({ getOpeningLine: (...a: unknown[]) => h.get(...a), putOpeningLine: (...a: unknown[]) => h.put(...a), getCampaignOpeningLine: (...a: unknown[]) => h.cget(...a), putCampaignOpeningLine: (...a: unknown[]) => h.cput(...a), previewOpeningLine: (...a: unknown[]) => h.preview(...a), previewSpoken: (...a: unknown[]) => h.spoken(...a), savedGreetingText: (...a: unknown[]) => h.saved(...a), PreviewUnsupported: h.Unsupported }));

import { ApiRequestError } from "@/lib/api/client";

import { MOCK_COOKIE, parseEdit, previewLine, readCampaignOpeningLine, readOpeningLine, saveCampaignOpeningLine, saveOpeningLine } from "./source";
import { MOCK_DEFAULTS, fillOpening, parseCampaignOpeningLine, parseOpeningLine, parsePreview, unknownPlaceholders, validLine } from "./types";

const CTX = { token: "tok", tenantId: "22222222-2222-2222-2222-222222222222" };
const CAMPAIGN = "33333333-3333-4333-8333-333333333333";
const EN = "Hello {customer}, this is {assistant} from {business}.";
const VALUES = { customer: "Ravi", assistant: "your assistant", business: "Sri Silks", agent_role: "AI assistant" };

beforeEach(() => {
  h.jar.clear();
  for (const f of [h.get, h.put, h.cget, h.cput, h.preview]) f.mockReset();
  vi.unstubAllEnvs();
});

describe("a line and its placeholders", () => {
  it("is 5 to 300 characters with only the four placeholders and no markup", () => {
    expect(validLine(EN)).toBe(true);
    expect(validLine("Hi")).toBe(false);
    expect(validLine("x".repeat(301))).toBe(false);
    expect(validLine("Hello {name}, this is a call")).toBe(false);
    expect(validLine("Hello <b>{customer}</b> how are you")).toBe(false);
    expect(validLine(5)).toBe(false);
    expect(unknownPlaceholders("{customer} {name} {phone} {name}")).toEqual(["name", "phone"]);
  });
  it("is filled with made-up values; a placeholder it does not know stays as typed", () => {
    expect(fillOpening(`${EN} {agent_role} {x}`, VALUES)).toBe("Hello Ravi, this is your assistant from Sri Silks. AI assistant {x}");
  });
  it("every default of the mock is a valid line in each of the six languages", () => {
    for (const text of Object.values(MOCK_DEFAULTS)) expect(validLine(text)).toBe(true);
    expect(Object.keys(MOCK_DEFAULTS).sort()).toEqual(["en", "hi", "kn", "ml", "ta", "te"]);
  });
});

describe("the answers of the API (assumed contract of lib/api/opening-line.ts)", () => {
  const defaults = MOCK_DEFAULTS;
  it("reads the workspace's line: the texts it has, the six defaults and the switch; a bad text or a missing default is refused", () => {
    expect(parseOpeningLine({ lines: { en: EN }, defaults, mention_ai: false })).toMatchObject({ lines: { en: EN }, mentionAi: false, fake: false });
    expect(parseOpeningLine({ lines: {}, defaults, mention_ai: true })?.lines).toEqual({});
    expect(parseOpeningLine({ lines: { en: "{nope} hello there" }, defaults, mention_ai: true })).toBeNull();
    expect(parseOpeningLine({ lines: {}, defaults: { en: EN }, mention_ai: true })).toBeNull();
    expect(parseOpeningLine({ lines: {}, defaults })).toBeNull();
  });
  it("reads a campaign's: its own texts, the switch (null = follows the business) and what is in force", () => {
    const eff = { lines: defaults, mention_ai: true };
    expect(parseCampaignOpeningLine({ lines: { te: defaults.te }, mention_ai: null, effective: eff })).toMatchObject({ mentionAi: null, effective: { mentionAi: true } });
    expect(parseCampaignOpeningLine({ lines: {}, mention_ai: "yes", effective: eff })).toBeNull();
    expect(parseCampaignOpeningLine({ lines: {}, mention_ai: null })).toBeNull();
  });
  it("reads a preview: a playable sound or none; a type it cannot play, a huge or bad body is refused", () => {
    expect(parsePreview({ audio_base64: "QUJD", mime: "audio/mpeg", seconds: 4.2 })).toEqual({ audio: { base64: "QUJD", mime: "audio/mpeg", seconds: 4.2 }, fake: true });
    expect(parsePreview({ audio_base64: null, fake: false })).toEqual({ audio: null, fake: false });
    for (const bad of [{ audio_base64: "QUJD", mime: "text/html", seconds: 3 }, { audio_base64: "<script>", mime: "audio/mpeg", seconds: 3 }, { audio_base64: "QUJD", mime: "audio/mpeg", seconds: 600 }, "x"]) expect(parsePreview(bad)).toBeNull();
  });
});

describe("what a person may send", () => {
  it("only the six languages, each a valid text or null (back to the default), and a yes or no; a campaign may also follow the business", () => {
    expect(parseEdit({ lines: { en: ` ${EN} `, te: null }, mentionAi: false })).toEqual({ lines: { en: EN, te: null }, mentionAi: false });
    for (const bad of [null, [], { lines: { xx: EN }, mentionAi: true }, { lines: { en: "{nope} hello there" }, mentionAi: true }, { lines: { en: EN }, mentionAi: "yes" }, { lines: { en: EN }, mentionAi: null }, { mentionAi: true }]) expect(parseEdit(bad), JSON.stringify(bad)).toBeNull();
    expect(parseEdit({ lines: {}, mentionAi: null }, true)).toEqual({ lines: {}, mentionAi: null });
  });
});

describe("the editor's source", () => {
  it("is not there with the flag off, and asks the API for nothing", async () => {
    expect(await readOpeningLine(CTX)).toEqual({ mode: "off" });
    expect(await saveOpeningLine(CTX, { lines: {}, mentionAi: true })).toEqual({ ok: false, error: "not_available" });
    expect(await previewLine(CTX, "en", "Hello there")).toEqual({ ok: false, error: "not_available" });
    expect(h.get).not.toHaveBeenCalled();
  });
  it("mock: keeps the texts and the switch in one small cookie, resets a language with null, and makes no sound", async () => {
    vi.stubEnv("OPENING_LINE_SCREENS", "mock");
    expect(await readOpeningLine(CTX)).toMatchObject({ mode: "ok", data: { lines: {}, mentionAi: true, fake: true } });
    const saved = await saveOpeningLine(CTX, { lines: { en: EN, te: MOCK_DEFAULTS.te }, mentionAi: false });
    expect(saved).toMatchObject({ ok: true, data: { lines: { en: EN }, mentionAi: false } });
    expect(h.jar.has(MOCK_COOKIE)).toBe(true);
    expect(await saveOpeningLine(CTX, { lines: { en: null }, mentionAi: false })).toMatchObject({ ok: true, data: { lines: { te: MOCK_DEFAULTS.te } } });
    expect(await saveOpeningLine(CTX, { lines: { en: "no" }, mentionAi: false })).toEqual({ ok: false, error: "invalid" });
    expect(await previewLine(CTX, "te", "నమస్కారం రవి గారూ")).toEqual({ ok: true, data: { audio: null, fake: true } });
    expect(await previewLine(CTX, "xx", "Hello there")).toEqual({ ok: false, error: "invalid" });
    expect(h.put).not.toHaveBeenCalled();
  });
  it("mock: a campaign's own texts lie over the business's, and its switch can follow the business", async () => {
    vi.stubEnv("OPENING_LINE_SCREENS", "mock");
    await saveOpeningLine(CTX, { lines: { en: EN }, mentionAi: false });
    expect(await readCampaignOpeningLine(CTX, CAMPAIGN)).toMatchObject({ mode: "ok", data: { lines: {}, mentionAi: null, effective: { lines: { en: EN, te: MOCK_DEFAULTS.te }, mentionAi: false } } });
    const own = "Namaste {customer}, a special offer from {business}.";
    expect(await saveCampaignOpeningLine(CTX, CAMPAIGN, { lines: { en: own }, mentionAi: true })).toMatchObject({ ok: true, data: { mentionAi: true, effective: { lines: { en: own }, mentionAi: true } } });
    expect(await saveCampaignOpeningLine(CTX, CAMPAIGN, { lines: { en: null }, mentionAi: null })).toMatchObject({ ok: true, data: { lines: {}, effective: { lines: { en: EN }, mentionAi: false } } });
  });
  it("on: the API is asked with only what was checked; its refusals become closed words, an unreadable answer is 'unavailable'", async () => {
    vi.stubEnv("OPENING_LINE_SCREENS", "1");
    h.get.mockResolvedValue({ lines: {}, defaults: MOCK_DEFAULTS, mentionAi: true, fake: false });
    expect(await readOpeningLine(CTX)).toMatchObject({ mode: "ok" });
    h.put.mockResolvedValue({ lines: { en: EN }, defaults: MOCK_DEFAULTS, mentionAi: true, fake: false });
    expect(await saveOpeningLine(CTX, { lines: { en: EN }, mentionAi: true })).toMatchObject({ ok: true });
    expect(h.put).toHaveBeenCalledWith("tok", CTX.tenantId, { en: EN }, true);
    for (const [status, code, want] of [[403, "forbidden", "forbidden"], [422, "invalid_value", "invalid"], [409, "workspace_read_only", "read_only"], [500, "x", "down"]] as const) {
      h.put.mockRejectedValueOnce(new ApiRequestError(status, code, "x"));
      expect(await saveOpeningLine(CTX, { lines: { en: EN }, mentionAi: true })).toEqual({ ok: false, error: want });
    }
    h.get.mockRejectedValue(new Error("down"));
    expect(await readOpeningLine(CTX)).toEqual({ mode: "unavailable" });
  });
  it("'Hear it' speaks the line as it is in the box, saved or not, and brings back the exact words; a line that is not valid is refused and never replaced by the saved one", async () => {
    vi.stubEnv("OPENING_LINE_SCREENS", "1");
    const line = "Hello {customer}, this is {assistant} of {business}. Do you have a minute?";
    h.spoken.mockResolvedValue({ audio: { base64: "QUJD", mime: "audio/wav", seconds: 3 }, fake: false, spokenText: "Hello Ravi, this is Tara of Sri Silks. Do you have a minute?" });
    expect(await previewLine(CTX, "en", line, true, true)).toEqual({ ok: true, data: { audio: { base64: "QUJD", mime: "audio/wav", seconds: 3 }, fake: false, spokenText: "Hello Ravi, this is Tara of Sri Silks. Do you have a minute?" } });
    expect(h.spoken).toHaveBeenCalledWith("tok", CTX.tenantId, { language: "en", text: line, mentionAi: true });
    h.spoken.mockClear();
    expect(await previewLine(CTX, "en", "Short {x}", true, true)).toEqual({ ok: false, error: "invalid" });
    expect(h.spoken).not.toHaveBeenCalled();
  });
  it("a line in another script than its language is its own closed word", async () => {
    vi.stubEnv("OPENING_LINE_SCREENS", "1");
    h.spoken.mockRejectedValue(new ApiRequestError(422, "language_mismatch", "x"));
    expect(await previewLine(CTX, "te", "Hello {customer}, this is {assistant} of {business}.", true, true)).toEqual({ ok: false, error: "language" });
  });
  it("while the API has no 'preview this text': a saved line is heard with its exact greeting shown, an unsaved one says it cannot be heard yet (never another sound)", async () => {
    vi.stubEnv("OPENING_LINE_SCREENS", "1");
    const line = "Hello {customer}, this is {assistant} of {business}. Do you have a minute?";
    h.spoken.mockRejectedValue(new h.Unsupported());
    h.preview.mockResolvedValue({ audio: { base64: "QUJD", mime: "audio/wav", seconds: 3 }, fake: false });
    h.saved.mockResolvedValue("Hello Ravi, this is Tara of Sri Silks.");
    expect(await previewLine(CTX, "en", line, true, false)).toMatchObject({ ok: true, data: { spokenText: "Hello Ravi, this is Tara of Sri Silks." } });
    expect(h.preview).toHaveBeenCalledWith("tok", CTX.tenantId, "en");
    h.preview.mockClear();
    expect(await previewLine(CTX, "en", line, true, true)).toEqual({ ok: false, error: "unsupported" });
    expect(h.preview).not.toHaveBeenCalled();
    h.preview.mockResolvedValue({ audio: null, fake: false }); // no voice service: nothing to hear, no words claimed
    expect(await previewLine(CTX, "en", line, true, false)).toMatchObject({ ok: true, data: { audio: null, spokenText: null } });
  });
});
