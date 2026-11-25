import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

import { appDict } from "@/i18n/app";
import { wordsFor } from "@/i18n/app-words";
import { CALL_LANG_NAMES } from "@/lib/assistant/types";
import { parseHowSpeaks, type HowSpeaks } from "@/lib/talk-training/speaks";
import { MOCK_VOICES, type PickerLang } from "@/lib/voice-picker/types";

import { VoiceCard, type VoiceCardProps } from "./VoiceCard";

const BASE = "/app/tenants/t1";
const words = (lang: "en" | "te" | "hi" | "kn" = "en") =>
  wordsFor(lang, ["vc.", "sp.err."], ["today.err.mfa.link", "vp.mock", "vp.err.sample", "vp.owneronly", "vp.none", "vp.recommended", "vt.lang", "vt.voice", "vt.play", "vt.stop", "vt.ex.label", "vt.hear.none", "sp.notsaved", "mya.v.selected"]);
const lang = () => ({ style: "everyday_mixed", saved: false, examples: "draft" });
const BG = { value: "quiet_office", saved: false, options: [{ id: "quiet_office", label: { en: "Quiet office", te: "ప్రశాంతమైన ఆఫీస్" } }, { id: "shop", label: { en: "Shop", te: "షాప్" } }, { id: "off", label: { en: "Off", te: "ఆఫ్" } }] };
const RAW = (over: Record<string, unknown> = {}) => ({
  tone: { value: "friendly", source: "saved", pack_default: "friendly", options: ["friendly", "respectful", "quick"] },
  background: BG,
  say_ai_when_greeting: { value: false, saved: false },
  words: { languages: { te: lang(), kn: lang(), hi: lang(), ta: lang() }, options: {} },
  introduce_as: { kind: "business", text: null, options: ["business", "owner", "custom"], owner_name: "Gowtham" },
  pack_defaults: { tone: "friendly" },
  legacy_address: null,
  updated_at: null,
  ...over,
});
const H = (over: Record<string, unknown> = {}): HowSpeaks => parseHowSpeaks(RAW(over)) as HowSpeaks;
const EXAMPLES = {
  en: { friendly: "Hi! Can you drop by on Saturday?", respectful: "Good morning. Would Saturday be convenient?", quick: "Saturday, 11 am. Does it work?" },
  te: { friendly: "హాయ్! శనివారం వస్తారా?", respectful: "నమస్కారం అండీ. శనివారం వీలవుతుందా అండీ?", quick: "శనివారం 11కి రండి. వీలవుతుందా?" },
};

type Made = { src: string; play: ReturnType<typeof vi.fn>; pause: ReturnType<typeof vi.fn>; onended: (() => void) | null; onerror: (() => void) | null };
const made: Made[] = [];
beforeEach(() => {
  made.length = 0;
  vi.stubGlobal(
    "Audio",
    class {
      src: string;
      play = vi.fn(async () => undefined);
      pause = vi.fn();
      onended: (() => void) | null = null;
      onerror: (() => void) | null = null;
      constructor(src: string) {
        this.src = src;
        made.push(this as unknown as Made);
      }
    },
  );
  vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: () => "blob:live", revokeObjectURL: () => undefined }));
});
afterEach(() => {
  cleanup();
  refresh.mockReset();
  vi.unstubAllGlobals();
});

