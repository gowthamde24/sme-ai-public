import { act, cleanup, configure, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { appDict } from "@/i18n/app";
import { CALL_LANG_NAMES } from "@/lib/assistant/types";
import { mockPrefs, MOCK_START } from "@/lib/talk-prefs/mock";
import type { TalkLang, TalkPrefs } from "@/lib/talk-prefs/types";

import { TalkToYou, type TalkToYouActions } from "./TalkToYou";

// a busy CI worker is slow: the default one second is not enough for a lazy server-action round trip
configure({ asyncUtilTimeout: 5000 });
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const WORDS = Object.fromEntries(Object.entries(appDict("en") as Record<string, string>).filter(([k]) => k.startsWith("otp.") || k.startsWith("mya.v.")));
const prefsFor = (language: TalkLang, over: Partial<typeof MOCK_START> = {}, token: string | null = null, changed: TalkPrefs["changed"] = []) => mockPrefs(language, { ...MOCK_START, ...over }, token, changed);

function setup(over: Partial<TalkToYouActions> = {}, mock = true) {
  const actions: TalkToYouActions = {
    load: vi.fn(async (l) => ({ ok: true as const, data: prefsFor(l) })),
    save: vi.fn(async (l, patch) => ({ ok: true as const, data: prefsFor(l, { ...("speed" in patch ? { speed: patch.speed as "slower" } : {}), ...("style" in patch ? { style: patch.style as "friendly" } : {}) }, "undo-token-1", [Object.keys(patch)[0] as "speed"]) })),
    undo: vi.fn(async (l) => ({ ok: true as const, data: prefsFor(l) })),
    preview: vi.fn(async () => ({ ok: true as const, data: { text: "Sample words", audio: null } })),
    ...over,
  };
  render(<TalkToYou words={WORDS} initial={prefsFor("te")} languages={["te", "kn", "hi", "en"]} first="te" langNames={CALL_LANG_NAMES} mock={mock} actions={actions} />);
  return actions;
}

describe("How it talks to you", () => {
  it("has the five groups, the per-person note, and says it is using defaults for a new person", () => {
    setup();
    for (const g of ["voice", "style", "address", "words", "speed"]) expect(document.querySelector(`[data-group="${g}"]`)).not.toBeNull();
    expect(screen.getByRole("heading", { name: "How it talks to you" })).toBeInTheDocument();
    expect(document.querySelector('[data-part="otp-peruser"]')).toHaveTextContent("only yours");
    expect(document.querySelector('[data-part="otp-defaults"]')).toHaveTextContent("Respectful, normal speed");
    expect(document.querySelector('[data-option="style:respectful"]')).toHaveAttribute("aria-checked", "true");
    expect(document.querySelector('[data-option="speed:normal"]')).toHaveAttribute("aria-checked", "true");
    expect(screen.getByText(/Test version: your choices/)).toBeInTheDocument();
  });

  it("the voices are named by their sound (no person's name), filtered by female / male", () => {
    setup();
    const voices = [...document.querySelectorAll("[data-voice]")].map((e) => e.textContent);
    expect(voices.join(" ")).toMatch(/Warm.*Calm.*Bright/s);
    expect(document.querySelectorAll("[data-voice]")).toHaveLength(3);
    fireEvent.click(document.querySelector('[data-gender="male"]') as HTMLElement);
    expect([...document.querySelectorAll("[data-voice]")].map((e) => e.getAttribute("data-voice"))).toEqual(["te-mock-m-warm", "te-mock-m-calm", "te-mock-m-bright"]);
  });

  it("'Calls you' offers what the language has: anna / akka and garu in Telugu, no garu in Hindi, only name and sir / madam in English", { timeout: 15_000 }, async () => {
    const a = setup();
    const opts = () => [...document.querySelectorAll('[data-option^="address:"]')].map((e) => e.getAttribute("data-option")?.slice(8));
    expect(opts()).toEqual(["by_name", "garu", "sir_madam", "anna_akka"]);
    fireEvent.click(document.querySelector('[data-lang="hi"]') as HTMLElement);
    await waitFor(() => expect(a.load).toHaveBeenCalledWith("hi"));
    await waitFor(() => expect(opts()).toEqual(["by_name", "sir_madam", "anna_akka"]), { timeout: 4000 });
    // the language chips are disabled while a change is still settling: wait for them (a click on a disabled chip is ignored, which made this flaky on a loaded runner)
    await waitFor(() => expect(document.querySelector('[data-lang="en"]')).toBeEnabled(), { timeout: 4000 });
    fireEvent.click(document.querySelector('[data-lang="en"]') as HTMLElement);
    await waitFor(() => expect(opts()).toEqual(["by_name", "sir_madam"]), { timeout: 4000 });
  });

  it("'Pure' says the language's own name", async () => {
    setup();
    expect(document.querySelector('[data-option="words:pure"]')).toHaveTextContent("Pure తెలుగు");
  });

  it("a tap saves that one change at once, says 'Saved, only for you' with Undo; Undo puts it back", async () => {
    const a = setup();
    fireEvent.click(document.querySelector('[data-option="speed:slower"]') as HTMLElement);
    await waitFor(() => expect(a.save).toHaveBeenCalledWith("te", { speed: "slower" }));
    const saved = await screen.findByText("Saved, only for you.");
    expect(saved).toBeInTheDocument();
    expect(document.querySelector('[data-option="speed:slower"]')).toHaveAttribute("aria-checked", "true");
    const undoButton = within(document.querySelector('[data-part="otp-saved"]') as HTMLElement).getByRole("button", { name: "Undo" });
    await waitFor(() => expect(undoButton).toBeEnabled()); // the save's transition is over (a busy button ignores a tap)
    fireEvent.click(undoButton);
    await waitFor(() => expect(a.undo).toHaveBeenCalledWith("te", "undo-token-1"));
    await screen.findByText("Undone.");
    expect(document.querySelector('[data-option="speed:normal"]')).toHaveAttribute("aria-checked", "true");
  });

  it("tapping what is already chosen saves nothing", () => {
    const a = setup();
    fireEvent.click(document.querySelector('[data-option="style:respectful"]') as HTMLElement);
    expect(a.save).not.toHaveBeenCalled();
  });

  it("a refused save says so in words and keeps the old choice", async () => {
    const a = setup({ save: vi.fn(async () => ({ ok: false as const, error: "invalid" as const })) });
    fireEvent.click(document.querySelector('[data-option="style:friendly"]') as HTMLElement);
    await screen.findByText("That choice isn't available.");
    expect(a.save).toHaveBeenCalled();
    expect(document.querySelector('[data-option="style:respectful"]')).toHaveAttribute("aria-checked", "true");
  });

  it("'Hear it' of an option shows the sample; without audio (the test version) it says no sound yet and never claims a voice", async () => {
    const a = setup();
    fireEvent.click(screen.getByRole("button", { name: "Hear it: Friendly" }));
    await waitFor(() => expect(a.preview).toHaveBeenCalledWith("te", { style: "friendly" }));
    const sample = await screen.findByText("Sample words");
    expect(sample.closest('[data-part="otp-sample"]')).toHaveTextContent("Test version: no sound yet.");
  });

  it("a sample with audio is played from a blob; a limit is said in words", async () => {
    const played: string[] = [];
    class FakeAudio {
      onended: (() => void) | null = null;
      onerror: (() => void) | null = null;
      constructor(public src: string) {}
      play() {
        played.push(this.src);
        return Promise.resolve();
      }
      pause() {}
    }
    vi.stubGlobal("Audio", FakeAudio);
    URL.createObjectURL = vi.fn(() => "blob:sample");
    URL.revokeObjectURL = vi.fn();
    const preview = vi.fn().mockResolvedValueOnce({ ok: true as const, data: { text: "Real sample", audio: { contentType: "audio/wav", base64: "AAAA" } } }).mockResolvedValueOnce({ ok: false as const, error: "limit" as const });
    setup({ preview }, false);
    fireEvent.click(screen.getByRole("button", { name: "Hear it: Calm" }));
    await waitFor(() => expect(played).toEqual(["blob:sample"]));
    expect(screen.queryByText(/Test version: no sound yet/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Hear it: Slower" }));
    await screen.findByText("Too many samples. Wait a minute and try again.");
  });

  it("a failed language load says so", async () => {
    setup({ load: vi.fn(async () => ({ ok: false as const, error: "down" as const })) });
    await act(async () => void fireEvent.click(document.querySelector('[data-lang="kn"]') as HTMLElement));
    await screen.findByText("Couldn't do that. Try again.");
  });
});
