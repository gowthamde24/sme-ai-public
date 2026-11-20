import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

import { wordsFor } from "@/i18n/app-words";
import { CALL_LANG_NAMES } from "@/lib/assistant/types";
import { parseHowSpeaks, type HowSpeaks } from "@/lib/talk-training/speaks";
import type { TalkTrainingState } from "@/lib/talk-training/types";

import { VoiceTone, type PreviewFn, type VoiceToneProps } from "./VoiceTone";

const W = (lang: "en" | "te" | "hi" | "kn" = "en") => wordsFor(lang, ["tt.", "sp.", "vt.", "bv.end."], ["today.err.mfa.link", "ope.preview", "vp.mock", "vp.err.sample", "vp.owneronly"]);
const lang = (style = "everyday_mixed") => ({ style, saved: false, examples: "draft" });
const RAW = (over: Record<string, unknown> = {}) => ({
  tone: { value: "friendly", source: "pack_default", pack_default: "friendly", options: ["friendly", "respectful", "quick"] },
  words: { languages: { te: lang(), kn: lang(), hi: lang(), ta: lang(), en: lang() }, options: { styles: ["everyday_mixed", "everyday_pure"] } },
  introduce_as: { kind: "business", text: null, options: ["business", "owner", "custom"], owner_name: "Gowtham", preview: { te: "x", en: "y" } },
  pack_defaults: { tone: "friendly", words: "everyday_mixed" },
  legacy_address: null,
  updated_at: null,
  ...over,
});
const H = (over: Record<string, unknown> = {}): HowSpeaks => parseHowSpeaks(RAW(over)) as HowSpeaks;
const DOC = { greeting: {}, address: "plain" as const, questions: ["What is the saree for?"], neverSay: ["guaranteed"], objections: [{ a: "Too costly", b: "We have sarees in many ranges." }], examples: [], sayLike: [], introduceAs: { kind: "business" as const, text: null } };
const SUGGESTED_EN = "Hello {customer}, this is {assistant}, the {agent_role} of {business}. Do you have a minute?";
const STATE: TalkTrainingState = { training: DOC, defaults: { ...DOC, greeting: { te: "నమస్కారం {customer} గారూ, నేను {assistant}, {business} {agent_role}.", en: SUGGESTED_EN } }, saved: false, rules: ["Always says it is an AI assistant."], updatedAt: null };

afterEach(() => {
  cleanup();
  refresh.mockReset();
  vi.unstubAllGlobals();
});

const WAV = btoa("RIFF....WAVEfmt ");
function setup(over: Partial<VoiceToneProps> = {}) {
  const hearIt = vi.fn<PreviewFn>(async () => ({ ok: true as const, preview: { audio: { base64: WAV, mime: "audio/wav", seconds: 2 }, fake: false } }));
  const actions = { save: vi.fn(async (d: unknown) => ({ ok: true as const, data: { ...STATE, saved: true, training: d as never } })), reset: vi.fn(async () => ({ ok: true as const, data: STATE })) };
  const speaks = { initial: H(), demo: false, save: vi.fn(async () => ({ ok: true as const, data: H({ tone: { value: "respectful", source: "saved", pack_default: "friendly", options: [] } }) })) };
  const props: VoiceToneProps = {
    words: W(),
    voiceNames: { en: "Janvi", te: "Ramya" },
    first: "en",
    training: STATE,
    actions,
    canEdit: true,
    securityHref: "/app/security",
    speaks,
    langNames: CALL_LANG_NAMES,
    business: "Lakshmi Silks",
    assistantName: "Priya",
    hearIt,
    ...over,
  };
  render(<VoiceTone {...props} />);
  return { actions, speaks, hearIt };
}
const root = () => document.querySelector('[data-part="mya-voice-tone"]') as HTMLElement;
const box = () => document.querySelector('[data-part="vt-greeting-box"]') as HTMLElement;

