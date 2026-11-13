import { offeredLangs } from "@/lib/languages";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CALL_LANG_NAMES } from "@/lib/assistant/types";
import type { TalkTrainingState } from "@/lib/talk-training/types";

import { NO_FRAME_DATA } from "../contract";
import { FrameDataSlot } from "../frame-store";
import { AskVoiceContext } from "../today/ask/ask-store";
import { VoiceInputOptionsContext } from "../voice-input/use-voice-input";
import { insertAt, voiceAllowed } from "../voice-input/VoiceMic";
import { TalkTraining } from "./TalkTraining";

const DOC = { greeting: {}, address: "plain" as const, questions: ["What is the saree for?"], neverSay: ["guaranteed"], objections: [{ a: "Too costly", b: "We have sarees in many ranges." }], examples: [], sayLike: [], introduceAs: null };
const DEFAULTS: TalkTrainingState = { training: DOC, defaults: { ...DOC, greeting: { te: "నమస్తే, నేను AI అసిస్టెంట్‌ని." } }, saved: false, rules: ["Always says it is an AI."], updatedAt: null };
const SAVED: TalkTrainingState = { ...DEFAULTS, saved: true, training: { ...DOC, questions: ["What is the saree for?", "Which colours?"] } };
afterEach(cleanup);
const show = (initial: TalkTrainingState, actions = { save: vi.fn(), reset: vi.fn() }, canEdit = true) =>
  render(<TalkTraining initial={initial} langNames={CALL_LANG_NAMES} canEdit={canEdit} securityHref="/app/security" actions={actions} />);

