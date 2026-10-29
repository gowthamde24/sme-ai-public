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

const select = (language: string) => document.querySelector(`[data-voice-select="${language}"]`) as HTMLSelectElement;
const optionsOf = (language: string) => [...select(language).options].map((o) => o.textContent);

describe("Settings > AI assistant > Voice", () => {
  it("is ONE row per language: the language name, a dropdown of that language's voices for the chosen gender ('Name — style tags', '· Recommended' first), and a separate Hear button", () => {
    draw();
    expect([...document.querySelectorAll("[data-voice-lang]")].map((r) => r.getAttribute("data-voice-lang"))).toEqual(["te", "hi", "kn"]);
    expect(optionsOf("te")).toEqual(["Ramya — warm, mature · Recommended", "Sindhu — bright, young · Recommended"]);
    expect(optionsOf("hi")).toEqual(["Sanya — calm, mature · Recommended", "Esha — warm, young · Recommended"]); // the male Hindi voice is not listed
    expect(select("te").labels?.[0]).toHaveTextContent("తెలుగు");
    expect(select("te").value).toBe("te-ramya"); // nothing chosen: the default
    expect(select("kn").value).toBe("kn-divya"); // chosen
    expect(optionsOf("kn")).toEqual(["Disha — warm, calm · Recommended", "Divya — bright, young"]); // recommended first
    expect(within(document.querySelector('[data-voice-lang="te"]') as HTMLElement).getByRole("button", { name: "Play the sample of Ramya" })).toHaveTextContent("Hear");
    expect(document.querySelectorAll("[data-voice]").length).toBe(0); // no cards any more
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
  it("Male lists the male voices of every language and nothing of the female ones", () => {
    draw({ gender: "male" });
    expect(screen.getByRole("radio", { name: "Male" })).toBeChecked();
    expect(optionsOf("te")).toEqual(["Kiran — deep, calm · Recommended", "Arjun — energetic, young"]);
    expect(select("te").value).toBe("te-kiran"); // the male default
  });
  it("changing the dropdown saves at once (and reads the page again) with a toast like 'తెలుగు voice: Sindhu'; choosing the default goes back to it (null)", async () => {
    const choose = draw();
    fireEvent.change(select("te"), { target: { value: "te-sindhu" } });
    await waitFor(() => expect(choose).toHaveBeenCalledWith("te", "te-sindhu"));
    expect(await screen.findByText("తెలుగు voice: Sindhu")).toBeInTheDocument();
    expect(select("te").value).toBe("te-sindhu");
    expect(refresh).toHaveBeenCalled();
    fireEvent.change(select("kn"), { target: { value: "kn-disha" } });
    await waitFor(() => expect(choose).toHaveBeenCalledWith("kn", null)); // Disha is the default of Kannada
  });
  it("a refusal is said in words and the dropdown goes back; a member who may not change it can listen but not choose", async () => {
    const choose = vi.fn(async () => ({ ok: false as const, error: "forbidden" }));
    draw({ choose });
    fireEvent.change(select("hi"), { target: { value: "hi-esha" } });
    expect(await screen.findByText("Only the Owner or an Admin can change the voice.", { selector: "[role=alert]" })).toBeInTheDocument();
    expect(select("hi").value).toBe("hi-sanya");
    cleanup();
    draw({ canEdit: false });
    expect(select("hi")).toBeDisabled();
    expect(document.querySelector('[data-play="hi-sanya"]')).not.toBeNull();
  });
  it("Hear plays the sample of the voice now selected, from this app's own route; one at a time; the sample line shows under it while it plays and goes when it stops", () => {
    const withText = rows.map((r) => ({ ...r, voices: r.voices.map((v) => (v.id === "hi-sanya" ? { ...v, sampleText: "नमस्ते, मैं संया हूँ।" } : v)) }));
    cleanup();
    render(<VoicePicker words={WORDS} gender="female" rows={withText} langNames={CALL_LANG_NAMES} canEdit endpoint="/app/tenants/t/voice-pick" mock={false} actions={{ choose: async () => ({ ok: true }), setGender: async () => ({ ok: true }) }} />);
    expect(document.querySelector('[data-part="sample-text"]')).toBeNull(); // nothing is shown before it plays
    const hi = document.querySelector('[data-play="hi-sanya"]') as HTMLElement;
    const te = document.querySelector('[data-play="te-ramya"]') as HTMLElement;
    fireEvent.click(hi);
    expect(made[0].src).toBe("/app/tenants/t/voice-pick?id=hi-sanya");
    expect(hi).toHaveAttribute("aria-pressed", "true");
    expect(document.querySelector('[data-voice-lang="hi"] [data-part="sample-text"]')).toHaveTextContent("नमस्ते, मैं संया हूँ।");
    fireEvent.click(te); // another row: the first stops
    expect(made[0].pause).toHaveBeenCalled();
    expect(hi).toHaveAttribute("aria-pressed", "false");
    expect(document.querySelector('[data-part="sample-text"]')).toBeNull(); // Ramya has no words given: nothing is made up
    fireEvent.click(te); // the same button stops
    expect(te).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(hi);
    fireEvent.change(select("hi"), { target: { value: "hi-esha" } }); // a new choice stops the sound too
    expect(made[made.length - 1].pause).toHaveBeenCalled();
    expect(document.querySelector('[data-voice-lang="hi"] [data-play="hi-esha"]')).not.toBeNull(); // Hear now plays the new one
  });
  it("a sample that cannot be played says so in words", async () => {
    draw();
    fireEvent.click(document.querySelector('[data-play="hi-sanya"]') as HTMLElement);
    made[0].onerror?.();
    expect(await screen.findByRole("alert")).toHaveTextContent(/could not be played/);
  });
  it("says that the sounds are test tones in the test mode", () => {
    draw({ mock: true });
    expect(screen.getByRole("note")).toHaveTextContent(/sounds are tones/);
  });
});
