import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ jar: new Map<string, string>(), get: vi.fn(), put: vi.fn(), putGender: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: (k: string) => (h.jar.has(k) ? { name: k, value: h.jar.get(k) } : undefined), set: (k: string, v: string) => void h.jar.set(k, v), delete: (k: string) => void h.jar.delete(k) }) }));
vi.mock("@/lib/api/voice-picker", () => ({ getVoicePicker: (...a: unknown[]) => h.get(...a), putVoiceChoice: (...a: unknown[]) => h.put(...a), putVoiceGender: (...a: unknown[]) => h.putGender(...a) }));

import { ApiRequestError } from "@/lib/api/client";

import { MOCK_COOKIE, readVoicePicker, saveVoiceChoice, saveVoiceGender } from "./source";
import { inForce, MOCK_VOICES, parsePicker, PICKER_LANGS, safeSamplePath } from "./types";

const CTX = { token: "tok", tenantId: "22222222-2222-2222-2222-222222222222" };
const WIRE = {
  languages: [
    {
      language: "hi",
      default_id: "hi-sanya",
      chosen_id: "hi-esha",
      active_id: "hi-esha",
      voices: [
        { id: "hi-sanya", name: "Sanya", label: "Clear", gender: "female", default: true, chosen: false, sample_url: "/v1/voice-samples/hi-sanya.mp3", sample_text: "नमस्ते, मैं संया हूँ।" },
        { id: "hi-esha", name: "Esha", label: "Friendly", gender: "female", default: false, chosen: true, sample_url: null },
      ],
    },
    { language: "mr", default_id: "mr-x", chosen_id: null, active_id: "mr-x", voices: [{ id: "mr-x", name: "X", label: "Calm", gender: "female", default: true, chosen: false, sample_url: "/static/x.mp3" }] },
  ],
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
    expect(p?.voices.map((v) => v.id)).toEqual(["hi-sanya", "hi-esha"]);
    expect(p?.voices[0]).toMatchObject({ name: "Sanya", gender: "female", isDefault: true, sampleUrl: "/v1/voice-samples/hi-sanya.mp3" });
    expect(p?.voices[1].sampleUrl).toBeNull();
    expect(p?.voices[0].sampleText).toBe("नमस्ते, मैं संया हूँ।");
    expect(p?.voices[1].sampleText).toBeNull(); // not given: nothing is made up
    expect(p?.choices).toEqual({ hi: "hi-esha" });
  });
  it.each([["no languages list", { languages: "x" }], ["a language row without voices", { languages: [{ language: "hi" }] }], ["a bad id", { languages: [{ ...WIRE.languages[0], voices: [{ ...WIRE.languages[0].voices[0], id: "../x" }] }] }], ["an unknown gender", { languages: [{ ...WIRE.languages[0], voices: [{ ...WIRE.languages[0].voices[0], gender: "other" }] }] }], ["a choice that is not an id", { languages: [{ ...WIRE.languages[0], chosen_id: 3 }] }], ["no body", null]])("%s is not accepted", (_w, body) => {
    expect(parsePicker(body)).toBeNull();
  });
  it("a sample path never carries a host, a way up or a scheme", () => {
    expect(safeSamplePath("/static/a.mp3")).toBe("/static/a.mp3");
    for (const bad of ["https://evil.example/a.mp3", "//evil.example/a.mp3", "/static/../../etc/passwd", "static/a.mp3", "/a b", 3, null]) expect(safeSamplePath(bad)).toBeNull();
  });
  it("the voice in force is the one chosen, else the default of the language", () => {
    const p = parsePicker(WIRE)!;
    expect(inForce(p, "hi")?.id).toBe("hi-esha");
    expect(inForce({ ...p, choices: {} }, "hi")?.id).toBe("hi-sanya");
    expect(inForce({ ...p, choices: { hi: "gone" } }, "hi")?.id).toBe("hi-sanya"); // a voice that left the catalogue falls back
    expect(inForce(p, "te")).toBeNull();
  });
  it("the catalogue has, for every language and each gender, exactly one default and at least one Recommended voice; every voice has plain style tags", () => {
    for (const l of PICKER_LANGS) for (const g of ["female", "male"] as const) {
      const mine = MOCK_VOICES.filter((v) => v.language === l && v.gender === g);
      expect(mine.filter((v) => v.isDefault), `${l} ${g}`).toHaveLength(1);
      expect(mine.some((v) => v.recommended), `${l} ${g}`).toBe(true);
    }
    expect(MOCK_VOICES.every((v) => v.tags.length > 0)).toBe(true);
  });
  it("reads the gender, the style tags and the Recommended mark; the voice in force follows the gender", () => {
    const row = (language: string, voices: unknown[], chosen: string | null = null) => ({ language, default_id: null, chosen_id: chosen, active_id: null, voices });
    const v = (id: string, name: string, gender: string, over: Record<string, unknown> = {}) => ({ id, name, gender, tags: ["calm", "Warm"], recommended: false, default: false, chosen: false, sample_url: `/v1/voice-samples/${id}.mp3`, sample_text: "Hello", ...over });
    const p = parsePicker({ gender: "male", languages: [row("te", [v("te-ramya", "Ramya", "female", { default: true }), v("te-kiran", "Kiran", "male", { default: true, recommended: true })]), row("ta", [v("ta-meena", "Meena", "female", { default: true })])] });
    expect(p?.gender).toBe("male");
    expect(p?.voices.find((x) => x.id === "te-kiran")).toMatchObject({ tags: ["calm", "warm"], recommended: true, label: "calm" });
    expect(inForce(p as NonNullable<typeof p>, "te")?.name).toBe("Kiran");
    expect(inForce(p as NonNullable<typeof p>, "ta")).toBeNull(); // no male Tamil voice listed: nothing is made up
    expect(parsePicker({ languages: [row("en", [v("en-janvi", "Janvi", "female", { default: true })])] })?.gender).toBe("female"); // a answer without a gender is female
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
    expect(await saveVoiceChoice(CTX, "hi", "hi-esha")).toMatchObject({ ok: true, data: { choices: { hi: "hi-esha" } } });
    expect(h.jar.has(MOCK_COOKIE)).toBe(true);
    expect(await saveVoiceChoice(CTX, "hi", "kn-prakash")).toEqual({ ok: false, error: "invalid" }); // another language's voice
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
    expect(await saveVoiceChoice(CTX, "hi", "hi-esha")).toMatchObject({ ok: true });
    expect(h.put).toHaveBeenCalledWith("tok", CTX.tenantId, "hi", "hi-esha");
    for (const [status, code, want] of [[403, "forbidden", "forbidden"], [422, "validation_error", "invalid"], [403, "workspace_read_only", "read_only"], [500, "boom", "down"]] as const) {
      h.put.mockRejectedValueOnce(new ApiRequestError(status, code, "x"));
      expect(await saveVoiceChoice(CTX, "hi", null)).toEqual({ ok: false, error: want });
    }
    h.get.mockRejectedValue(new Error("down"));
    expect(await readVoicePicker(CTX)).toEqual({ mode: "unavailable" });
  });
  it("gender: mock keeps it in the cookie, clears the choices of the other gender, and a voice of the other gender is refused; on: asks the API and turns refusals into words", async () => {
    vi.stubEnv("VOICE_PICKER_SCREENS", "mock");
    await saveVoiceChoice(CTX, "te", "te-sindhu");
    expect(await saveVoiceGender(CTX, "male")).toMatchObject({ ok: true, data: { gender: "male", choices: {} } });
    expect(await saveVoiceChoice(CTX, "te", "te-sindhu")).toEqual({ ok: false, error: "invalid" }); // a female voice while the workspace is male
    expect(await saveVoiceChoice(CTX, "te", "te-arjun")).toMatchObject({ ok: true, data: { gender: "male", choices: { te: "te-arjun" } } });
    expect(await saveVoiceGender(CTX, "other")).toEqual({ ok: false, error: "invalid" });
    vi.stubEnv("VOICE_PICKER_SCREENS", "1");
    h.putGender.mockResolvedValue(parsePicker(WIRE));
    expect(await saveVoiceGender(CTX, "female")).toMatchObject({ ok: true });
    expect(h.putGender).toHaveBeenCalledWith("tok", CTX.tenantId, "female");
    h.putGender.mockRejectedValueOnce(new ApiRequestError(403, "forbidden", "x"));
    expect(await saveVoiceGender(CTX, "male")).toEqual({ ok: false, error: "forbidden" });
  });
});
