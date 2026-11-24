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

const WORDS = Object.fromEntries(Object.entries(appDict("en") as Record<string, string>).filter(([k]) => k.startsWith("otp.") || k.startsWith("vt.")));
const prefsFor = (language: TalkLang, over: Partial<typeof MOCK_START> = {}, token: string | null = null, changed: TalkPrefs["changed"] = []) => mockPrefs(language, { ...MOCK_START, ...over }, token, changed);

function setup(over: Partial<TalkToYouActions> = {}, mock = true, ownerFirst: string | null = null) {
  const actions: TalkToYouActions = {
    load: vi.fn(async (l) => ({ ok: true as const, data: prefsFor(l) })),
    save: vi.fn(async (l, patch) => ({ ok: true as const, data: prefsFor(l, { ...("speed" in patch ? { speed: patch.speed as "slower" } : {}), ...("style" in patch ? { style: patch.style as "friendly" } : {}) }, "undo-token-1", [Object.keys(patch)[0] as "speed"]) })),
    undo: vi.fn(async (l) => ({ ok: true as const, data: prefsFor(l) })),
    preview: vi.fn(async () => ({ ok: true as const, data: { text: "Sample words", audio: null } })),
    ...over,
  };
  render(<TalkToYou words={WORDS} initial={prefsFor("te")} languages={["te", "kn", "hi", "en"]} first="te" langNames={CALL_LANG_NAMES} mock={mock} ownerFirst={ownerFirst} actions={actions} />);
  return actions;
}

const line = (id: "me-lang" | "me-style") => document.querySelector(`[data-setting-line="${id}"]`) as HTMLElement;
const pill = (id: "me-lang" | "me-style", n: 0 | 1) => within(line(id)).getAllByRole("combobox")[n] as HTMLSelectElement;
const optionsOf = (sel: HTMLSelectElement) => [...sel.options].map((o) => o.value);

