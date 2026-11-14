import { beforeEach, describe, expect, it, vi } from "vitest";

const jar = vi.hoisted(() => ({ store: new Map<string, unknown>() }));
vi.mock("@/lib/mock/jar", () => ({
  readJar: async (name: string, parse: (v: unknown) => unknown, fallback: unknown) => (jar.store.has(name) ? (parse(jar.store.get(name)) ?? fallback) : fallback),
  writeJar: async (name: string, value: unknown) => (jar.store.set(name, JSON.parse(JSON.stringify(value))), true),
  clearJar: async (name: string) => void jar.store.delete(name),
}));

import { loadTalkPrefs, previewOption, saveTalkPrefs, undoTalkChange } from "./source";
import { addressFor, cleanPatch, parseTalkPrefs } from "./types";

const GOOD = { voice: { id: "te-deepthi", name: "Deepthi", label: "Calm", gender: "female", sample: true }, style: "respectful", address: "by_name", words: "mix", speed: "normal", is_default: true, options: { voices: [{ id: "te-sindhu", name: "Sindhu", label: "Bright", gender: "female", sample: true }], style: ["friendly", "respectful", "very_formal", "short_direct"], address: ["by_name", "garu", "sir_madam", "anna_akka"], words: ["pure", "mix", "more_english"], speed: ["slower", "normal", "faster"] } };

describe("the reader", () => {
  it("reads C1's answer: the sound of a voice from its label, the lists, the defaults", () => {
    const p = parseTalkPrefs(GOOD, "te");
    expect(p?.voice).toEqual({ id: "te-deepthi", name: "Deepthi", sound: "calm", gender: "female", sample: true });
    expect(p?.options.voices.map((v) => v.id)).toEqual(["te-sindhu"]);
    expect(p).toMatchObject({ style: "respectful", address: "by_name", words: "mix", speed: "normal", isDefault: true, undoToken: null, changed: [] });
  });
  it("an answer with an unknown value or without its lists is null: never a half-filled form", () => {
    expect(parseTalkPrefs({ ...GOOD, style: "rude" }, "te")).toBeNull();
    expect(parseTalkPrefs({ ...GOOD, options: undefined }, "te")).toBeNull();
    expect(parseTalkPrefs("x", "te")).toBeNull();
  });
  it("leaves out a voice with a bad id and an undo token that is not a token", () => {
    const p = parseTalkPrefs({ ...GOOD, undo_token: "x", options: { ...GOOD.options, voices: [{ id: "../x", name: "A", label: "Warm", gender: "female" }] } }, "te");
    expect(p?.options.voices).toEqual([]);
    expect(p?.undoToken).toBeNull();
    expect(parseTalkPrefs({ ...GOOD, undo_token: "abcdefgh12345", changed: ["speed", "x"] }, "te")).toMatchObject({ undoToken: "abcdefgh12345", changed: ["speed"] });
  });
});

describe("the options of a language", () => {
  it("anna / akka only in te, kn, hi; garu only in te, kn (checked again here, whatever the API sent)", () => {
    const all = ["by_name", "garu", "sir_madam", "anna_akka"] as const;
    expect(addressFor("te", all)).toEqual(["by_name", "garu", "sir_madam", "anna_akka"]);
    expect(addressFor("kn", all)).toEqual(["by_name", "garu", "sir_madam", "anna_akka"]);
    expect(addressFor("hi", all)).toEqual(["by_name", "sir_madam", "anna_akka"]);
    expect(addressFor("en", all)).toEqual(["by_name", "sir_madam"]);
    expect(parseTalkPrefs(GOOD, "en")?.options.address).toEqual(["by_name", "sir_madam"]);
  });
});

describe("one change at a time", () => {
  it("a patch is one field with an id of the lists", () => {
    expect(cleanPatch({ speed: "slower" })).toEqual({ speed: "slower" });
    expect(cleanPatch({ voice: "te-sindhu" })).toEqual({ voice: "te-sindhu" });
    expect(cleanPatch({ speed: "slower", style: "friendly" })).toBeNull();
    expect(cleanPatch({ speed: "warp" })).toBeNull();
    expect(cleanPatch({ voice: "te sindhu" })).toBeNull();
    expect(cleanPatch({})).toBeNull();
    expect(cleanPatch([])).toBeNull();
  });
});