const WAV = btoa("RIFF....WAVEfmt ");
function setup(over: Partial<VoiceCardProps> = {}, voiceOver: { choices?: Partial<Record<PickerLang, string | null>>; gender?: "female" | "male" } = {}) {
  const choose = vi.fn(async () => ({ ok: true as const }));
  const hear = vi.fn(async (_language: PickerLang, voiceId: string) => ({ ok: true as const, preview: { audio: { base64: WAV, mime: "audio/wav", seconds: 2 }, fake: false, voiceId } }));
  const save = vi.fn(async (c: Record<string, unknown>) => ({ ok: true as const, data: H({ ...(c.tone ? { tone: { value: c.tone, source: "saved", pack_default: "friendly", options: [] } } : {}), ...(c.background ? { background: { ...BG, value: c.background, saved: true } } : {}), ...(c.sayAi !== undefined ? { say_ai_when_greeting: { value: c.sayAi, saved: true } } : {}) }) }));
  const toneExample = vi.fn(async () => null as string | null);
  const props: VoiceCardProps = {
    words: words(),
    uiLang: "en",
    picker: { voices: MOCK_VOICES, choices: voiceOver.choices ?? {}, active: {}, gender: voiceOver.gender ?? "female", fake: false },
    languages: ["te", "kn", "en", "hi"],
    first: "te",
    langNames: CALL_LANG_NAMES,
    endpoint: `${BASE}/voice-pick`,
    choose,
    hear,
    speaks: { initial: H(), demo: false, save: save as never },
    examples: EXAMPLES,
    draftLangs: ["te", "hi", "kn"],
    toneExample,
    canEdit: true,
    securityHref: "/app/security",
    testCallHref: `${BASE}/calls?test=1`,
    ...over,
  };
  const view = render(<VoiceCard {...props} />);
  return { choose, hear, save, toneExample, view, props };
}
const root = () => document.querySelector('[data-part="mya-voice-card"]') as HTMLElement;
const voice = (id: string) => document.querySelector(`[data-voice="${id}"]`) as HTMLElement;