describe("How it talks to you (made plain, owner 19 Nov 2026)", () => {
  it("is ONE card with two sentences with the choice inside, one live example, one help line and More choices; no chips", () => {
    setup();
    expect(screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent)).toEqual(["How it talks to you"]);
    expect(screen.queryByRole("heading", { level: 3 })).toBeNull(); // no Voice / Style / Calls you / Words / Speed headings with their own help
    expect(document.querySelector('[data-part="otp-peruser"]')).toHaveTextContent("Only yours. Your team chooses their own, and customers are not affected.");
    expect(line("me-lang")).toHaveTextContent("Talk to me in");
    expect(line("me-style")).toHaveTextContent("Be");
    expect(pill("me-lang", 0).value).toBe("te");
    expect(pill("me-lang", 1).value).toBe("normal");
    expect(pill("me-style", 0).value).toBe("respectful");
    expect(pill("me-style", 1).value).toBe("by_name");
    expect(document.querySelectorAll('[data-part="vt-me-example"]')).toHaveLength(1);
    expect(document.querySelector('[data-part="more-choices"]')).toHaveTextContent("More choices");
    expect(screen.getByText(/Test version: your choices/)).toBeInTheDocument();
    expect(document.querySelectorAll('[role="radio"]')).toHaveLength(0); // round radios (inputs), not chips
    expect(screen.queryByText(/Using defaults/)).toBeNull();
  });

  it("the example follows the style and the way it calls you, live", async () => {
    setup({ save: vi.fn(async (l, patch) => ({ ok: true as const, data: { ...prefsFor(l), ...patch, undoToken: "u", changed: [] } })) as never }, true, "Gowtham");
    const ex = () => document.querySelector('[data-part="vt-me-example"]') as HTMLElement;
    expect(ex()).toHaveTextContent("Gowtham, నమస్కారం. మూడు కొత్త enquiries వచ్చాయండి. కాల్ చెయ్యమంటారా?");
    fireEvent.change(pill("me-style", 1), { target: { value: "garu" } });
    await waitFor(() => expect(ex()).toHaveTextContent("Gowtham garu, నమస్కారం."));
  });

  it("the voices (under More choices) are named by their own names, filtered by female / male, as round radios with one play button each; never Warm, Calm or Bright", () => {
    setup();
    const voices = [...document.querySelectorAll("[data-voice]")].map((e) => e.textContent);
    expect(voices.join(" ")).toMatch(/Ramya.*Kavitha/s);
    expect(voices.join(" ")).not.toMatch(/Warm|Calm|Bright/);
    expect(document.querySelectorAll("[data-voice]")).toHaveLength(2);
    expect(document.querySelectorAll('[data-voice] input[type="radio"]')).toHaveLength(2);
    expect(document.querySelectorAll("[data-voice] button")).toHaveLength(2);
    fireEvent.click(document.querySelector('[data-gender="male"]') as HTMLElement);
    expect([...document.querySelectorAll("[data-voice]")].map((e) => e.getAttribute("data-voice"))).toEqual(["te-karthik", "te-naveen"]);
  });

  it("'call me' offers what the language has: anna / akka and garu in Telugu, no garu in Hindi, only name and sir / madam in English", { timeout: 15_000 }, async () => {
    const a = setup();
    expect(optionsOf(pill("me-style", 1))).toEqual(["by_name", "garu", "sir_madam", "anna_akka"]);
    fireEvent.change(pill("me-lang", 0), { target: { value: "hi" } });
    await waitFor(() => expect(a.load).toHaveBeenCalledWith("hi"));
    await waitFor(() => expect(optionsOf(pill("me-style", 1))).toEqual(["by_name", "sir_madam", "anna_akka"]), { timeout: 4000 });
    await waitFor(() => expect(pill("me-lang", 0)).toBeEnabled(), { timeout: 4000 });
    fireEvent.change(pill("me-lang", 0), { target: { value: "en" } });
    await waitFor(() => expect(optionsOf(pill("me-style", 1))).toEqual(["by_name", "sir_madam"]), { timeout: 4000 });
  });

  it("'Pure' says the language's own name", () => {
    setup();
    expect(screen.getByRole("radio", { name: "Pure తెలుగు" })).toBeInTheDocument();
  });

  it("a choice saves that one change at once, says 'Saved, only for you' with Undo; Undo puts it back", async () => {
    const a = setup();
    fireEvent.change(pill("me-lang", 1), { target: { value: "slower" } });
    await waitFor(() => expect(a.save).toHaveBeenCalledWith("te", { speed: "slower" }));
    expect(await screen.findByText("Saved, only for you.")).toBeInTheDocument();
    expect(pill("me-lang", 1).value).toBe("slower");
    const undoButton = within(document.querySelector('[data-part="otp-saved"]') as HTMLElement).getByRole("button", { name: "Undo" });
    await waitFor(() => expect(undoButton).toBeEnabled()); // the save's transition is over (a busy button ignores a tap)
    fireEvent.click(undoButton);
    await waitFor(() => expect(a.undo).toHaveBeenCalledWith("te", "undo-token-1"));
    await screen.findByText("Undone.");
    expect(pill("me-lang", 1).value).toBe("normal");
  });

  it("every field saves its own payload: style, address, words and voice", async () => {
    const a = setup();
    fireEvent.change(pill("me-style", 0), { target: { value: "friendly" } });
    await waitFor(() => expect(a.save).toHaveBeenLastCalledWith("te", { style: "friendly" }));
    await waitFor(() => expect(pill("me-style", 0)).toBeEnabled());
    fireEvent.change(pill("me-style", 1), { target: { value: "garu" } });
    await waitFor(() => expect(a.save).toHaveBeenLastCalledWith("te", { address: "garu" }));
    await waitFor(() => expect(pill("me-style", 1)).toBeEnabled());
    fireEvent.click(screen.getByRole("radio", { name: "More English" }));
    await waitFor(() => expect(a.save).toHaveBeenLastCalledWith("te", { words: "more_english" }));
    await waitFor(() => expect(screen.getByRole("radio", { name: "More English" })).toBeEnabled());
    fireEvent.click(within(document.querySelector('[data-voice="te-kavitha"]') as HTMLElement).getByRole("radio"));
    await waitFor(() => expect(a.save).toHaveBeenLastCalledWith("te", { voice: "te-kavitha" }));
  });

  it("choosing what is already chosen saves nothing", () => {
    const a = setup();
    fireEvent.change(pill("me-style", 0), { target: { value: "respectful" } });
    expect(a.save).not.toHaveBeenCalled();
  });

  it("a refused save says so in words and keeps the old choice", async () => {
    const a = setup({ save: vi.fn(async () => ({ ok: false as const, error: "invalid" as const })) });
    fireEvent.change(pill("me-style", 0), { target: { value: "friendly" } });
    await screen.findByText("That choice isn't available.");
    expect(a.save).toHaveBeenCalled();
    expect(pill("me-style", 0).value).toBe("respectful");
  });

  it("ONE 'Hear it' plays the chosen style; without audio (the test version) it says no sound yet and never claims a voice", async () => {
    const a = setup();
    fireEvent.click(screen.getByRole("button", { name: "Hear it" }));
    await waitFor(() => expect(a.preview).toHaveBeenCalledWith("te", { style: "respectful" }));
    expect(await screen.findByText("Test version: no sound yet.")).toBeInTheDocument();
  });

  it("a sample with audio is played from a blob (also a voice's own button); a limit is said in words", async () => {
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
    fireEvent.click(screen.getByRole("button", { name: "Hear it: Ramya" }));
    await waitFor(() => expect(played).toEqual(["blob:sample"]));
    expect(screen.queryByText(/Test version: no sound yet/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Hear it: Kavitha" }));
    await screen.findByText("Too many samples. Wait a minute and try again.");
  });

  it("a failed language load says so", async () => {
    setup({ load: vi.fn(async () => ({ ok: false as const, error: "down" as const })) });
    await act(async () => void fireEvent.change(pill("me-lang", 0), { target: { value: "kn" } }));
    await screen.findByText("Couldn't do that. Try again.");
  });
});

describe("How it talks to you, plain fields (SETTINGS_OPEN, owner 25 Nov 2026: no fill-in-the-blank sentences)", () => {
  function plainSetup(save?: TalkToYouActions["save"]) {
    const actions: TalkToYouActions = {
      load: vi.fn(async (l) => ({ ok: true as const, data: prefsFor(l) })),
      save: save ?? (vi.fn(async (l, patch) => ({ ok: true as const, data: { ...prefsFor(l, { ...MOCK_START, ...patch } as never, "u1"), undoToken: "u1" } })) as never),
      undo: vi.fn(async (l) => ({ ok: true as const, data: prefsFor(l) })),
      preview: vi.fn(async () => ({ ok: true as const, data: { text: "Sample words", audio: null } })),
    };
    render(<TalkToYou words={WORDS} initial={prefsFor("te")} languages={["te", "kn", "hi", "en"]} first="te" langNames={CALL_LANG_NAMES} mock ownerFirst="Gowtham" actions={actions} plain />);
    return actions;
  }

  it("has four labelled fields with a one-line hint each and ONE Save, and no sentence with a blank in it", () => {
    plainSetup();
    for (const label of ["Language", "Speed", "Tone", "Call me"]) expect(screen.getByLabelText(label)).toBeInstanceOf(HTMLSelectElement);
    expect(document.querySelectorAll("[data-setting-line]")).toHaveLength(0);
    expect(document.body.textContent).not.toMatch(/Talk to me in|and call me|\[/);
    expect(screen.getAllByRole("button", { name: "Save" })).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    expect(screen.getByText("The language it talks to you in.")).toBeInTheDocument();
  });

  it("nothing is saved until Save: the example follows the choices, then Save sends one request per changed field", async () => {
    const a = plainSetup();
    fireEvent.change(screen.getByLabelText("Tone"), { target: { value: "friendly" } });
    fireEvent.change(screen.getByLabelText("Call me"), { target: { value: "garu" } });
    expect(a.save).not.toHaveBeenCalled();
    expect(screen.getByText("You have unsaved changes.")).toBeInTheDocument();
    expect(document.querySelector('[data-part="vt-me-example"]')).toHaveTextContent("హాయ్ Gowtham garu!"); // the friendly sample, calling the owner by name + garu, before anything is saved
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(a.save).toHaveBeenCalledTimes(2));
    expect((a.save as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[1])).toEqual([{ style: "friendly" }, { address: "garu" }]);
    await screen.findByText("Saved, only for you.");
    expect(screen.queryByRole("button", { name: /Undo/ })).toBeNull(); // two changes: no single Undo
  });

  it("changing the language still loads that language's choices", async () => {
    const a = plainSetup();
    fireEvent.change(screen.getByLabelText("Language"), { target: { value: "en" } });
    await waitFor(() => expect(a.load).toHaveBeenCalledWith("en"));
  });
});