describe("How I talk to customers", () => {
  it("shows the suggested answers, the greeting's default as a hint, and the platform's own rules read-only", () => {
    show(DEFAULTS);
    expect(screen.getByText("These are the suggested answers for your kind of business. Change anything and save.")).toBeInTheDocument();
    expect(screen.getByLabelText("Greeting")).toHaveAttribute("placeholder", "నమస్తే, నేను AI అసిస్టెంట్‌ని.");
    expect(screen.getByRole("radio", { name: /Plainly/ })).toBeChecked();
    expect(screen.getByLabelText("Question 1")).toHaveValue("What is the saree for?");
    expect(document.querySelector('[data-part="tt-rules"]')).toHaveTextContent("Always says it is an AI.");
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled(); // nothing changed yet
    expect(screen.queryByRole("button", { name: "Use the suggested ones" })).toBeNull(); // nothing of the owner's to remove
  });

  it("the suggested greeting's hint names the business (C1 #364); {business} stays in what is saved", () => {
    const withBiz: TalkTrainingState = { ...DEFAULTS, defaults: { ...DEFAULTS.defaults, greeting: { te: "నమస్కారం, నేను {business} AI assistant ని." } } };
    render(<TalkTraining initial={withBiz} langNames={CALL_LANG_NAMES} canEdit securityHref="/app/security" business="Lakshmi Silks" actions={{ save: vi.fn(), reset: vi.fn() }} />);
    expect(screen.getByLabelText("Greeting")).toHaveAttribute("placeholder", "నమస్కారం, నేను Lakshmi Silks AI assistant ని.");
    expect(screen.getByLabelText("Greeting")).toHaveValue("");
  });

  it("adds a question, saves the whole document and shows what the API answered", async () => {
    const save = vi.fn(async () => ({ ok: true as const, data: SAVED }));
    show(DEFAULTS, { save, reset: vi.fn() });
    fireEvent.click(screen.getByRole("button", { name: "Add a question" }));
    fireEvent.change(screen.getByLabelText("Question 2"), { target: { value: "Which colours?" } });
    fireEvent.click(screen.getByRole("radio", { name: /Garu/ }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.getByText("Saved. Your assistant talks this way from the next call.")).toBeInTheDocument());
    expect(save).toHaveBeenCalledWith({ ...DOC, address: "garu", questions: ["What is the saree for?", "Which colours?"] });
    expect(screen.getByRole("radio", { name: /Plainly/ })).toBeChecked(); // the API's answer, not what was sent
  });

  it("goes back to the suggested ones only after a second yes", async () => {
    const reset = vi.fn(async () => ({ ok: true as const, data: DEFAULTS }));
    show(SAVED, { save: vi.fn(), reset });
    fireEvent.click(screen.getByRole("button", { name: "Use the suggested ones" }));
    expect(reset).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Yes, use the suggested ones" }));
    await waitFor(() => expect(screen.getByText("Back to the suggested ones.")).toBeInTheDocument());
    expect(screen.queryByLabelText("Question 2")).toBeNull();
  });

  it("says a refusal in words: a price or promise, or the missing two-step code with a link to Security", async () => {
    const save = vi.fn().mockResolvedValueOnce({ ok: false, error: "price_or_promise" }).mockResolvedValueOnce({ ok: false, error: "mfa" });
    show(DEFAULTS, { save, reset: vi.fn() });
    fireEvent.change(screen.getByLabelText("Never say 1"), { target: { value: "lowest price" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Please take out amounts, percentages and promises"));
    // the button says "Saving…" until the first answer has settled (a slow machine): press it again only once it is "Save" again
    fireEvent.click(await screen.findByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.getByRole("link", { name: "Open Security" })).toHaveAttribute("href", "/app/security"));
  });

  it("app v4: \"Say it like this\" is edited, saved with the rest, and shown in what goes into the instructions", async () => {
    const save = vi.fn(async () => ({ ok: true as const, data: SAVED }));
    render(<TalkTraining initial={DEFAULTS} langNames={CALL_LANG_NAMES} canEdit securityHref="/app/security" actions={{ save, reset: vi.fn() }} v4 />);
    const preview = () => document.querySelector('[data-part="tt-preview"]')!;
    expect(preview()).toHaveTextContent('"guaranteed"');
    fireEvent.click(screen.getByRole("button", { name: "Add a word" }));
    fireEvent.change(screen.getByLabelText("Say"), { target: { value: "pattu cheera" } });
    fireEvent.change(screen.getByLabelText("Instead of (optional)"), { target: { value: "silk saree" } });
    expect(preview()).toHaveTextContent('"pattu cheera" (not "silk saree")');
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(save).toHaveBeenCalledWith({ ...DOC, sayLike: [{ say: "pattu cheera", insteadOf: "silk saree" }] }));
  });

  it("app v4 with an API that does not know \"Say it like this\" yet: no editor for it, and a save does not send it", async () => {
    const save = vi.fn(async () => ({ ok: true as const, data: SAVED }));
    const older: TalkTrainingState = { ...DEFAULTS, training: { ...DOC, sayLike: null } };
    render(<TalkTraining initial={older} langNames={CALL_LANG_NAMES} canEdit securityHref="/app/security" actions={{ save, reset: vi.fn() }} v4 />);
    expect(document.querySelector('[data-part="tt-say"]')).toBeNull();
    expect(document.querySelector('[data-part="tt-preview"]')).not.toHaveTextContent("Say it like this");
    fireEvent.click(screen.getByRole("radio", { name: /Garu/ }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(save).toHaveBeenCalledWith({ ...DOC, sayLike: null, address: "garu" }));
  });

  it("without v4 there is no say-like editor, no instructions box and no practice", () => {
    render(<TalkTraining initial={DEFAULTS} langNames={CALL_LANG_NAMES} canEdit securityHref="/app/security" actions={{ save: vi.fn(), reset: vi.fn() }} practice={vi.fn()} />);
    for (const part of ["tt-say", "tt-preview", "tt-practice"]) expect(document.querySelector(`[data-part="${part}"]`)).toBeNull();
  });

  it("app v4: a practice call in text, with the unsaved changes; a refusal puts the line back", async () => {
    const practice = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, data: { reply: "Namaste! Which saree are you looking for?", ended: false, handover: false } })
      .mockResolvedValueOnce({ ok: false, error: "busy" })
      .mockResolvedValueOnce({ ok: true, data: { reply: "Thank you for calling. Bye!", ended: true, handover: false } });
    render(<TalkTraining initial={DEFAULTS} langNames={CALL_LANG_NAMES} canEdit securityHref="/app/security" actions={{ save: vi.fn(), reset: vi.fn() }} v4 practice={practice} />);
    const box = () => screen.getByLabelText("What the customer says");
    fireEvent.change(box(), { target: { value: "Do you have Kanchi silk?" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(screen.getByText("Namaste! Which saree are you looking for?")).toBeInTheDocument());
    expect(practice).toHaveBeenLastCalledWith("te", [{ who: "customer", text: "Do you have Kanchi silk?" }], null); // nothing changed: the saved training
    fireEvent.change(screen.getByLabelText("Never say 1"), { target: { value: "lowest price" } });
    fireEvent.change(box(), { target: { value: "Too costly" } });
    fireEvent.click(await screen.findByRole("button", { name: "Send" })); // (it says "Answering…" until the first answer has settled)
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("That's a lot of practice this hour."));
    expect(box()).toHaveValue("Too costly");
    expect(practice.mock.calls[1][2]).toMatchObject({ neverSay: ["lowest price"] }); // the unsaved change is tried
    fireEvent.click(await screen.findByRole("button", { name: "Send" }));
    await waitFor(() => expect(screen.getByText("The call ended here.")).toBeInTheDocument());
    expect(screen.queryByLabelText("What the customer says")).toBeNull();
    expect(Array.from(document.querySelectorAll('[data-part="tt-practice-turns"] > li')).map((li) => li.getAttribute("data-who"))).toEqual(["customer", "assistant", "customer", "assistant"]);
    fireEvent.click(await screen.findByRole("button", { name: "Start again" }));
    await waitFor(() => expect(document.querySelector('[data-part="tt-practice-turns"]')).toBeNull());
  });

  it("app v4: practice by voice opens the Live talk socket in practice_call mode with the chosen language; End stops it; unsaved changes are pointed out", async () => {
    const sent: string[] = [];
    const socket = { binaryType: "", readyState: 0, send: (d: unknown) => void sent.push(String(d)), close: vi.fn(), onopen: null as null | (() => void), onmessage: null, onclose: null as null | ((e: { code: number; reason: string }) => void), onerror: null };
    const audio = { startMic: vi.fn(async () => undefined), stopMic: vi.fn(), play: vi.fn(), flush: vi.fn(), playing: () => false, close: vi.fn(), analyser: () => null };
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ token: "tok" }), { status: 200, headers: { "content-type": "application/json" } })));
    const { VoicePractice } = await import("./VoicePractice");
    const W = { "tt.voice.start": "Practice by voice", "tt.voice.stop": "End the practice call", "tt.voice.unsaved": "You have changes that are not saved", "tt.voice.connecting": "Connecting…" };
    render(<VoicePractice w={W} url="wss://api/v1/tenants/t/voice-chat" tokenUrl="/t" language="te" unsaved audioFactory={() => audio} socketFactory={() => socket as never} />);
    expect(screen.getByText("You have changes that are not saved")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Practice by voice" }));
    await waitFor(() => expect(socket.onopen).not.toBeNull());
    socket.readyState = 1;
    socket.onopen?.();
    expect(JSON.parse(sent[0])).toMatchObject({ type: "start", access_token: "tok", language: "te", mode: "practice_call" });
    fireEvent.click(await screen.findByRole("button", { name: "End the practice call" }));
    expect(sent.some((m) => m.includes('"stop"'))).toBe(true);
    vi.unstubAllGlobals();
  });

  it("app v4: the page's order is the greeting and tone, then never say, then the rest; the greeting languages are the one shared list: English, Telugu, Hindi, Kannada (the others only with MORE_LANGUAGES)", () => {
    render(<TalkTraining initial={DEFAULTS} langNames={CALL_LANG_NAMES} canEdit securityHref="/app/security" actions={{ save: vi.fn(), reset: vi.fn() }} v4 />);
    const chips = Array.from(document.querySelectorAll('[data-part="tt-greeting"] [role="group"] button')).map((b) => b.textContent?.replace(/[·\s]+$/, ""));
    expect(chips).toEqual(["English", "తెలుగు", "हिन्दी", "ಕನ್ನಡ"]);
    const order = ["tt-greeting", "tt-address", "tt-never", "tt-questions", "tt-objections"].map((p) => Array.from(document.querySelectorAll("[data-part]")).findIndex((e) => e.getAttribute("data-part") === p));
    expect(order.every((n) => n >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    cleanup();
    show(DEFAULTS); // the same list without v4
    expect(document.querySelectorAll('[data-part="tt-greeting"] [role="group"] button').length).toBe(4);
    cleanup();
    render(<TalkTraining initial={DEFAULTS} langNames={CALL_LANG_NAMES} canEdit securityHref="/app/security" actions={{ save: vi.fn(), reset: vi.fn() }} offered={offeredLangs(true)} />);
    expect(document.querySelectorAll('[data-part="tt-greeting"] [role="group"] button').length).toBe(7); // the flag adds Tamil, Malayalam, Marathi
    cleanup();
    const withTamil = { ...DEFAULTS, training: { ...DEFAULTS.training, greeting: { ta: "வணக்கம் {business}" } } };
    render(<TalkTraining initial={withTamil} langNames={CALL_LANG_NAMES} canEdit securityHref="/app/security" actions={{ save: vi.fn(), reset: vi.fn() }} />);
    expect(Array.from(document.querySelectorAll('[data-part="tt-greeting"] [role="group"] button')).map((b) => b.textContent?.replace(/[·\s]+$/, ""))).toEqual(["English", "తెలుగు", "हिन्दी", "ಕನ್ನಡ", "தமிழ்"]); // a saved Tamil greeting stays visible
  });

  it("Introduce as (C1, 11 Nov): drawn only where the API has the field; the rules, a live preview, what is wrong as it is typed, and Save waits for a good one", async () => {
    show(DEFAULTS);
    expect(document.querySelector('[data-part="tt-introduce"]')).toBeNull(); // an API without the field: nothing of it
    cleanup();
    const biz = { ...DEFAULTS, training: { ...DOC, introduceAs: { kind: "business" as const, text: null } } };
    const save = vi.fn().mockResolvedValue({ ok: true, data: biz });
    render(<TalkTraining initial={biz} langNames={CALL_LANG_NAMES} canEdit securityHref="/app/security" business="Lakshmi Silks" actions={{ save, reset: vi.fn() }} />);
    const box = document.querySelector('[data-part="tt-introduce"]') as HTMLElement;
    expect(within(box).getByRole("radio", { name: /The business name/ })).toBeChecked();
    expect(box.querySelector('[data-part="tt-intro-preview"]')).toHaveTextContent("Hello, this is the AI assistant of Lakshmi Silks.");
    expect(box).toHaveTextContent("Calls to your customers from Lead Desk keep the business name for now.");
    fireEvent.click(within(box).getByRole("radio", { name: "My name" }));
    fireEvent.change(screen.getByLabelText("Your name"), { target: { value: "Gowtham" } });
    expect(box.querySelector('[data-part="tt-intro-preview"]')).toHaveTextContent("Hello, this is Gowtham's AI assistant.");
    fireEvent.change(screen.getByLabelText("Your name"), { target: { value: "Gowtham 2" } });
    expect(box.querySelector('[data-part="tt-intro-msg"]')).toHaveTextContent("Take out the numbers.");
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    fireEvent.click(within(box).getByRole("radio", { name: "My own words" }));
    fireEvent.change(screen.getByLabelText("Your own words"), { target: { value: "a human assistant" } });
    expect(box.querySelector('[data-part="tt-intro-msg"]')).toHaveTextContent("Never say human or person");
    fireEvent.change(screen.getByLabelText("Your own words"), { target: { value: "Gowtham's AI assistant" } });
    expect(box.querySelector('[data-part="tt-intro-preview"]')).toHaveTextContent("Hello, this is Gowtham's AI assistant.");
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(save).toHaveBeenCalledWith(expect.objectContaining({ introduceAs: { kind: "custom", text: "Gowtham's AI assistant" } })));
  });
  it("an Admin reads it and changes nothing", () => {
    show(SAVED, undefined, false);
    expect(screen.getByText("Only the owner can change this.")).toBeInTheDocument();
    expect(screen.getByLabelText("Question 1")).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Add a question" })).toBeNull();
  });
});

