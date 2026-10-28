import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

import { appDict } from "@/i18n/app";
import { CALL_LANG_NAMES } from "@/lib/assistant/types";
import { MOCK_VOICES, type PickerLang } from "@/lib/voice-picker/types";

import { VoicePicker, type VoiceRow } from "./VoicePicker";

const WORDS = Object.fromEntries(Object.keys(appDict("en")).filter((k) => k.startsWith("vp.")).map((k) => [k, (appDict("en") as Record<string, string>)[k]]));
const rows: VoiceRow[] = [
  { language: "hi", voices: MOCK_VOICES.filter((v) => v.language === "hi"), choice: null },
  { language: "kn", voices: MOCK_VOICES.filter((v) => v.language === "kn"), choice: "cartesia_kn_prakash" },
];
type Fake = { src: string; play: ReturnType<typeof vi.fn>; pause: ReturnType<typeof vi.fn>; onended: (() => void) | null; onerror: (() => void) | null };
let made: Fake[] = [];
const draw = (over: Partial<{ canEdit: boolean; mock: boolean; choose: (l: PickerLang, v: string | null) => Promise<{ ok: true } | { ok: false; error: string }> }> = {}) => {
  const choose = (over.choose ?? vi.fn(async () => ({ ok: true as const }))) as ReturnType<typeof vi.fn> & ((l: PickerLang, v: string | null) => Promise<{ ok: true } | { ok: false; error: string }>);
  render(<VoicePicker words={WORDS} rows={rows} langNames={CALL_LANG_NAMES} canEdit={over.canEdit ?? true} endpoint="/app/tenants/t/voice-pick" mock={over.mock ?? false} actions={{ choose }} />);
  return choose;
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
  it("has a block per language with a card for each approved voice: name, label, gender, the Default badge; the voice in use is ticked", () => {
    draw();
    const hi = document.querySelector('[data-voice-lang="hi"]') as HTMLElement;
    expect(within(hi).getAllByRole("listitem")).toHaveLength(3);
    expect(within(hi).getByText("Sanya")).toBeInTheDocument();
    expect(within(hi).getAllByText("Default")).toHaveLength(1);
    expect(document.querySelector('[data-voice="cartesia_hi_sanya"]')).toHaveAttribute("data-in-use", "true"); // nothing chosen: the default
    expect(document.querySelector('[data-voice="cartesia_kn_prakash"]')).toHaveAttribute("data-in-use", "true"); // chosen
    expect(document.querySelector('[data-voice="cartesia_kn_disha"]')).not.toHaveAttribute("data-in-use");
    expect(within(document.querySelector('[data-voice="cartesia_kn_prakash"]') as HTMLElement).getByText(/Male/)).toBeInTheDocument();
  });
  it("play and stop are one button, and only one sample plays at a time; the sample is asked of this app's own route", () => {
    draw();
    const sanya = document.querySelector('[data-play="cartesia_hi_sanya"]') as HTMLElement;
    const esha = document.querySelector('[data-play="cartesia_hi_esha"]') as HTMLElement;
    fireEvent.click(sanya);
    expect(made[0].src).toBe("/app/tenants/t/voice-pick?id=cartesia_hi_sanya");
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
    fireEvent.click(document.querySelector('[data-play="cartesia_hi_sanya"]') as HTMLElement);
    made[0].onerror?.();
    expect(await screen.findByRole("alert")).toHaveTextContent(/could not be played/);
  });
  it('"Use this voice" chooses it for that language and reads the page again; choosing the default goes back to it (null)', async () => {
    const choose = draw();
    fireEvent.click(within(document.querySelector('[data-voice="cartesia_hi_esha"]') as HTMLElement).getByRole("button", { name: "Use this voice" }));
    await waitFor(() => expect(choose).toHaveBeenCalledWith("hi", "cartesia_hi_esha"));
    expect(await screen.findByRole("status")).toHaveTextContent("Voice for हिन्दी saved");
    expect(refresh).toHaveBeenCalled();
    fireEvent.click(within(document.querySelector('[data-voice="cartesia_kn_disha"]') as HTMLElement).getByRole("button", { name: "Use this voice" }));
    await waitFor(() => expect(choose).toHaveBeenCalledWith("kn", null));
  });
  it("a refusal is said in words; a member who may not change it can listen but not choose", async () => {
    const choose = vi.fn(async () => ({ ok: false as const, error: "forbidden" }));
    draw({ choose });
    fireEvent.click(within(document.querySelector('[data-voice="cartesia_hi_esha"]') as HTMLElement).getByRole("button", { name: "Use this voice" }));
    expect(await screen.findByText("Only the Owner or an Admin can change the voice.", { selector: "[role=alert]" })).toBeInTheDocument();
    cleanup();
    draw({ canEdit: false });
    expect(within(document.querySelector('[data-voice="cartesia_hi_esha"]') as HTMLElement).getByRole("button", { name: "Use this voice" })).toBeDisabled();
    expect(document.querySelector('[data-play="cartesia_hi_esha"]')).not.toBeNull();
  });
  it("says that the sounds are test tones in the test mode", () => {
    draw({ mock: true });
    expect(screen.getByRole("note")).toHaveTextContent(/sounds are tones/);
  });
});