describe("the voice card, \"Your assistant's voice\" (owner, 20 Nov 2026)", () => {
  it("is ONE card with one heading: named voices, no Warm/Calm/Bright, no Region, no speed", () => {
    setup();
    expect(within(root()).getAllByRole("heading", { level: 2 }).map((h) => h.textContent)).toEqual(["Your assistant's voice"]);
    expect([...root().querySelectorAll("[data-voice]")].map((v) => v.getAttribute("data-voice"))).toEqual(["te-ramya", "te-kavitha", "te-karthik", "te-naveen"]);
    expect(voice("te-ramya")).toHaveTextContent("Ramya");
    expect(voice("te-kavitha")).toHaveTextContent("Kavitha");
    for (const gone of ["Warm", "Calm", "Bright", "Region", "Speed", "speed", "Choose a sound", "Use this sound"]) expect(root().textContent ?? "").not.toContain(gone);
    expect(root().querySelectorAll('input[type="checkbox"]')).toHaveLength(0); // round radios (and one switch), never square boxes
    expect(root().querySelectorAll("input[type=radio]").length).toBeGreaterThan(5);
  });

  it("each voice says Woman or Man; the recommended one says Recommended; the one in use says In use (the default until another is chosen)", () => {
    setup();
    expect(voice("te-ramya")).toHaveTextContent("Woman");
    expect(voice("te-ramya")).toHaveTextContent("Recommended");
    expect(voice("te-ramya")).toHaveAttribute("data-selected", "true");
    expect(voice("te-ramya")).toHaveTextContent("In use");
    expect(voice("te-kavitha")).not.toHaveTextContent("Recommended");
    expect(voice("te-kavitha")).toHaveAttribute("data-selected", "false");
    expect(within(voice("te-ramya")).getByRole("radio")).toBeChecked();
    cleanup();
    setup({}, { gender: "male" });
    expect(voice("te-karthik")).toHaveTextContent("Man");
    expect(voice("te-karthik")).toHaveAttribute("data-selected", "true"); // a man's workspace: the man's default is in use
    expect(voice("te-ramya")).toHaveAttribute("data-selected", "false");
  });

  it("shows ALL the listed voices of the language, grouped Women then Men (women first), each with its own play button", () => {
    setup();
    expect([...root().querySelectorAll("[data-voice]")].map((v) => v.getAttribute("data-voice"))).toEqual(["te-ramya", "te-kavitha", "te-karthik", "te-naveen"]);
    const groups = [...root().querySelectorAll("[data-group]")];
    expect(groups.map((g) => g.getAttribute("data-group"))).toEqual(["female", "male"]);
    expect(groups[0]).toHaveTextContent("Women");
    expect(groups[1]).toHaveTextContent("Men");
    expect(within(groups[1] as HTMLElement).getAllByRole("button", { name: /^Hear / })).toHaveLength(2);
    expect(within(groups[1] as HTMLElement).getByText("Karthik")).toBeInTheDocument();
    for (const b of root().querySelectorAll("[data-play]")) expect(b).toBeEnabled();
    cleanup();
    setup({ picker: { voices: MOCK_VOICES.filter((v) => v.language === "te" && v.gender === "female"), choices: {}, active: {}, gender: "female", fake: false }, languages: ["te"] });
    expect(root().querySelectorAll("[data-group]")).toHaveLength(1);
    expect(root()).not.toHaveTextContent("Women"); // one group needs no heading
  });

  it("choosing a man's voice in a woman's workspace is ONE choice (the API switches the voice type with it): the page's answer is drawn, the man In use under Men, the Women group no longer In use", async () => {
    const { choose, view, props } = setup();
    fireEvent.click(within(voice("te-karthik")).getByRole("radio"));
    await waitFor(() => expect(choose).toHaveBeenCalledWith("te", "te-karthik"));
    await waitFor(() => expect(voice("te-karthik")).toHaveAttribute("data-selected", "true"));
    expect(refresh).toHaveBeenCalled();
    // the page is read again: the whole voices document says the workspace is a man's now
    view.rerender(<VoiceCard {...props} picker={{ voices: MOCK_VOICES, choices: { te: "te-karthik" }, active: { te: "te-karthik" }, gender: "male", fake: false }} />);
    expect(voice("te-karthik")).toHaveAttribute("data-selected", "true");
    expect(voice("te-karthik")).toHaveTextContent("In use");
    expect(voice("te-ramya")).toHaveAttribute("data-selected", "false");
    expect(root().querySelector('[data-group="male"]')).toContainElement(voice("te-karthik"));
    expect(screen.getByText("Saved. New calls use it.")).toBeInTheDocument();
  });

  it("when the API still refuses a voice of the other gender (422) the card says so plainly and keeps the previous choice: nothing is made up", async () => {
    setup({ choose: vi.fn(async () => ({ ok: false as const, error: "invalid" })) });
    fireEvent.click(within(voice("te-karthik")).getByRole("radio"));
    expect(await screen.findByRole("alert")).toHaveTextContent("That voice is not available yet.");
    expect(voice("te-ramya")).toHaveAttribute("data-selected", "true");
    expect(voice("te-karthik")).toHaveAttribute("data-selected", "false");
    expect(screen.queryByText("Saved. New calls use it.")).toBeNull();
  });

  it("the language chips switch the row; each language has its own voices and its own one in use", () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: CALL_LANG_NAMES.hi }));
    expect([...root().querySelectorAll("[data-voice]")].map((v) => v.getAttribute("data-voice"))).toEqual(["hi-sanya", "hi-pooja", "hi-kabir", "hi-rohan"]);
    expect(voice("hi-sanya")).toHaveAttribute("data-selected", "true");
    fireEvent.click(screen.getByRole("button", { name: CALL_LANG_NAMES.en }));
    expect(voice("en-janvi")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: CALL_LANG_NAMES.en })).toHaveAttribute("aria-pressed", "true");
  });

  it("a language with no voice says so; one language needs no chips", () => {
    setup({ picker: { voices: MOCK_VOICES.filter((v) => v.language === "te"), choices: {}, active: {}, gender: "female", fake: false }, languages: ["te"] });
    expect(document.querySelector('[data-part="vc-lang"]')).toBeNull();
    cleanup();
    setup({ picker: { voices: [], choices: {}, active: {}, gender: "female", fake: false }, languages: ["te"] });
    expect(document.querySelector('[data-part="vc-novoice"]')).toHaveTextContent("There are no voices for this language yet.");
  });

  it("the play button of a recorded voice plays its sample through the app's own route; one sound at a time; again stops it", () => {
    setup();
    fireEvent.click(within(voice("te-ramya")).getByRole("button", { name: "Hear Ramya" }));
    expect(made).toHaveLength(1);
    expect(made[0].src).toBe(`${BASE}/voice-pick?id=te-ramya`);
    expect(made[0].play).toHaveBeenCalled();
    expect(within(voice("te-ramya")).getByRole("button", { name: "Stop Ramya" })).toHaveAttribute("aria-pressed", "true");
    // another language, another voice: the first sound stops
    fireEvent.click(screen.getByRole("button", { name: CALL_LANG_NAMES.hi }));
    expect(made[0].pause).toHaveBeenCalled();
    fireEvent.click(within(voice("hi-sanya")).getByRole("button", { name: "Hear Sanya" }));
    expect(made[1].src).toBe(`${BASE}/voice-pick?id=hi-sanya`);
    fireEvent.click(within(voice("hi-sanya")).getByRole("button", { name: "Stop Sanya" }));
    expect(made[1].pause).toHaveBeenCalled();
    expect(made).toHaveLength(2); // nothing plays by itself
  });

  it("a sample that cannot play is said", () => {
    setup();
    fireEvent.click(within(voice("te-ramya")).getByRole("button", { name: "Hear Ramya" }));
    act(() => made[0].onerror?.());
    expect(screen.getByRole("alert")).toHaveTextContent("The sample could not be played now.");
  });

  it("a voice with no recording is heard live in ITS OWN voice and the tone on the screen, without choosing it first: the call carries the language, the voice id and the tone; the sound plays as a blob, never from a file", async () => {
    const { hear } = setup();
    const kavitha = voice("te-kavitha");
    expect(kavitha).toHaveAttribute("data-selected", "false"); // not chosen
    expect(within(kavitha).getByRole("button", { name: "Hear Kavitha" })).toBeEnabled();
    expect(kavitha).not.toHaveTextContent("Choose it, then you can hear it.");
    await act(async () => void fireEvent.click(within(kavitha).getByRole("button", { name: "Hear Kavitha" })));
    expect(hear).toHaveBeenCalledWith("te", "te-kavitha", "friendly");
    await waitFor(() => expect(made).toHaveLength(1));
    expect(made[0].src).toBe("blob:live");
    expect(made[0].play).toHaveBeenCalled();
    expect(voice("te-kavitha")).toHaveAttribute("data-selected", "false"); // listening never chooses
    fireEvent.click(within(voice("te-kavitha")).getByRole("button", { name: "Stop Kavitha" }));
    // the tone on the screen goes with the call
    fireEvent.click(within(document.querySelector('[data-part="vc-tone"]') as HTMLElement).getByRole("radio", { name: /Short and quick/ }));
    await waitFor(() => expect(within(document.querySelector('[data-part="vc-tone"]') as HTMLElement).getByRole("radio", { name: /Short and quick/ })).toBeChecked());
    await act(async () => void fireEvent.click(within(voice("te-kavitha")).getByRole("button", { name: "Hear Kavitha" })));
    await waitFor(() => expect(hear).toHaveBeenLastCalledWith("te", "te-kavitha", "quick"));
  });

  it("the live sound is never presented as a voice that did not speak it (an API that ignores voice_id speaks the voice in use); a busy day, an unknown voice, no sound and a failure are said in words", async () => {
    setup({ hear: vi.fn(async () => ({ ok: true as const, preview: { audio: { base64: WAV, mime: "audio/wav", seconds: 2 }, fake: false, voiceId: "te-ramya" } })) });
    await act(async () => void fireEvent.click(within(voice("te-kavitha")).getByRole("button", { name: "Hear Kavitha" })));
    expect(made).toHaveLength(0);
    expect(await screen.findByRole("alert")).toHaveTextContent("Choose it first, then press play.");
    cleanup();
    setup({ hear: vi.fn(async () => ({ ok: false as const, error: "unknown_voice" })) });
    await act(async () => void fireEvent.click(within(voice("te-kavitha")).getByRole("button", { name: "Hear Kavitha" })));
    expect(await screen.findByRole("alert")).toHaveTextContent("That voice is not available.");
    cleanup();
    setup({ hear: vi.fn(async () => ({ ok: false as const, error: "rate" })) });
    await act(async () => void fireEvent.click(within(voice("te-kavitha")).getByRole("button", { name: "Hear Kavitha" })));
    expect(await screen.findByRole("alert")).toHaveTextContent("Too many tries.");
    cleanup();
    setup({ hear: vi.fn(async () => ({ ok: true as const, preview: { audio: null, fake: true } })) });
    await act(async () => void fireEvent.click(within(voice("te-kavitha")).getByRole("button", { name: "Hear Kavitha" })));
    expect(await screen.findByRole("alert")).toHaveTextContent("There is no sound to play here yet.");
    cleanup();
    setup({ hear: vi.fn(async () => { throw new Error("x"); }) });
    await act(async () => void fireEvent.click(within(voice("te-kavitha")).getByRole("button", { name: "Hear Kavitha" })));
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not make the sound now.");
  });

  it("with no live preview on this system a voice with no recording is the only one that cannot be played, and says why", () => {
    setup({ hear: null });
    expect(within(voice("te-kavitha")).getByRole("button", { name: "Hear Kavitha" })).toBeDisabled();
    expect(voice("te-kavitha")).toHaveTextContent("Choose it, then you can hear it.");
    expect(within(voice("te-ramya")).getByRole("button", { name: "Hear Ramya" })).toBeEnabled();
  });

  it("choosing a voice saves it at once with the voice's own id, says so and redraws; a refused save goes back and says so", async () => {
    const { choose } = setup();
    fireEvent.click(within(voice("te-kavitha")).getByRole("radio"));
    await waitFor(() => expect(choose).toHaveBeenCalledWith("te", "te-kavitha"));
    await waitFor(() => expect(voice("te-kavitha")).toHaveAttribute("data-selected", "true"));
    expect(voice("te-ramya")).toHaveAttribute("data-selected", "false");
    expect(await screen.findByText("Saved. New calls use it.")).toBeInTheDocument();
    expect(refresh).toHaveBeenCalled();
    cleanup();
    setup({ choose: vi.fn(async () => ({ ok: false as const, error: "invalid" })) });
    fireEvent.click(within(voice("te-kavitha")).getByRole("radio"));
    expect(await screen.findByRole("alert")).toHaveTextContent("That voice is not available yet.");
    cleanup();
    setup({ choose: vi.fn(async () => ({ ok: false as const, error: "down" })) });
    fireEvent.click(within(voice("te-kavitha")).getByRole("radio"));
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not save the voice.");
    expect(voice("te-ramya")).toHaveAttribute("data-selected", "true");
  });

  it("how it talks: three plain choices as round radios with one example that follows the tone and the language", async () => {
    const { save } = setup();
    const tone = document.querySelector('[data-part="vc-tone"]') as HTMLElement;
    expect([...tone.querySelectorAll("input")].map((i) => i.value)).toEqual(["friendly", "respectful", "quick"]);
    expect(within(tone).getByRole("radio", { name: /Friendly/ })).toBeChecked();
    expect(within(tone).getByRole("radio", { name: /Short and quick/ })).toBeInTheDocument();
    expect(tone).toHaveTextContent("The answer first, in a few words.");
    const example = () => document.querySelector('[data-part="vc-example"]') as HTMLElement;
    expect(example()).toHaveTextContent("“హాయ్! శనివారం వస్తారా?”"); // the first language is Telugu: the example is in Telugu
    expect(example()).toHaveTextContent("This example wording is a draft."); // te, hi, kn are drafts
    expect(example()).toHaveAttribute("lang", "te");
    fireEvent.click(within(tone).getByRole("radio", { name: /Respectful/ }));
    await waitFor(() => expect(save).toHaveBeenCalledWith({ tone: "respectful" }));
    await waitFor(() => expect(example()).toHaveTextContent("నమస్కారం అండీ. శనివారం వీలవుతుందా అండీ?"));
    fireEvent.click(screen.getByRole("button", { name: CALL_LANG_NAMES.en }));
    expect(example()).toHaveTextContent("Good morning. Would Saturday be convenient?");
    expect(example()).not.toHaveTextContent("draft"); // English is not a draft
    fireEvent.click(screen.getByRole("button", { name: CALL_LANG_NAMES.kn })); // a language with no sentence of ours falls back to English
    expect(example()).toHaveAttribute("lang", "en");
  });

  it("the API's own words for this voice, language and tone replace our sentence when they arrive (and are not marked as a draft)", async () => {
    const toneExample = vi.fn(async (_l: PickerLang, tone: string) => (tone === "friendly" ? "హలో, నేను ప్రియ, శ్రీ సాయి హోమ్స్ నుండి." : null));
    setup({ toneExample: toneExample as never });
    await waitFor(() => expect(document.querySelector('[data-part="vc-example"]')).toHaveTextContent("నేను ప్రియ"));
    expect(toneExample).toHaveBeenCalledWith("te", "friendly");
    expect(document.querySelector('[data-part="vc-example"]')).not.toHaveTextContent("draft");
  });

  it("a refused tone goes back with the reason; the second step links to it", async () => {
    const save = vi.fn(async () => ({ ok: false as const, error: "mfa" }));
    setup({ speaks: { initial: H(), demo: false, save: save as never } });
    fireEvent.click(within(document.querySelector('[data-part="vc-tone"]') as HTMLElement).getByRole("radio", { name: /Respectful/ }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("two-step code");
    expect(within(alert).getByRole("link")).toHaveAttribute("href", "/app/security");
    expect(within(document.querySelector('[data-part="vc-tone"]') as HTMLElement).getByRole("radio", { name: /Friendly/ })).toBeChecked();
  });

  it("the background: one small plain choice in the words the API gives (in the app's language), saved at once; absent in the answer = not drawn", async () => {
    const { save } = setup();
    const bg = document.querySelector('[data-part="vc-background"]') as HTMLElement;
    expect([...bg.querySelectorAll("input")].map((i) => i.value)).toEqual(["quiet_office", "shop", "off"]);
    expect(bg).toHaveTextContent("Quiet office");
    expect(within(bg).getByRole("radio", { name: "Quiet office" })).toBeChecked();
    fireEvent.click(within(bg).getByRole("radio", { name: "Shop" }));
    await waitFor(() => expect(save).toHaveBeenCalledWith({ background: "shop" }));
    await waitFor(() => expect(within(bg).getByRole("radio", { name: "Shop" })).toBeChecked());
    cleanup();
    setup({ words: words("te"), uiLang: "te" });
    expect(document.querySelector('[data-part="vc-background"]')).toHaveTextContent("ప్రశాంతమైన ఆఫీస్");
    cleanup();
    setup({ speaks: { initial: H({ background: undefined }), demo: false, save: vi.fn() as never } });
    expect(document.querySelector('[data-part="vc-background"]')).toBeNull();
  });

  it("the switch \"Say 'AI assistant' when greeting\": off by default, one plain line under it, saved at once; the API without the field = no switch at all", async () => {
    const { save } = setup();
    const row = document.querySelector('[data-part="vc-sayai"]') as HTMLElement;
    const sw = within(row).getByRole("switch", { name: "Say 'AI assistant' when greeting" });
    expect(sw).toHaveAttribute("aria-checked", "false");
    expect(row).toHaveTextContent("If a customer asks, it always says it's your AI assistant.");
    expect(row).toHaveTextContent("On unless you turn it off.");
    fireEvent.click(sw);
    await waitFor(() => expect(save).toHaveBeenCalledWith({ sayAi: true }));
    await waitFor(() => expect(within(row).getByRole("switch")).toHaveAttribute("aria-checked", "true"));
    await act(async () => void (await new Promise((r) => setTimeout(r, 20)))); // the first save is over
    // turning it OFF opens the short written undertaking (accept + date); nothing is saved until it is accepted
    fireEvent.click(within(row).getByRole("switch"));
    const box = within(row).getByRole("group", { name: "Switch off the AI greeting" });
    expect(box).toHaveTextContent("Draft: the wording waits for the advocate's review.");
    expect(box).toHaveTextContent("The assistant will never say it is a person.");
    expect(box).toHaveTextContent(/Date: \d/);
    expect(within(box).getByRole("button", { name: "Switch it off" })).toBeDisabled();
    expect(save).not.toHaveBeenLastCalledWith({ sayAi: false });
    fireEvent.click(within(box).getByRole("checkbox", { name: "I accept this undertaking" }));
    fireEvent.click(within(box).getByRole("button", { name: "Switch it off" }));
    await waitFor(() => expect(save).toHaveBeenLastCalledWith({ sayAi: false, sayAiUndertaking: true }));
    cleanup();
    setup({ speaks: { initial: H({ say_ai_when_greeting: undefined }), demo: false, save: vi.fn() as never } });
    expect(screen.queryByRole("switch")).toBeNull();
    expect(root()).not.toHaveTextContent("AI assistant");
  });

  it("the test call to my phone is a link to the existing test-call page, only where test calls are on", () => {
    setup();
    expect(screen.getByRole("link", { name: "Test call to my phone" })).toHaveAttribute("href", `${BASE}/calls?test=1`);
    cleanup();
    setup({ testCallHref: null });
    expect(screen.queryByRole("link", { name: "Test call to my phone" })).toBeNull();
  });

  it("a person who cannot edit can look and listen but not change anything", () => {
    setup({ canEdit: false });
    for (const r of root().querySelectorAll("input[type=radio]")) expect(r).toBeDisabled();
    expect(screen.getByRole("switch")).toBeDisabled();
    expect(root()).toHaveTextContent("Only the Owner or an Admin can change the voice.");
    expect(within(voice("te-ramya")).getByRole("button", { name: "Hear Ramya" })).toBeEnabled();
  });

  it("without the voices or without the speaks panel the card still draws what it has; with neither it is not drawn", () => {
    setup({ picker: null });
    expect(document.querySelector('[data-part="vc-voices"]')).toBeNull();
    expect(document.querySelector('[data-part="vc-tone"]')).not.toBeNull();
    cleanup();
    setup({ speaks: null });
    expect(document.querySelector('[data-part="vc-voices"]')).not.toBeNull();
    expect(document.querySelector('[data-part="vc-tone"]')).toBeNull();
    cleanup();
    setup({ picker: null, speaks: null });
    expect(document.querySelector('[data-part="mya-voice-card"]')).toBeNull();
  });

  it("the test mode says the choices stay in this browser and the sounds are tones", () => {
    setup({ picker: { voices: MOCK_VOICES, choices: {}, active: {}, gender: "female", fake: true }, speaks: { initial: H(), demo: true, save: vi.fn() as never } });
    expect(root()).toHaveTextContent("Test mode: your choice is kept in this browser only");
    expect(root().querySelector('[data-part="sp-notsaved"]')).toBeInTheDocument();
  });
});

