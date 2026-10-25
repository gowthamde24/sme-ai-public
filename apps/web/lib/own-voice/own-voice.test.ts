import { readFileSync } from "node:fs";
import { join } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ jar: new Map<string, string>(), get: vi.fn(), sentence: vi.fn(), create: vi.fn(), del: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: (k: string) => (h.jar.has(k) ? { name: k, value: h.jar.get(k) } : undefined), set: (k: string, v: string) => void h.jar.set(k, v), delete: (k: string) => void h.jar.delete(k) }) }));
vi.mock("@/lib/api/own-voice", () => ({ getOwnVoice: (...a: unknown[]) => h.get(...a), getConsentSentence: (...a: unknown[]) => h.sentence(...a), createOwnVoice: (...a: unknown[]) => h.create(...a), deleteOwnVoice: (...a: unknown[]) => h.del(...a) }));

import { ApiRequestError } from "@/lib/api/client";

import { MOCK_COOKIE, make, readOwnVoice, remove, sentenceFor } from "./source";
import { consentSentence, parseOwnVoice, parseSentence, validConsentName, type OwnVoice } from "./types";

const CTX = { token: "tok", tenantId: "22222222-2222-2222-2222-222222222222" };
const BODY = (over: Record<string, unknown> = {}) => ({ id: "55555555-5555-4555-8555-555555555555", name: "Anil Reddy", consent_sentence: consentSentence("Anil Reddy", "Sri Silks"), sample_base64: "QUJD", sample_type: "audio/webm", sample_seconds: 20, consent_base64: "QUJD", consent_type: "audio/webm", consent_seconds: 6, ...over }) as never;

beforeEach(() => {
  h.jar.clear();
  for (const f of [h.get, h.sentence, h.create, h.del]) f.mockReset();
  vi.unstubAllEnvs();
});

const examples = JSON.parse(readFileSync(join(__dirname, "..", "..", "..", "..", "packages", "contracts", "own_voice.examples.json"), "utf8"));

describe("C1's own example payloads (packages/contracts/own_voice.examples.json)", () => {
  it("every state and the sentence are read; the request we send has the fields of the example and no others", () => {
    expect(parseOwnVoice(examples.voice_none)).toMatchObject({ status: "none", consentingName: null, saysAiAssistant: true, fake: true });
    expect(parseOwnVoice(examples.voice_ready)).toMatchObject({ status: "ready", consentingName: "Suresh Kumar", sampleSeconds: 32.5, consentSeconds: 6 });
    expect(parseOwnVoice(examples.voice_deleted)).toMatchObject({ status: "deleted", consentingName: null });
    expect(parseSentence(examples.sentence)).toBe("I, Suresh Kumar, allow Stack19 to create an AI voice of me for Sri Lakshmi Silks");
    expect(consentSentence("Suresh Kumar", "Sri Lakshmi Silks")).toBe(examples.sentence.sentence);
    expect(Object.keys(BODY()).sort()).toEqual(Object.keys(examples.create_request).sort());
  });
});

describe("the own-voice answers (contract-own-voice.md)", () => {
  it("a status is read field by field; an unknown status or a malformed field is refused or dropped", () => {
    expect(parseOwnVoice({ status: "ready", consenting_name: "Anil Reddy", consented_at: "2026-10-26T10:00:00Z", sample_seconds: 21.5, consent_seconds: 6, ready_at: "2026-10-26T10:01:00Z", deleted_at: null, languages: ["te"], says_ai_assistant: true, fake: true })).toMatchObject({ status: "ready", consentingName: "Anil Reddy", sampleSeconds: 21.5, saysAiAssistant: true, fake: true });
    expect(parseOwnVoice({ status: "none" })).toMatchObject({ status: "none", consentingName: null });
    expect(parseOwnVoice({ status: "cloned" })).toBeNull();
    expect(parseOwnVoice(null)).toBeNull();
    expect(parseOwnVoice({ status: "ready", consented_at: "never" })).toMatchObject({ consentedAt: null });
  });
  it("the sentence and the consenting name are checked", () => {
    expect(parseSentence({ sentence: "I, Anil Reddy, allow Stack19 to create an AI voice of me for Sri Silks." })).toContain("Anil Reddy");
    expect(parseSentence({ sentence: "x" })).toBeNull();
    for (const ok of ["Anil Reddy", "అనిల్ రెడ్డి", "D'Souza", "A. K. Rao"]) expect(validConsentName(ok), ok).toBe(true);
    for (const bad of ["", "A", "<b>", "12", "Anil@Reddy", "x".repeat(81), null]) expect(validConsentName(bad), String(bad)).toBe(false);
  });
});

