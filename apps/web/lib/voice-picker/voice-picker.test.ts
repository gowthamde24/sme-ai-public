import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ jar: new Map<string, string>(), get: vi.fn(), put: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: (k: string) => (h.jar.has(k) ? { name: k, value: h.jar.get(k) } : undefined), set: (k: string, v: string) => void h.jar.set(k, v), delete: (k: string) => void h.jar.delete(k) }) }));
vi.mock("@/lib/api/voice-picker", () => ({ getVoicePicker: (...a: unknown[]) => h.get(...a), putVoiceChoice: (...a: unknown[]) => h.put(...a) }));

import { ApiRequestError } from "@/lib/api/client";

import { MOCK_COOKIE, readVoicePicker, saveVoiceChoice } from "./source";
import { inForce, MOCK_VOICES, parsePicker, safeSamplePath } from "./types";

const CTX = { token: "tok", tenantId: "22222222-2222-2222-2222-222222222222" };
const WIRE = {
  voices: [
    { id: "cartesia_hi_sanya", language: "hi", name: "Sanya", label: "Calm", gender: "female", default: true, sample_url: "/static/voices/hi-sanya.mp3" },
    { id: "cartesia_hi_esha", language: "hi", name: "Esha", label: "Cheerful", gender: "female", default: false, sample_url: null },
    { id: "cartesia_mr_x", language: "mr", name: "X", label: "Calm", gender: "female", default: true, sample_url: "/static/x.mp3" },
  ],
  choices: { hi: "cartesia_hi_esha" },
};
beforeEach(() => {
  h.jar.clear();
  h.get.mockReset();
  h.put.mockReset();
  vi.unstubAllEnvs();
});

describe("the voice catalogue answer", () => {
  it("is read voice by voice; a language the picker has no row for is left out; a sample is a plain path or none", () => {
    const p = parsePicker(WIRE);
    expect(p?.voices.map((v) => v.id)).toEqual(["cartesia_hi_sanya", "cartesia_hi_esha"]);
    expect(p?.voices[0]).toMatchObject({ name: "Sanya", gender: "female", isDefault: true, sampleUrl: "/static/voices/hi-sanya.mp3" });
    expect(p?.voices[1].sampleUrl).toBeNull();
    expect(p?.choices).toEqual({ hi: "cartesia_hi_esha" });
  });
  it.each([["no voices list", { ...WIRE, voices: "x" }], ["a bad id", { ...WIRE, voices: [{ ...WIRE.voices[0], id: "../x" }] }], ["an unknown gender", { ...WIRE, voices: [{ ...WIRE.voices[0], gender: "other" }] }], ["a choice that is not an id", { ...WIRE, choices: { hi: 3 } }], ["no body", null]])("%s is not accepted", (_w, body) => {
    expect(parsePicker(body)).toBeNull();
  });
  it("a sample path never carries a host, a way up or a scheme", () => {
    expect(safeSamplePath("/static/a.mp3")).toBe("/static/a.mp3");
    for (const bad of ["https://evil.example/a.mp3", "//evil.example/a.mp3", "/static/../../etc/passwd", "static/a.mp3", "/a b", 3, null]) expect(safeSamplePath(bad)).toBeNull();
  });
  it("the voice in force is the one chosen, else the default of the language", () => {
    const p = parsePicker(WIRE)!;
    expect(inForce(p, "hi")?.id).toBe("cartesia_hi_esha");
    expect(inForce({ ...p, choices: {} }, "hi")?.id).toBe("cartesia_hi_sanya");
    expect(inForce({ ...p, choices: { hi: "gone" } }, "hi")?.id).toBe("cartesia_hi_sanya"); // a voice that left the catalogue falls back
    expect(inForce(p, "te")).toBeNull();
  });
  it("the approved catalogue has one default per language and the male voice of Kannada", () => {
    for (const l of ["en", "te", "hi", "kn"]) expect(MOCK_VOICES.filter((v) => v.language === l && v.isDefault)).toHaveLength(1);
    expect(MOCK_VOICES.find((v) => v.name === "Prakash")).toMatchObject({ language: "kn", gender: "male" });
  });
});

describe("the voice picker source", () => {
  it("off: nothing is there and nothing can be saved", async () => {
    expect(await readVoicePicker(CTX)).toEqual({ mode: "off" });
    expect(await saveVoiceChoice(CTX, "hi", null)).toEqual({ ok: false, error: "not_available" });
  });
  it("mock: the approved catalogue, a choice kept in the cookie only for a voice of that language, and null goes back to the default", async () => {
    vi.stubEnv("VOICE_PICKER_SCREENS", "mock");
    const first = await readVoicePicker(CTX);
    expect(first.mode === "ok" && first.data.fake).toBe(true);
    expect(await saveVoiceChoice(CTX, "hi", "cartesia_hi_esha")).toMatchObject({ ok: true, data: { choices: { hi: "cartesia_hi_esha" } } });
    expect(h.jar.has(MOCK_COOKIE)).toBe(true);
    expect(await saveVoiceChoice(CTX, "hi", "cartesia_kn_prakash")).toEqual({ ok: false, error: "invalid" }); // another language's voice
    expect(await saveVoiceChoice(CTX, "hi", "nobody")).toEqual({ ok: false, error: "invalid" });
    expect(await saveVoiceChoice(CTX, "xx", null)).toEqual({ ok: false, error: "invalid" });
    expect(await saveVoiceChoice(CTX, "hi", null)).toMatchObject({ ok: true, data: { choices: {} } });
    expect(h.put).not.toHaveBeenCalled();
  });
  it("on: asks the API with the person's token; its refusals become closed words; an unreadable answer is 'unavailable'", async () => {
    vi.stubEnv("VOICE_PICKER_SCREENS", "1");
    h.get.mockResolvedValue(parsePicker(WIRE));
    expect((await readVoicePicker(CTX)).mode).toBe("ok");
    expect(h.get).toHaveBeenCalledWith("tok", CTX.tenantId);
    h.put.mockResolvedValue(parsePicker(WIRE));
    expect(await saveVoiceChoice(CTX, "hi", "cartesia_hi_esha")).toMatchObject({ ok: true });
    expect(h.put).toHaveBeenCalledWith("tok", CTX.tenantId, "hi", "cartesia_hi_esha");
    for (const [status, code, want] of [[403, "forbidden", "forbidden"], [422, "validation_error", "invalid"], [403, "workspace_read_only", "read_only"], [500, "boom", "down"]] as const) {
      h.put.mockRejectedValueOnce(new ApiRequestError(status, code, "x"));
      expect(await saveVoiceChoice(CTX, "hi", null)).toEqual({ ok: false, error: want });
    }
    h.get.mockRejectedValue(new Error("down"));
    expect(await readVoicePicker(CTX)).toEqual({ mode: "unavailable" });
  });
});