describe("the words of the voice card exist in all four languages", () => {
  it("every vc.* key has te, hi and kn words, and the three example sentences differ in each language", () => {
    const keys = Object.keys(appDict("en")).filter((k) => k.startsWith("vc."));
    expect(keys.length).toBeGreaterThan(25);
    for (const l of ["te", "hi", "kn"] as const) {
      const d = appDict(l) as Record<string, string>;
      for (const k of keys) expect(d[k], `${k} in ${l}`).toBeTruthy();
      expect(new Set([d["vc.ex.friendly"], d["vc.ex.respectful"], d["vc.ex.quick"]]).size).toBe(3);
      expect(`${d["vc.ex.friendly"]}${d["vc.ex.respectful"]}${d["vc.ex.quick"]}`).not.toContain("గారు"); // never "garu" after a general word
    }
  });
});

describe("the open layout of the voice card (MY_ASSISTANT_OPEN, owner's mock)", () => {
  it("lists voices as plain rows: the recommended and the one in use first, the others behind 'See all voices (N)'; no box and no tint on the selected row, the radio at the far right", () => {
    setup({ open: true });
    const rows = document.querySelector('[data-part="vc-voice-rows"]') as HTMLElement;
    expect(rows).not.toBeNull();
    const all = [...root().querySelectorAll("[data-voice]")].map((v) => v.getAttribute("data-voice"));
    expect(all).toHaveLength(4); // every voice is still on the page (the rest inside the See all expander)
    const seeAll = document.querySelector('[data-part="vc-see-all"]') as HTMLElement | null;
    const shownFirst = [...rows.querySelectorAll(":scope > div [data-voice]")].map((v) => v.getAttribute("data-voice"));
    expect(shownFirst.length + (seeAll ? seeAll.querySelectorAll("[data-voice]").length : 0)).toBe(4);
    if (seeAll) expect(seeAll.querySelector("summary")?.textContent).toMatch(/^See all voices \(\d+\)$/);
    const selected = document.querySelector('[data-selected="true"]') as HTMLElement;
    expect(selected.className).not.toMatch(/border-brand|bg-surface-2|rounded-xl/);
    expect(selected.querySelector('input[type="radio"]')).toBeChecked();
    expect(selected.lastElementChild?.tagName).toBe("INPUT");
  });
  it("the sample call is a hairline block, not a filled box", () => {
    setup({ open: true, conversations: { en: { friendly: ["Hello?", "Hello, this is the shop."] } } });
    const ex = document.querySelector('[data-part="vc-example"]') as HTMLElement | null;
    if (ex) expect(ex.className).not.toMatch(/bg-surface-2/);
  });
});