describe("the test version (OWNER_TALK_PREFS=mock): one cookie, per browser, no sound", () => {
  beforeEach(() => {
    jar.store.clear();
    vi.stubEnv("OWNER_TALK_PREFS", "mock");
  });
  it("a new person starts on Respectful, normal speed, by name, natural mix", async () => {
    const out = await loadTalkPrefs("t", "te");
    expect(out.ok && out.data).toMatchObject({ style: "respectful", speed: "normal", address: "by_name", words: "mix", isDefault: true });
  });
  it("saves one change, gives an undo token, and undo puts the old value back (the token works once)", async () => {
    const saved = await saveTalkPrefs("t", "te", { speed: "slower" });
    expect(saved.ok && saved.data).toMatchObject({ speed: "slower", changed: ["speed"], isDefault: false });
    const token = saved.ok ? saved.data.undoToken : null;
    expect(token).toMatch(/^[\w-]{8,64}$/);
    const undone = await undoTalkChange("t", "te", token);
    expect(undone.ok && undone.data.speed).toBe("normal");
    expect(await undoTalkChange("t", "te", token)).toEqual({ ok: false, error: "expired" });
  });
  it("the voice is kept per language; a voice of another language, a bad option or two changes are refused", async () => {
    await saveTalkPrefs("t", "te", { voice: "te-mock-m-bright" });
    const te = await loadTalkPrefs("t", "te");
    const hi = await loadTalkPrefs("t", "hi");
    expect(te.ok && te.data.voice?.id).toBe("te-mock-m-bright");
    expect(hi.ok && hi.data.voice?.id).toBe("hi-mock-f-calm");
    expect(await saveTalkPrefs("t", "te", { voice: "hi-mock-f-warm" })).toEqual({ ok: false, error: "invalid" });
    expect(await saveTalkPrefs("t", "hi", { address: "garu" })).toEqual({ ok: false, error: "invalid" });
    expect(await saveTalkPrefs("t", "xx", { speed: "slower" })).toEqual({ ok: false, error: "invalid" });
    expect(await saveTalkPrefs("t", "te", { speed: "slower", style: "friendly" })).toEqual({ ok: false, error: "invalid" });
  });
  it("a sample is only words in the test version, never audio", async () => {
    const out = await previewOption("t", "te", { style: "friendly" });
    expect(out.ok && out.data.audio).toBeNull();
    expect(out.ok && out.data.text.length).toBeGreaterThan(5);
  });
  it("with the flag off nothing is read or saved", async () => {
    vi.stubEnv("OWNER_TALK_PREFS", "");
    expect(await loadTalkPrefs("t", "te")).toEqual({ ok: false, error: "not_available" });
    expect(await saveTalkPrefs("t", "te", { speed: "slower" })).toEqual({ ok: false, error: "not_available" });
  });
});

import { mockSample, withFirstName } from "./mock";

describe("the test version's sample sentences (owner-approved wording, 14 Nov)", () => {
  const STYLES = ["friendly", "respectful", "very_formal", "short_direct"] as const;
  it("Telugu is spoken Telugu with English business words: nothing bookish", () => {
    for (const style of STYLES) expect(mockSample("te", style)).not.toMatch(/విచారణ|చేయవచ్చునా|ప్రాప్త|అనుమతితో/);
    expect(mockSample("te", "very_formal")).toBe("నమస్కారం అండీ. మూడు కొత్త ఎంక్వైరీలు వచ్చాయి. మీరు ఒప్పుకుంటే వాళ్ళకి కాల్ చేస్తాను.");
    expect(mockSample("te", "respectful")).toBe("నమస్కారం. మూడు కొత్త enquiries వచ్చాయండి. కాల్ చెయ్యమంటారా?");
    expect(mockSample("te", "short_direct")).toBe("మూడు కొత్త enquiries. కాల్ చెయ్యనా?");
  });
  it("the friendly line greets the person by first name, and is just 'Hi!' when no name is known", () => {
    expect(withFirstName(mockSample("te", "friendly"), "Lakshmi Devi")).toBe("హాయ్ Lakshmi! మూడు కొత్త enquiries వచ్చాయి. కాల్ చెయ్యనా?");
    expect(withFirstName(mockSample("en", "friendly"), null)).toBe("Hi! Three new enquiries came in. Want me to call them?");
    expect(withFirstName(mockSample("te", "respectful"), "Lakshmi")).toBe(mockSample("te", "respectful"));
  });
  it("Kannada and Hindi follow the same rule (spoken words + English business words)", () => {
    for (const style of STYLES) {
      expect(mockSample("kn", style)).not.toMatch(/ವಿಚಾರಣೆ|ಬಹುದೇ/);
      expect(mockSample("hi", style)).not.toMatch(/पूछताछ|प्राप्त/);
    }
  });
});
