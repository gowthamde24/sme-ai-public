import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

import { appDict } from "@/i18n/app";
import { CALL_LANG_NAMES } from "@/lib/assistant/types";
import { MOCK_VOICES, type Gender, type PickerLang } from "@/lib/voice-picker/types";

import { VoicePicker, type VoiceRow } from "./VoicePicker";

const WORDS = Object.fromEntries(Object.keys(appDict("en")).filter((k) => k.startsWith("vp.")).map((k) => [k, (appDict("en") as Record<string, string>)[k]]));
const rows: VoiceRow[] = [
  { language: "te", voices: MOCK_VOICES.filter((v) => v.language === "te"), choice: null },
  { language: "hi", voices: MOCK_VOICES.filter((v) => v.language === "hi"), choice: null },
  { language: "kn", voices: MOCK_VOICES.filter((v) => v.language === "kn"), choice: "kn-divya" },
];
type Fake = { src: string; play: ReturnType<typeof vi.fn>; pause: ReturnType<typeof vi.fn>; onended: (() => void) | null; onerror: (() => void) | null };
let made: Fake[] = [];
const draw = (over: Partial<{ canEdit: boolean; mock: boolean; gender: Gender; setGender: (g: Gender) => Promise<{ ok: true } | { ok: false; error: string }>; choose: (l: PickerLang, v: string | null) => Promise<{ ok: true } | { ok: false; error: string }> }> = {}) => {
  const choose = (over.choose ?? vi.fn(async () => ({ ok: true as const }))) as ReturnType<typeof vi.fn> & ((l: PickerLang, v: string | null) => Promise<{ ok: true } | { ok: false; error: string }>);
  const setGender = (over.setGender ?? vi.fn(async () => ({ ok: true as const }))) as ReturnType<typeof vi.fn> & ((g: Gender) => Promise<{ ok: true } | { ok: false; error: string }>);
  render(<VoicePicker words={WORDS} gender={over.gender ?? "female"} rows={rows} langNames={CALL_LANG_NAMES} canEdit={over.canEdit ?? true} endpoint="/app/tenants/t/voice-pick" mock={over.mock ?? false} actions={{ choose, setGender }} />);
  return Object.assign(choose, { setGender });
};
beforeEach(() => {
  made = [];
  vi.stubGlobal("Audio", function (this: Fake, src: string) {
    this.src = src;
    this.play = vi.fn(async () => undefined);
    this.pause = vi.fn();
    this.onended = null;
    this.onerror = null;
    made.push(this);
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  refresh.mockClear();
});

describe("Settings > AI assistant > Voice", () => {
  it("has a block per language with the voices of the workspace's gender: name, plain style tags, a Recommended badge, the Default badge; the voice in use is ticked and the row says who speaks", () => {
    draw();
    const hi = document.querySelector('[data-voice-lang="hi"]') as HTMLElement;
    expect(within(hi).getAllByRole("listitem")).toHaveLength(2); // the two female Hindi voices; the male one is not shown
    expect(within(hi).getByText("Sanya")).toBeInTheDocument();
    expect(within(hi).queryByText("Rohan")).toBeNull();
    expect(within(hi).getAllByText("Default")).toHaveLength(1);
    expect(within(document.querySelector('[data-voice="hi-sanya"]') as HTMLElement).getByText("Recommended")).toBeInTheDocument();
    expect(document.querySelector('[data-voice="hi-sanya"]')).toHaveTextContent("calm · mature");
    expect(document.querySelector('[data-voice="hi-sanya"]')).toHaveAttribute("data-in-use", "true"); // nothing chosen: the default
    expect(document.querySelector('[data-voice="kn-divya"]')).toHaveAttribute("data-in-use", "true"); // chosen
    expect(document.querySelector('[data-voice="kn-disha"]')).not.toHaveAttribute("data-in-use");
    expect(document.querySelector('[data-voice-lang="te"] [data-part="speaking-in"]')).toHaveTextContent("Speaking in తెలుగు · Ramya");
    expect(document.querySelector('[data-voice-lang="kn"] [data-part="speaking-in"]')).toHaveTextContent("Divya");
  });
  it("the Female / Male switch is on top: the current one is checked; Male asks for it and reads the page again, and a refusal is said in words", async () => {
    const choose = draw();
    const group = document.querySelector('[data-part="voice-gender"]') as HTMLElement;
    expect(group.compareDocumentPosition(document.querySelector('[data-voice-lang="te"]') as HTMLElement) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(group).getByRole("radio", { name: "Female" })).toBeChecked();
    fireEvent.click(within(group).getByRole("radio", { name: "Male" }));
    await waitFor(() => expect(choose.setGender).toHaveBeenCalledWith("male"));
    expect(await screen.findByRole("status")).toHaveTextContent("Voices are now Female"); // the page reads again with the new gender (the test keeps the old props)
    expect(refresh).toHaveBeenCalled();
    cleanup();
    draw({ setGender: vi.fn(async () => ({ ok: false as const, error: "forbidden" })) });
    fireEvent.click(screen.getByRole("radio", { name: "Male" }));
    expect(await screen.findByText("Only the Owner or an Admin can change the voice.", { selector: "[role=alert]" })).toBeInTheDocument();
  });
  it("Male shows the male voices of every language and nothing of the female ones", () => {
    draw({ gender: "male" });
    expect(screen.getByRole("radio", { name: "Male" })).toBeChecked();
    expect(within(document.querySelector('[data-voice-lang="te"]') as HTMLElement).getByText("Kiran")).toBeInTheDocument();
    expect(document.querySelector('[data-voice="te-ramya"]')).toBeNull();
    expect(document.querySelector('[data-voice-lang="te"] [data-part="speaking-in"]')).toHaveTextContent("Kiran"); // the male default
  });
  it("a voice whose sample words the API gives shows them under the voice once it has been played, and only that voice's", () => {
    const withText = rows.map((r) => ({ ...r, voices: r.voices.map((v) => (v.id === "hi-sanya" ? { ...v, sampleText: "नमस्ते, मैं संया हूँ।" } : v)) }));
    draw();
    cleanup();
    render(<VoicePicker words={WORDS} gender="female" rows={withText} langNames={CALL_LANG_NAMES} canEdit endpoint="/app/tenants/t/voice-pick" mock={false} actions={{ choose: async () => ({ ok: true }), setGender: async () => ({ ok: true }) }} />);
    expect(document.querySelector('[data-part="sample-text"]')).toBeNull(); // nothing is claimed before it is played
    fireEvent.click(document.querySelector('[data-play="hi-sanya"]') as HTMLElement);
    expect(document.querySelector('[data-voice="hi-sanya"] [data-part="sample-text"]')).toHaveTextContent("What this sample says:नमस्ते, मैं संया हूँ।");
    fireEvent.click(document.querySelector('[data-play="hi-esha"]') as HTMLElement);
    expect(document.querySelector('[data-part="sample-text"]')).toBeNull(); // Esha has no words given: nothing is made up
  });
  it("play and stop are one button, and only one sample plays at a time; the sample is asked of this app's own route", () => {
    draw();
    const sanya = document.querySelector('[data-play="hi-sanya"]') as HTMLElement;
    const esha = document.querySelector('[data-play="hi-esha"]') as HTMLElement;
    fireEvent.click(sanya);
    expect(made[0].src).toBe("/app/tenants/t/voice-pick?id=hi-sanya");
    expect(sanya).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(esha);
    expect(made[0].pause).toHaveBeenCalled();
    expect(sanya).toHaveAttribute("aria-pressed", "false");
    expect(esha).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(esha); // the same button stops it
    expect(esha).toHaveAttribute("aria-pressed", "false");
  });
  it("a sample that cannot be played says so in words", async () => {
    draw();
    fireEvent.click(document.querySelector('[data-play="hi-sanya"]') as HTMLElement);
    made[0].onerror?.();
    expect(await screen.findByRole("alert")).toHaveTextContent(/could not be played/);
  });
  it('"Use this voice" chooses it for that language and reads the page again; choosing the default goes back to it (null)', async () => {
    const choose = draw();
    fireEvent.click(within(document.querySelector('[data-voice="hi-esha"]') as HTMLElement).getByRole("button", { name: "Use this voice" }));
    await waitFor(() => expect(choose).toHaveBeenCalledWith("hi", "hi-esha"));
    expect(await screen.findByText(/Voice for हिन्दी saved/)).toBeInTheDocument();
    expect(refresh).toHaveBeenCalled();
    fireEvent.click(within(document.querySelector('[data-voice="kn-disha"]') as HTMLElement).getByRole("button", { name: "Use this voice" }));
    await waitFor(() => expect(choose).toHaveBeenCalledWith("kn", null)); // Disha is the default of Kannada
  });
  it("a refusal is said in words; a member who may not change it can listen but not choose", async () => {
    const choose = vi.fn(async () => ({ ok: false as const, error: "forbidden" }));
    draw({ choose });
    fireEvent.click(within(document.querySelector('[data-voice="hi-esha"]') as HTMLElement).getByRole("button", { name: "Use this voice" }));
    expect(await screen.findByText("Only the Owner or an Admin can change the voice.", { selector: "[role=alert]" })).toBeInTheDocument();
    cleanup();
    draw({ canEdit: false });
    expect(within(document.querySelector('[data-voice="hi-esha"]') as HTMLElement).getByRole("button", { name: "Use this voice" })).toBeDisabled();
    expect(document.querySelector('[data-play="hi-esha"]')).not.toBeNull();
  });
  it("says that the sounds are test tones in the test mode", () => {
    draw({ mock: true });
    expect(screen.getByRole("note")).toHaveTextContent(/sounds are tones/);
  });
});