describe("voice typing on Train how it talks (owner decision, 9 Nov 2026)", () => {
  const NAMES = { te: "తెలుగు", en: "English", hi: "हिन्दी", kn: "ಕನ್ನಡ", ta: "தமிழ்", ml: "മലയാളം", mr: "मराठी" };
  const VOICE = { words: {}, url: "wss://api/v1/tenants/t/voice-chat", language: "te" as const, languageNames: NAMES, tokenUrl: "/app/tenants/t/voice-token", speechUrl: "/app/tenants/t/speech-transcribe" };
  /** A recorder that records nothing: the level is whatever the test says, and stop() gives a small blob. */
  const makeRecorder = (denied = false) => {
    const r = { level: 0, started: 0, stopped: 0, cancelled: 0, start: vi.fn(async () => { if (denied) throw new Error("denied"); r.started += 1; }), stop: vi.fn(async () => { r.stopped += 1; return new Blob([new Uint8Array(64)], { type: "audio/webm" }); }), cancel: vi.fn(() => void (r.cancelled += 1)) };
    return Object.assign(r, { levelFn: () => r.level });
  };
  const setup = (o: { v4?: boolean; supported?: boolean; maxSeconds?: number; denied?: boolean; school?: boolean; answer?: { status: number; body: unknown }; actions?: React.ComponentProps<typeof TalkTraining>["actions"] } = {}) => {
    const rec = makeRecorder(o.denied);
    const recorder = { start: rec.start, stop: rec.stop, cancel: rec.cancel, level: rec.levelFn };
    const upload = vi.fn(async (_url: string, init: { body: FormData }) => {
      void init;
      const a = o.answer ?? { status: 200, body: { text: "namaste", language: "te" } };
      return new Response(JSON.stringify(a.body), { status: a.status, headers: { "content-type": "application/json" } });
    });
    vi.stubGlobal("fetch", upload);
    const frame = { ...NO_FRAME_DATA, v4: o.v4 !== false, pack: o.school ? ({ modules: ["programmes"] } as never) : null };
    const actions = o.actions ?? ({ save: vi.fn(), reset: vi.fn() } as never as React.ComponentProps<typeof TalkTraining>["actions"]);
    render(
      <>
        <FrameDataSlot data={frame} />
        <AskVoiceContext.Provider value={VOICE}>
          <VoiceInputOptionsContext.Provider value={{ recorderFactory: () => recorder, supported: o.supported !== false, ...(o.maxSeconds ? { maxSeconds: o.maxSeconds } : {}) }}>
            <TalkTraining initial={DEFAULTS} langNames={CALL_LANG_NAMES} canEdit securityHref="/app/security" actions={actions} v4 />
          </VoiceInputOptionsContext.Provider>
        </AskVoiceContext.Provider>
      </>,
    );
    return { rec, upload, actions };
  };
  const mics = () => screen.findAllByRole("button", { name: "Speak instead of typing" });
  const stopTap = () => fireEvent.click(screen.getByRole("button", { name: "Listening… tap to stop" }));
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it("every free-text field has a microphone under it, 44 px at least, named for a screen reader; the greeting's is first", async () => {
    setup();
    const all = await mics();
    expect(all.length).toBeGreaterThanOrEqual(5);
    expect(all[0].className).toContain("min-h-11");
    expect(document.querySelector('[data-part="tt-greeting"] [data-voice-mic]')).not.toBeNull();
  });

  it("without app v4, in a browser that cannot record, and with no speech address for the workspace there is no microphone at all", async () => {
    setup({ v4: false });
    await new Promise((r) => setTimeout(r, 30));
    expect(screen.queryByRole("button", { name: "Speak instead of typing" })).toBeNull();
    cleanup();
    setup({ supported: false });
    await new Promise((r) => setTimeout(r, 30));
    expect(screen.queryByRole("button", { name: "Speak instead of typing" })).toBeNull();
  });

  it("the words go in at the caret and replace nothing; the recording goes to the workspace's own route with the language and is never kept; nothing is saved; Undo takes it out; the first time says the voice is not saved", async () => {
    const t = setup({ answer: { status: 200, body: { text: "namaste andi", language: "te" } } });
    const field = screen.getByLabelText("Greeting") as HTMLTextAreaElement;
    fireEvent.change(field, { target: { value: "Hello there" } });
    field.setSelectionRange(5, 5);
    fireEvent.click((await mics())[0]);
    await screen.findByRole("button", { name: "Listening… tap to stop" });
    expect(screen.getByText("Your voice is turned into text and not saved.")).toBeInTheDocument();
    t.rec.level = 0.2; // speaking
    await new Promise((r) => setTimeout(r, 250));
    stopTap();
    await waitFor(() => expect(field.value).toBe("Hello namaste andi there"));
    expect(t.upload).toHaveBeenCalledTimes(1);
    const [url, init] = t.upload.mock.calls[0] as unknown as [string, { body: FormData; method: string }];
    expect(url).toBe("/app/tenants/t/speech-transcribe");
    expect(init.method).toBe("POST");
    expect(init.body.get("language")).toBe("te"); // the app's language by default (the field has no language of its own: the greeting is in the tab being written, te here)
    expect(init.body.get("audio")).toBeInstanceOf(Blob);
    expect(t.rec.stopped).toBe(1);
    expect(t.actions.save).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole("button", { name: "Undo the last dictation" }));
    expect(field.value).toBe("Hello there");
    expect(screen.queryByRole("button", { name: "Undo the last dictation" })).toBeNull();
    expect(localStorage.getItem("sme-voice-hint")).toBe("1");
  });

  it("it stops by itself two seconds after the person stops speaking; typing after it takes the stale Undo away; nothing said means nothing is sent", async () => {
    const t = setup({ answer: { status: 200, body: { text: "hello", language: "en" } } });
    fireEvent.click((await mics())[0]);
    await screen.findByRole("button", { name: "Listening… tap to stop" });
    t.rec.level = 0.3;
    await new Promise((r) => setTimeout(r, 300));
    t.rec.level = 0; // silence from here
    await waitFor(() => expect(screen.getByRole("button", { name: "Undo the last dictation" })).toBeInTheDocument(), { timeout: 5000 });
    expect(t.upload).toHaveBeenCalledTimes(1);
    fireEvent.change(screen.getByLabelText("Greeting"), { target: { value: "typed after" } });
    expect(screen.queryByRole("button", { name: "Undo the last dictation" })).toBeNull();
    // a second try in which nobody speaks: a tap before a second has passed sends nothing and says so
    fireEvent.click((await mics())[0]);
    await screen.findByRole("button", { name: "Listening… tap to stop" });
    stopTap();
    expect(await screen.findByRole("alert")).toHaveTextContent("Nothing was heard. Tap the mic and try again.");
    expect(t.upload).toHaveBeenCalledTimes(1);
  }, 12_000);

  it("at the time limit it stops, the words are in the field, and it says to tap the mic to keep going; the words are always in the field to correct", async () => {
    const t = setup({ maxSeconds: 1, answer: { status: 200, body: { text: "price is ₹4,500", language: "en" } } });
    const field = screen.getByLabelText("Greeting") as HTMLTextAreaElement;
    fireEvent.click((await mics())[0]);
    await screen.findByRole("button", { name: "Listening… tap to stop" });
    t.rec.level = 0.3;
    await waitFor(() => expect(field.value).toBe("price is ₹4,500"), { timeout: 4000 }); // the amount is in the field, as text, to be fixed before saving
    expect(await screen.findByText("Tap the mic to keep going")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Listening… tap to stop" })).toBeNull();
  }, 10_000);

  it("a blocked microphone says how to turn it on; the day's limit says voice typing is paused and that typing works; any other failure says it is not working and that typing works", async () => {
    setup({ denied: true });
    fireEvent.click((await mics())[0]);
    expect(await screen.findByRole("alert")).toHaveTextContent("The microphone is blocked. Tap the lock icon next to the address, allow Microphone, then try again.");
    cleanup();
    const t = setup({ answer: { status: 429, body: { error: { code: "cap_reached", message: "used up", retry_after: 3600 } } } });
    fireEvent.click((await mics())[0]);
    await screen.findByRole("button", { name: "Listening… tap to stop" });
    t.rec.level = 0.3;
    await new Promise((r) => setTimeout(r, 250));
    stopTap();
    expect(await screen.findByRole("alert")).toHaveTextContent("Voice typing is paused for today, you can type.");
    cleanup();
    const u = setup({ answer: { status: 504, body: { error: { code: "timeout", message: "slow" } } } });
    fireEvent.click((await mics())[0]);
    await screen.findByRole("button", { name: "Listening… tap to stop" });
    u.rec.level = 0.3;
    await new Promise((r) => setTimeout(r, 250));
    stopTap();
    expect(await screen.findByRole("alert")).toHaveTextContent("Voice typing isn't working right now. You can type.");
  });

  it("it listens for the language of the field it is in (the greeting's tab), else the app's; the chip changes it for that field (te, kn, hi, en, mixed/auto)", async () => {
    setup();
    const chip = () => screen.getAllByRole("button", { name: "Change the language it listens for" })[0];
    await mics();
    expect(screen.queryAllByRole("button", { name: "Change the language it listens for" })).toHaveLength(0); // the chip shows only while the field has focus or is listening
    fireEvent.focusIn(screen.getByLabelText("Greeting"));
    await screen.findAllByRole("button", { name: "Change the language it listens for" });
    // the greeting opens on the first language that has a greeting, else Telugu: the field says lang="te"
    await waitFor(() => expect(chip()).toHaveTextContent("Hearing: తెలుగు"));
    fireEvent.click(screen.getByRole("button", { name: "ಕನ್ನಡ" })); // the Kannada tab: the field is Kannada now
    await waitFor(() => expect(chip()).toHaveTextContent("Hearing: ಕನ್ನಡ"));
    fireEvent.click(chip());
    await waitFor(() => expect(chip()).toHaveTextContent("Hearing: हिन्दी")); // the list is te, kn, hi, en, then mixed
    fireEvent.click(chip());
    await waitFor(() => expect(chip()).toHaveTextContent("Hearing: English"));
    fireEvent.click(chip());
    await waitFor(() => expect(chip()).toHaveTextContent("Hearing: Mixed (auto)"));
  });

  it("a school workspace has no microphone on its free text except on how the assistant talks, and says there not to say students' or parents' names", async () => {
    setup({ school: true });
    expect((await mics()).length).toBeGreaterThanOrEqual(5);
    expect(screen.getAllByText("Don't say students' or parents' names.").length).toBeGreaterThanOrEqual(1);
  });

  it("Add by speaking: the question, then the answer, both shown as text with Save / Say again / Edit; nothing is saved until Save", async () => {
    const save = vi.fn(async () => ({ ok: true as const, data: SAVED }));
    const t = setup({ actions: { save, reset: vi.fn() } as never, answer: { status: 200, body: { text: "Do you have green sarees?", language: "en" } } });
    fireEvent.click((await screen.findAllByRole("button", { name: "Add by speaking" }))[0]);
    expect(screen.getByText("Say the question a customer asks")).toBeInTheDocument();
    expect(screen.getByText("Step 1 of 2")).toBeInTheDocument();
    const box = screen.getByLabelText("Say the question a customer asks") as HTMLTextAreaElement;
    const section = () => document.querySelector('[data-part="add-by-speaking-open"]') as HTMLElement;
    fireEvent.click(await within(section()).findByRole("button", { name: "Speak instead of typing" }));
    await screen.findByRole("button", { name: "Listening… tap to stop" });
    t.rec.level = 0.3;
    await new Promise((r) => setTimeout(r, 250));
    stopTap();
    await waitFor(() => expect(box.value).toBe("Do you have green sarees?"));
    await waitFor(() => expect(screen.getByRole("button", { name: "Next" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText("Now say your answer")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Now say your answer"), { target: { value: "Yes, in ten shades." } });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(document.querySelector('[data-part="review-q"]')).toHaveTextContent("Do you have green sarees?");
    expect(document.querySelector('[data-part="review-a"]')).toHaveTextContent("Yes, in ten shades.");
    expect(save).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Say again" }));
    expect(screen.getByText("Step 1 of 2")).toBeInTheDocument();
    expect((screen.getByLabelText("Say the question a customer asks") as HTMLTextAreaElement).value).toBe("");
  });

  it("Add by speaking: Save adds the pair to the objections and saves the training; Edit lets the person correct both texts first", async () => {
    const save = vi.fn(async () => ({ ok: true as const, data: SAVED }));
    setup({ actions: { save, reset: vi.fn() } });
    fireEvent.click((await screen.findAllByRole("button", { name: "Add by speaking" }))[0]);
    fireEvent.change(screen.getByLabelText("Say the question a customer asks"), { target: { value: "Is it pure silk?" } });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.change(screen.getByLabelText("Now say your answer"), { target: { value: "Yes, with a silk mark." } });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByLabelText("Your answer"), { target: { value: "Yes, pure silk with the silk mark." } });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(within(document.querySelector('[data-part="add-by-speaking-open"]') as HTMLElement).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(save).toHaveBeenCalledWith({ ...DOC, objections: [...DOC.objections, { a: "Is it pure silk?", b: "Yes, pure silk with the silk mark." }] });
  });

  it("insertAt puts the words at the caret with a space only where words would touch, and keeps the field's length limit; voiceAllowed refuses passwords, codes, phone numbers, e-mail, numbers, sites, bank and child fields", () => {
    expect(insertAt("Hello there", 5, "big", 0)).toBe("Hello big there");
    expect(insertAt("", 0, "hi", 0)).toBe("hi");
    expect(insertAt("abc", 3, "defgh", 6)).toBe("abc de");
    const make = (html: string) => {
      document.body.innerHTML = html;
      return document.body.firstElementChild as HTMLInputElement;
    };
    expect(voiceAllowed(make('<input type="text" />'))).toBe(true);
    expect(voiceAllowed(make("<textarea></textarea>") as never)).toBe(true);
    for (const html of ['<input type="password" />', '<input type="tel" />', '<input type="email" />', '<input type="number" />', '<input type="url" />', '<input autocomplete="one-time-code" />', '<input inputmode="numeric" />', '<input name="upi_id" />', '<input id="gstin" />', '<input name="otp" />', '<input data-voice="never" />', "<input disabled />", "<input readonly />"]) {
      expect(voiceAllowed(make(html)), html).toBe(false);
    }
  });
});


describe("one greeting (owner 13 Nov 2026): the four placeholders, a preview and the AI-mention switch", () => {
  const withGreeting = (text: string): TalkTrainingState => ({ ...DEFAULTS, training: { ...DOC, greeting: { en: text } }, saved: true });
  const draw = (initial: TalkTrainingState, extra: Partial<React.ComponentProps<typeof TalkTraining>> = {}) =>
    render(<TalkTraining initial={initial} langNames={CALL_LANG_NAMES} canEdit securityHref="/app/security" business="Lakshmi Silks" assistantName="Asha" actions={{ save: vi.fn(), reset: vi.fn() }} {...extra} />);

  it("the four placeholder buttons put the name into the greeting (and mark it unsaved)", () => {
    draw(withGreeting("Hello "));
    fireEvent.click(screen.getByRole("button", { name: "{customer}" }));
    expect(screen.getByLabelText("Greeting")).toHaveValue("Hello {customer}");
    expect(within(document.querySelector('[data-part="tt-greeting-insert"]') as HTMLElement).getAllByRole("button").map((b) => b.textContent)).toEqual(["{customer}", "{assistant}", "{business}", "{agent_role}"]);
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
  });

  it("shows what the customer hears with made-up names, in the language shown", () => {
    draw(withGreeting("Hello {customer}, this is {assistant}, the {agent_role} of {business}."));
    expect(document.querySelector('[data-part="tt-greeting-preview"]')).toHaveTextContent("Hello Ravi, this is Asha, the AI assistant of Lakshmi Silks.");
  });

  it("a word in braces that is not one of the four is shown and blocks Save (the API would refuse it)", () => {
    draw(withGreeting("Hello {name}"));
    fireEvent.change(screen.getByLabelText("Greeting"), { target: { value: "Hello {name}, {customer}" } });
    expect(document.querySelector('[data-part="tt-greeting-unknown"]')).toHaveTextContent("{name} is not one of the four placeholders.");
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Greeting"), { target: { value: "Hello {customer}" } });
    expect(document.querySelector('[data-part="tt-greeting-unknown"]')).toBeNull();
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
  });

  it("the AI-mention switch sits under the greeting, saves at once, and warns once when it is turned off", async () => {
    const save = vi.fn(async () => ({ ok: true as const }));
    localStorage.removeItem("sme-opening-ai-warned");
    draw(withGreeting("Hello"), { mentionAi: { value: true, save } });
    const sw = screen.getByRole("switch", { name: "Mention that I'm an AI assistant in the greeting" });
    expect(sw).toBeChecked();
    fireEvent.click(sw);
    await waitFor(() => expect(save).toHaveBeenCalledWith(false));
    expect(document.querySelector('[data-part="ai-warning"]')).toHaveTextContent("will still answer honestly");
    await waitFor(() => expect(screen.getByText("Saved.")).toBeInTheDocument());
  });

  it("a switch that could not be saved goes back and says so; without the prop there is no switch; a non-owner cannot change it", async () => {
    const save = vi.fn(async () => ({ ok: false as const, error: "down" }));
    draw(withGreeting("Hello"), { mentionAi: { value: true, save } });
    fireEvent.click(screen.getByRole("switch"));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Could not save this. Try again."));
    expect(screen.getByRole("switch")).toBeChecked();
    cleanup();
    draw(withGreeting("Hello"));
    expect(screen.queryByRole("switch")).toBeNull();
    cleanup();
    draw(withGreeting("Hello"), { canEdit: false, mentionAi: { value: false, save } });
    expect(screen.getByRole("switch")).toBeDisabled();
  });
});