describe("the own-voice card's source, by the flag", () => {
  it("off: nothing", async () => {
    expect(await readOwnVoice(CTX)).toEqual({ mode: "off" });
    expect(await sentenceFor(CTX, "Anil Reddy", "Sri Silks")).toBeNull();
    expect(await make(CTX, BODY(), "Sri Silks")).toEqual({ ok: false, code: "not_available" });
  });
  it("mock: no voice, then a made one that holds a name and a time and NO recording; delete forgets it", async () => {
    vi.stubEnv("OWN_VOICE_SCREENS", "mock");
    expect(await readOwnVoice(CTX)).toMatchObject({ mode: "ok", voice: { status: "none", fake: true } });
    expect(await sentenceFor(CTX, "Anil Reddy", "Sri Silks")).toBe("I, Anil Reddy, allow Stack19 to create an AI voice of me for Sri Silks");
    const made = await make(CTX, BODY(), "Sri Silks");
    expect(made).toMatchObject({ ok: true, voice: { status: "ready", consentingName: "Anil Reddy" } });
    expect(h.jar.get(MOCK_COOKIE)).not.toContain("QUJD");
    expect(await readOwnVoice(CTX)).toMatchObject({ voice: { status: "ready", consentingName: "Anil Reddy", sampleSeconds: 20 } });
    expect(await make(CTX, BODY({ id: "66666666-6666-4666-8666-666666666666" }), "Sri Silks")).toEqual({ ok: false, code: "voice_exists" });
    expect(await remove(CTX)).toMatchObject({ ok: true, voice: { status: "deleted" } });
    expect((await readOwnVoice(CTX)).mode === "ok" && (await readOwnVoice(CTX) as { voice: OwnVoice }).voice.status).toBe("none");
  });
  it("mock: the sentence must be the exact one, the lengths must fit, both recordings must be there", async () => {
    vi.stubEnv("OWN_VOICE_SCREENS", "mock");
    expect(await make(CTX, BODY({ consent_sentence: "I agree." }), "Sri Silks")).toEqual({ ok: false, code: "consent_sentence_mismatch" });
    expect(await make(CTX, BODY({ sample_seconds: 10 }), "Sri Silks")).toEqual({ ok: false, code: "recording_implausible_length" });
    expect(await make(CTX, BODY({ consent_seconds: 40 }), "Sri Silks")).toEqual({ ok: false, code: "recording_implausible_length" });
    expect(await make(CTX, BODY({ consent_base64: "" }), "Sri Silks")).toEqual({ ok: false, code: "recording_missing" });
    expect(await make(CTX, BODY({ name: "<b>" }), "Sri Silks")).toEqual({ ok: false, code: "consent_sentence_mismatch" });
    expect(h.jar.size).toBe(0);
  });
  it("on: the API's status, sentence and moves; the second factor and any refusal come back as a closed code", async () => {
    vi.stubEnv("OWN_VOICE_SCREENS", "1");
    h.get.mockResolvedValue({ status: "none" });
    expect(await readOwnVoice(CTX)).toEqual({ mode: "ok", voice: { status: "none" } });
    expect(h.get).toHaveBeenCalledWith("tok", CTX.tenantId);
    h.get.mockRejectedValueOnce(new Error("403"));
    expect(await readOwnVoice(CTX)).toEqual({ mode: "unavailable" });
    h.sentence.mockResolvedValue("I, Anil Reddy, allow Stack19 to create an AI voice of me for Sri Silks.");
    expect(await sentenceFor(CTX, "Anil Reddy", "Sri Silks")).toContain("Anil Reddy");
    expect(h.sentence).toHaveBeenCalledWith("tok", CTX.tenantId, "Anil Reddy");
    h.create.mockResolvedValue({ status: "ready" });
    expect(await make(CTX, BODY(), "Sri Silks")).toEqual({ ok: true, voice: { status: "ready" } });
    h.create.mockRejectedValueOnce(new ApiRequestError(403, "mfa_required", "x"));
    expect(await make(CTX, BODY(), "Sri Silks")).toEqual({ ok: false, code: "mfa_required", mfa: true });
    h.create.mockRejectedValueOnce(new ApiRequestError(502, "voice_provider_refused", "x"));
    expect(await make(CTX, BODY(), "Sri Silks")).toEqual({ ok: false, code: "voice_provider_refused" });
    h.del.mockRejectedValueOnce(new ApiRequestError(403, "mfa_required", "x"));
    expect(await remove(CTX)).toMatchObject({ ok: false, mfa: true });
    h.del.mockResolvedValue({ status: "deleted" });
    expect(await remove(CTX)).toEqual({ ok: true, voice: { status: "deleted" } });
  });
});
