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

const DOC = { greeting: {}, address: "plain" as const, questions: ["What is the saree for?"], neverSay: ["guaranteed"], objections: [{ a: "Too costly", b: "We have sarees in many ranges." }], examples: [], sayLike: [] };
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
    fireEvent.click(screen.getByRole("button", { name: "Start again" }));
    expect(document.querySelector('[data-part="tt-practice-turns"]')).toBeNull();
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

  it("app v4: the page's order is the greeting and tone, then never say, then the rest; the greeting languages are Telugu, Kannada, English, Hindi (Tamil, Malayalam, Marathi hidden while paused)", () => {
    render(<TalkTraining initial={DEFAULTS} langNames={CALL_LANG_NAMES} canEdit securityHref="/app/security" actions={{ save: vi.fn(), reset: vi.fn() }} v4 />);
    const chips = Array.from(document.querySelectorAll('[data-part="tt-greeting"] [role="group"] button')).map((b) => b.textContent?.replace(/[·\s]+$/, ""));
    expect(chips).toEqual(["తెలుగు", "ಕನ್ನಡ", "English", "हिन्दी"]);
    const order = ["tt-greeting", "tt-address", "tt-never", "tt-questions", "tt-objections"].map((p) => Array.from(document.querySelectorAll("[data-part]")).findIndex((e) => e.getAttribute("data-part") === p));
    expect(order.every((n) => n >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    cleanup();
    show(DEFAULTS); // without v4 the six languages are all there, as before
    expect(document.querySelectorAll('[data-part="tt-greeting"] [role="group"] button').length).toBe(7);
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
  const VOICE = { words: {}, url: "wss://api/v1/tenants/t/voice-chat", language: "te" as const, languageNames: NAMES, tokenUrl: "/t" };
  const makeSocket = () => ({ binaryType: "", readyState: 0, sent: [] as string[], send(d: unknown) { this.sent.push(String(d)); }, close: vi.fn(), onopen: null as null | (() => void), onmessage: null as null | ((e: { data: string }) => void), onclose: null as null | ((e: { code: number; reason: string }) => void), onerror: null });
  const makeAudio = (denied = false) => ({ startMic: vi.fn(async () => { if (denied) throw new Error("denied"); }), stopMic: vi.fn(), play: vi.fn(), flush: vi.fn(), playing: () => false, close: vi.fn(), analyser: () => null });
  const setup = (o: { v4?: boolean; supported?: boolean; maxSeconds?: number; denied?: boolean; school?: boolean; actions?: React.ComponentProps<typeof TalkTraining>["actions"] } = {}) => {
    const socket = makeSocket();
    const audio = makeAudio(o.denied);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ token: "tok" }), { status: 200, headers: { "content-type": "application/json" } })));
    const frame = { ...NO_FRAME_DATA, v4: o.v4 !== false, pack: o.school ? ({ modules: ["programmes"] } as never) : null };
    const actions = o.actions ?? ({ save: vi.fn(), reset: vi.fn() } as never as React.ComponentProps<typeof TalkTraining>["actions"]);
    render(
      <>
        <FrameDataSlot data={frame} />
        <AskVoiceContext.Provider value={VOICE}>
          <VoiceInputOptionsContext.Provider value={{ audioFactory: () => audio as never, socketFactory: () => socket as never, supported: o.supported !== false, ...(o.maxSeconds ? { maxSeconds: o.maxSeconds } : {}) }}>
            <TalkTraining initial={DEFAULTS} langNames={CALL_LANG_NAMES} canEdit securityHref="/app/security" actions={actions} v4 />
          </VoiceInputOptionsContext.Provider>
        </AskVoiceContext.Provider>
      </>,
    );
    const open = async () => {
      await waitFor(() => expect(socket.onopen).not.toBeNull());
      socket.readyState = 1;
      socket.onopen?.();
    };
    const send = (m: object) => socket.onmessage?.({ data: JSON.stringify(m) });
    const ready = () => send({ type: "ready", session_id: "s1", language: "te", limits: {} });
    const say = (text: string) => send({ type: "caption", who: "user", text, final: true, spoken: true });
    return { socket, audio, open, ready, say, send, actions };
  };
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it("every free-text field has a microphone under it, 44 px at least, named for a screen reader; the greeting's is first", async () => {
    setup();
    const mics = await screen.findAllByRole("button", { name: "Speak instead of typing" });
    expect(mics.length).toBeGreaterThanOrEqual(5); // the greeting, the question, the never-say word, the objection pair, the example pair
    expect(mics[0].className).toContain("min-h-11");
    expect(document.querySelector('[data-part="tt-greeting"] [data-voice-mic]')).not.toBeNull();
  });

  it("without app v4, in a browser that cannot record, and with no voice for the workspace there is no microphone at all", async () => {
    setup({ v4: false });
    await new Promise((r) => setTimeout(r, 30));
    expect(screen.queryByRole("button", { name: "Speak instead of typing" })).toBeNull();
    cleanup();
    setup({ supported: false });
    await new Promise((r) => setTimeout(r, 30));
    expect(screen.queryByRole("button", { name: "Speak instead of typing" })).toBeNull();
  });

  it("dictation goes in at the caret and replaces nothing; it never saves or sends; Undo takes it out; the first time says the voice is not saved", async () => {
    const t = setup();
    const field = screen.getByLabelText("Greeting") as HTMLTextAreaElement;
    fireEvent.change(field, { target: { value: "Hello there" } });
    field.setSelectionRange(5, 5);
    const mic = (await screen.findAllByRole("button", { name: "Speak instead of typing" }))[0];
    fireEvent.click(mic);
    await t.open();
    expect(JSON.parse(t.socket.sent[0])).toMatchObject({ type: "start", access_token: "tok", mode: "dictate", stt_language: "te" });
    t.ready();
    expect(await screen.findByRole("button", { name: "Listening… tap to stop" })).toBeInTheDocument();
    expect(screen.getByText("Your voice is turned into text and not saved.")).toBeInTheDocument();
    t.say("namaste");
    await waitFor(() => expect(field.value).toBe("Hello namaste there"));
    t.say("namaste andi");
    await waitFor(() => expect(field.value).toBe("Hello namaste andi there")); // the partial words are replaced by the final ones, what was there stays
    fireEvent.click(screen.getByRole("button", { name: "Listening… tap to stop" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Undo the last dictation" })).toBeInTheDocument());
    expect(t.actions.save).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Undo the last dictation" }));
    expect(field.value).toBe("Hello there");
    expect(screen.queryByRole("button", { name: "Undo the last dictation" })).toBeNull();
    expect(localStorage.getItem("sme-voice-hint")).toBe("1");
  });

  it("it stops by itself two seconds after the last words, and a new dictation after typing offers no stale Undo", async () => {
    const t = setup();
    const mic = (await screen.findAllByRole("button", { name: "Speak instead of typing" }))[0];
    fireEvent.click(mic);
    await t.open();
    t.ready();
    await screen.findByRole("button", { name: "Listening… tap to stop" });
    t.say("hello");
    await new Promise((r) => setTimeout(r, 2600));
    await waitFor(() => expect(screen.getByRole("button", { name: "Undo the last dictation" })).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "Listening… tap to stop" })).toBeNull();
    fireEvent.change(screen.getByLabelText("Greeting"), { target: { value: "typed after" } });
    expect(screen.queryByRole("button", { name: "Undo the last dictation" })).toBeNull();
  }, 10_000);

  it("at the 30 second limit it stops, the words stay in the field, and it says to tap the mic to keep going; the words are always in the field to correct", async () => {
    const t = setup({ maxSeconds: 1 });
    const field = screen.getByLabelText("Greeting") as HTMLTextAreaElement;
    fireEvent.click((await screen.findAllByRole("button", { name: "Speak instead of typing" }))[0]);
    await t.open();
    t.ready();
    await screen.findByRole("button", { name: "Listening… tap to stop" });
    t.say("price is 4,500 rupees");
    await waitFor(() => expect(field.value).toBe("price is 4,500 rupees")); // the numbers are in the field, as text, to be fixed before saving
    await waitFor(() => expect(screen.getByText("Tap the mic to keep going")).toBeInTheDocument(), { timeout: 4000 });
    expect(screen.queryByRole("button", { name: "Listening… tap to stop" })).toBeNull();
    expect(field.value).toBe("price is 4,500 rupees");
  }, 10_000);

  it("a blocked microphone says how to turn it on; the daily limit says voice typing is paused and that typing works", async () => {
    setup({ denied: true });
    fireEvent.click((await screen.findAllByRole("button", { name: "Speak instead of typing" }))[0]);
    expect(await screen.findByRole("alert")).toHaveTextContent("The microphone is blocked. Tap the lock icon next to the address, allow Microphone, then try again.");
    cleanup();
    const t = setup();
    fireEvent.click((await screen.findAllByRole("button", { name: "Speak instead of typing" }))[0]);
    await t.open();
    t.send({ type: "limit", reason: "daily_limit" });
    t.socket.onclose?.({ code: 1000, reason: "" });
    expect(await screen.findByRole("alert")).toHaveTextContent("Voice typing is paused for today, you can type.");
  });

  it("the language chip says what it listens for, starts as the app's language and changes on a tap (te, kn, hi, en, any language)", async () => {
    setup();
    const chip = (await screen.findAllByRole("button", { name: "Change the language it listens for" }))[0];
    expect(chip).toHaveTextContent("Hearing: తెలుగు");
    fireEvent.click(chip);
    await waitFor(() => expect(screen.getAllByRole("button", { name: "Change the language it listens for" })[0]).toHaveTextContent("Hearing: ಕನ್ನಡ"));
    expect(localStorage.getItem("sme-voice-lang")).toBe("kn");
  });

  it("a school workspace has no microphone on its free text, except on how the assistant talks (not about students, parents or classes)", async () => {
    setup({ school: true });
    expect((await screen.findAllByRole("button", { name: "Speak instead of typing" })).length).toBeGreaterThanOrEqual(5);
  });

  it("Add by speaking: the question, then the answer, both shown as text with Save / Say again / Edit; nothing is saved until Save", async () => {
    const save = vi.fn(async () => ({ ok: true as const, data: SAVED }));
    const t = setup({ actions: { save, reset: vi.fn() } });
    fireEvent.click((await screen.findAllByRole("button", { name: "Add by speaking" }))[0]);
    expect(screen.getByText("Say the question a customer asks")).toBeInTheDocument();
    expect(screen.getByText("Step 1 of 2")).toBeInTheDocument();
    const box = screen.getByLabelText("Say the question a customer asks") as HTMLTextAreaElement;
    const section = () => document.querySelector('[data-part="add-by-speaking-open"]') as HTMLElement;
    fireEvent.click(await within(section()).findByRole("button", { name: "Speak instead of typing" }));
    await t.open();
    t.ready();
    t.say("Do you have green sarees?");
    await waitFor(() => expect(box.value).toBe("Do you have green sarees?"));
    fireEvent.click(screen.getByRole("button", { name: "Listening… tap to stop" }));
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