describe("Voice & tone, the second card: the greeting and More choices (owner, 19 and 20 Nov 2026)", () => {
  it("has ONE heading, the greeting in view and More choices for the rest; the voice, the tone and the background are in the voice card, not here", () => {
    setup();
    expect(within(root()).getAllByRole("heading", { level: 2 }).map((h) => h.textContent)).toEqual(["Greeting and more choices"]);
    expect(root()).toHaveTextContent("Greeting");
    expect(document.querySelector('[data-part="more-choices"]')).toHaveTextContent("More choices");
    for (const gone of ["Speak to customers", "Warm", "Calm", "Bright", "Choose a sound", "Region"]) expect(root()).not.toHaveTextContent(gone);
    expect(document.querySelector('[data-part="vt-voice"]')).toBeNull();
    expect(document.querySelector('[data-part="vt-tone"]')).toBeNull();
    expect(document.querySelectorAll('[data-part="vt-greeting"]')).toHaveLength(1);
    expect(root().querySelectorAll('input[type="checkbox"]')).toHaveLength(0);
  });

  it("the greeting is ONE box with our suggestion in it, names as plain-word pills, a Hear it button and no curly braces anywhere", () => {
    setup();
    expect(box()).toHaveTextContent("Hello the customer's name, this is your assistant's name, the AI assistant of your shop name. Do you have a minute?");
    expect(box().querySelectorAll("[data-ph]")).toHaveLength(4);
    expect(root().textContent).not.toMatch(/[{}]/);
    expect(root()).not.toHaveTextContent("Put in:");
    for (const jargon of ["{customer}", "{assistant}", "{business}", "{agent_role}", "agent_role"]) expect(root()).not.toHaveTextContent(jargon);
    expect(screen.getByRole("button", { name: /Hear it/ })).toBeInTheDocument();
    expect(root()).toHaveTextContent("What the customer hears, with made-up names");
    expect(root()).toHaveTextContent("Hello Ravi, this is Priya, the AI assistant of Lakshmi Silks.");
    expect(root()).toHaveTextContent("Your assistant always says it is an AI assistant.");
  });

  it("the Telugu greeting shows no braces either", () => {
    setup({ first: "te" });
    expect(root().textContent).not.toMatch(/[{}]/);
    expect(box().querySelectorAll("[data-ph]")).toHaveLength(4);
  });

  it("adding a name puts a pill in; Save sends the stored text with the placeholder, exactly what the API takes today (the whole document)", async () => {
    const { actions, speaks } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Add the customer's name" }));
    expect(box().querySelectorAll('[data-ph="customer"]').length).toBe(2);
    expect(root().textContent).not.toMatch(/[{}]/);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(actions.save).toHaveBeenCalledTimes(1));
    expect(actions.save).toHaveBeenCalledWith({ ...DOC, greeting: { en: `${SUGGESTED_EN}{customer}` } });
    expect(speaks.save).not.toHaveBeenCalled();
  });

  it("typing text keeps the pills, an emptied box goes back to the suggestion (the key is left out), and nothing is sent while nothing changed", async () => {
    const { actions } = setup();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    box().appendChild(document.createTextNode(" Thanks!"));
    fireEvent.input(box());
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(actions.save).toHaveBeenCalledWith({ ...DOC, greeting: { en: `${SUGGESTED_EN} Thanks!` } }));
  });

  it("curly brackets typed by hand are refused in words and Save waits", () => {
    setup();
    box().appendChild(document.createTextNode(" {oops}"));
    fireEvent.input(box());
    expect(screen.getByRole("alert")).toHaveTextContent("Please take out the curly brackets.");
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("Introduce as, the Casual line and Lead Desk are not on this page (their data and save stay in code)", () => {
    setup();
    for (const gone of ["Region", "Introduce as", "Casual is only for your own test calls", "Lead Desk", "Hear an example", "Neutral (understood everywhere)"]) expect(root()).not.toHaveTextContent(gone);
    expect(document.querySelector('[data-part="sp-region"]')).toBeNull();
    expect(document.querySelector('[data-part="tt-introduce"]')).toBeNull();
  });

  it("More choices holds Words, the address, never-say, questions, answers and the platform's rules; Words saves as before", async () => {
    const { speaks } = setup();
    const more = document.querySelector('[data-part="more-choices"]') as HTMLElement;
    expect(more.querySelector('[data-part="sp-words"]')).toBeInTheDocument();
    expect(more.querySelector('[data-part="tt-address"]')).toBeInTheDocument();
    expect(more.querySelector('[data-part="tt-never"]')).toBeInTheDocument();
    expect(more.querySelector('[data-part="tt-questions"]')).toBeInTheDocument();
    expect(more.querySelector('[data-part="tt-rules"]')).toHaveTextContent("Always says it is an AI assistant.");
    fireEvent.click(within(more).getByRole("radio", { name: /fewer English words/ }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(speaks.save).toHaveBeenCalledWith({ words: { te: { style: "everyday_pure" }, kn: { style: "everyday_pure" }, hi: { style: "everyday_pure" }, ta: { style: "everyday_pure" } } }),
    );
  });

  it("the second step: a refused save says to confirm the two-step code and links to it; nothing else is hidden", async () => {
    const save = vi.fn(async () => ({ ok: false as const, error: "mfa" as const }));
    setup({ actions: { save, reset: vi.fn() } });
    fireEvent.click(screen.getByRole("button", { name: "Add the customer's name" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/two-step code/i);
    expect(within(alert).getByRole("link")).toHaveAttribute("href", "/app/security");
  });

  it("a refused change says it in words (the speaks refusal), and only the Owner can change anything", async () => {
    const speaks = { initial: H(), demo: false, save: vi.fn(async () => ({ ok: false as const, error: "forbidden" })) };
    setup({ speaks });
    fireEvent.click(within(document.querySelector('[data-part="more-choices"]') as HTMLElement).getByRole("radio", { name: /fewer English words/ }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Only the Owner can change this.");
    cleanup();
    setup({ canEdit: false });
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Add the customer/ })).toBeNull();
    expect(box()).toHaveAttribute("contenteditable", "false");
    expect(root()).toHaveTextContent("Only the owner can change this.");
  });

  it("without the greeting document the card is not drawn at all (the voice card has its own part)", () => {
    setup({ training: null, speaks: null });
    expect(document.querySelector('[data-part="mya-voice-tone"]')).toBeNull();
  });

  const stubAudio = () => {
    const play = vi.fn(async () => undefined);
    const pause = vi.fn();
    vi.stubGlobal("Audio", function (this: Record<string, unknown>, src: string) { this.src = src; this.play = play; this.pause = pause; });
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: () => "blob:greeting", revokeObjectURL: () => undefined }));
    return { play, pause };
  };

  it("Hear it speaks the greeting as it is on the screen (pills filled with example names, in the language chosen), in the voice in force and the saved tone", async () => {
    const { play } = stubAudio();
    const { hearIt } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Add the customer's name" })); // an unsaved change is heard too
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: /Hear it/ })));
    expect(hearIt).toHaveBeenCalledTimes(1);
    const [language, text, mentionAi, unsaved] = hearIt.mock.calls[0];
    expect(language).toBe("en");
    expect(text).toBe("Hello Ravi, this is Priya, the AI assistant of Lakshmi Silks. Do you have a minute?Ravi"); // no braces: what is read is what is heard
    expect(text).not.toMatch(/[{}]/);
    expect(mentionAi).toBeNull();
    expect(unsaved).toBe(true); // the API never answers with the saved line instead
    await waitFor(() => expect(play).toHaveBeenCalled());
    expect(screen.getByRole("button", { name: /Stop/ })).toBeInTheDocument();
    expect(document.querySelector('[data-part="vt-hear-limit"]')).toHaveTextContent("Preview uses the Janvi voice and your saved tone.");
  });

  it("when the API cannot speak the text yet it says so, plays nothing and never plays the saved line instead", async () => {
    const { play } = stubAudio();
    const hearIt = vi.fn<PreviewFn>(async () => ({ ok: false as const, error: "unsupported" }));
    setup({ hearIt });
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: /Hear it/ })));
    expect(document.querySelector('[data-part="vt-hear-limit"]')).toHaveTextContent("Your own words cannot be heard yet. They come with the next update.");
    expect(play).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /Hear it/ })).toBeInTheDocument();
  });

  it("no sound in the test mode, and a failed preview, are said in words", async () => {
    stubAudio();
    setup({ hearIt: vi.fn<PreviewFn>(async () => ({ ok: true as const, preview: { audio: null, fake: true } })) });
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: /Hear it/ })));
    expect(document.querySelector('[data-part="vt-hear-limit"]')).toHaveTextContent("There is no sound to play here yet.");
    cleanup();
    setup({ hearIt: vi.fn<PreviewFn>(async () => ({ ok: false as const, error: "down" })) });
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: /Hear it/ })));
    expect(document.querySelector('[data-part="vt-hear-limit"]')).toHaveTextContent("could not be played");
  });

  it("dictation: the box has a microphone's field; dictated words go in at the caret as plain text, the pills stay whole, and the saved payload is the stored text", async () => {
    const { actions } = setup();
    const proxy = document.querySelector("#vt-greeting-dictation") as HTMLTextAreaElement;
    expect(proxy).toBeInTheDocument();
    expect(proxy).toHaveAttribute("aria-hidden", "true");
    expect(proxy).toHaveAttribute("data-voice", "allow");
    expect(proxy).toHaveAttribute("lang", "en");
    expect(proxy.value).toBe(SUGGESTED_EN); // the field carries the stored text (what the microphone works on)
    // what the microphone does: the native setter, then an input event
    const said = (value: string) => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(proxy, value);
      proxy.dispatchEvent(new Event("input", { bubbles: true }));
    };
    const at = "Hello {customer}".length;
    said(`${SUGGESTED_EN.slice(0, at)} Ravi sir${SUGGESTED_EN.slice(at)}`);
    expect(box()).toHaveTextContent("Hello the customer's name Ravi sir, this is your assistant's name");
    expect(box().querySelectorAll("[data-ph]")).toHaveLength(4);
    expect(root().textContent).not.toMatch(/[{}]/);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(actions.save).toHaveBeenCalledWith({ ...DOC, greeting: { en: `${SUGGESTED_EN.slice(0, at)} Ravi sir${SUGGESTED_EN.slice(at)}` } }));
  });

  it("a read-only card has no microphone field", () => {
    setup({ canEdit: false });
    expect(document.querySelector("#vt-greeting-dictation")).toBeNull();
  });
});