describe("'Sounds like' chips of the open voice list (C1's voice categories)", () => {
  it("shows Recommended and only the categories this language has voices for; a category lists ALL its voices; the chip pressed is marked; no category data = no chips", () => {
    const voices = MOCK_VOICES.map((v) => ({ ...v, soundsLike: v.gender === "female" ? ("warm_friendly" as const) : ("deep_confident" as const) }));
    setup({ open: true, picker: { voices, choices: {}, active: {}, gender: "female", fake: false } });
    const chips = within(document.querySelector('[data-part="vc-sounds"]') as HTMLElement).getAllByRole("button").map((b) => b.textContent);
    expect(chips).toEqual(["Recommended", "Warm & friendly", "Deep & confident"]);
    fireEvent.click(screen.getByRole("button", { name: "Deep & confident" }));
    expect(screen.getByRole("button", { name: "Deep & confident" })).toHaveAttribute("aria-pressed", "true");
    const shown = [...document.querySelectorAll('[data-part="vc-voice-rows"] [data-voice]')].map((v) => v.getAttribute("data-voice"));
    expect(shown.every((id) => voices.find((v) => v.id === id)?.soundsLike === "deep_confident")).toBe(true);
  });
  it("an answer with no categories draws no chips", () => {
    setup({ open: true });
    expect(document.querySelector('[data-part="vc-sounds"]')).toBeNull();
  });
});
