import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { appDict } from "@/i18n/app";
import type { AudioIO, SocketLike } from "@/lib/browser-voice/client";
import { CALL_LANG_NAMES } from "@/lib/assistant/types";

import { VoiceChat } from "./VoiceChat";

const WORDS = Object.fromEntries(Object.entries(appDict("en") as Record<string, string>).filter(([k]) => k.startsWith("bv.")));
const NAMES = { te: CALL_LANG_NAMES.te, hi: CALL_LANG_NAMES.hi, kn: CALL_LANG_NAMES.kn, en: CALL_LANG_NAMES.en };

class Sock implements SocketLike {
  binaryType = "";
  readyState = 1;
  sent: (string | ArrayBuffer)[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onclose: ((e: { code: number; reason: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  send(d: string | ArrayBuffer) {
    this.sent.push(d);
  }
  close() {
    this.readyState = 3;
  }
  say(m: unknown) {
    this.onmessage?.({ data: JSON.stringify(m) });
  }
}
let sock: Sock;
let micFails = false;
const audio = (): AudioIO => ({
  startMic: async () => {
    if (micFails) throw new Error("denied");
  },
  stopMic: () => undefined,
  play: () => undefined,
  flush: () => undefined,
  playing: () => false,
  close: () => undefined,
  analyser: () => null,
});
const getToken = vi.fn(async (..._a: unknown[]) => ({ ok: true, json: async () => ({ token: "tok" }) }));
const onClose = vi.fn();
const onType = vi.fn();
const draw = () => render(<VoiceChat words={WORDS} url="wss://x/v1/tenants/t/voice-chat" language="te" languageNames={NAMES} tokenUrl="/app/tenants/t/voice-token" onClose={onClose} onType={onType} audioFactory={audio as never} socketFactory={() => (sock = new Sock())} />);
const tapOrb = async () => {
  await act(async () => void fireEvent.click(document.querySelector('[data-voice="orb"]') as HTMLElement));
};

beforeEach(() => {
  vi.stubGlobal("fetch", getToken);
  micFails = false;
  getToken.mockClear();
  onClose.mockClear();
  onType.mockClear();
});
afterEach(cleanup);

describe("Talk to your assistant", () => {
  it("explains the microphone before the tap and asks for the sign-in beforehand (so the tap itself can open the microphone)", async () => {
    await act(async () => void draw());
    expect(getToken).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/Your browser will ask to use the microphone/)).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: /Talk to/ })).toBeInTheDocument();
  });
  it("a tap opens the socket and sends the sign-in and the language first; the orb then follows the states: listening, thinking (looking at records), speaking", async () => {
    await act(async () => void draw());
    await tapOrb();
    await act(async () => void sock.onopen?.());
    expect(JSON.parse(sock.sent[0] as string)).toEqual({ type: "start", access_token: "tok", language: "te" });
    await act(async () => void sock.say({ type: "ready", session_id: "s", language: "te", limits: {} }));
    await act(async () => void sock.say({ type: "state", state: "listening" }));
    expect(screen.getByText("Listening…")).toBeInTheDocument();
    expect(document.querySelector('[data-part="voice-chat"]')).toHaveAttribute("data-state", "listening");
    await act(async () => void sock.say({ type: "state", state: "thinking", step: "looking" }));
    expect(screen.getByText("Looking at your records…")).toBeInTheDocument();
    await act(async () => void sock.say({ type: "state", state: "speaking" }));
    expect(screen.getByText("Speaking. Talk to interrupt.")).toBeInTheDocument();
  });
  it("shows the captions of both sides, marks the part that is not read aloud, and lists the sources", async () => {
    await act(async () => void draw());
    await tapOrb();
    await act(async () => void sock.say({ type: "ready", session_id: "s", language: "te", limits: {} }));
    await act(async () => void sock.say({ type: "caption", who: "user", text: "What is the price?", final: true, spoken: true }));
    await act(async () => void sock.say({ type: "caption", who: "assistant", text: "Rs 500.", final: true, spoken: true }));
    await act(async () => void sock.say({ type: "caption", who: "assistant", text: "Full details on screen.", final: true, spoken: false }));
    await act(async () => void sock.say({ type: "source", kind: "price_item", label: "Silk saree" }));
    expect(screen.getByText("What is the price?")).toBeInTheDocument();
    expect(screen.getByText("Rs 500.")).toBeInTheDocument();
    expect(screen.getByText("Shown here, not read aloud")).toBeInTheDocument();
    expect(screen.getByText("Silk saree")).toBeInTheDocument();
  });
  it("the language can be changed on the way", async () => {
    await act(async () => void draw());
    await tapOrb();
    await act(async () => void sock.say({ type: "ready", session_id: "s", language: "te", limits: {} }));
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: NAMES.hi })));
    expect(JSON.parse(sock.sent.at(-1) as string)).toEqual({ type: "set_language", language: "hi" });
  });
  it("a second tap stops it; an end says why in plain words; Type instead stops it and opens the written assistant", async () => {
    await act(async () => void draw());
    await tapOrb();
    await act(async () => void sock.say({ type: "ready", session_id: "s", language: "te", limits: {} }));
    await tapOrb();
    expect(JSON.parse(sock.sent.at(-1) as string)).toEqual({ type: "stop" });
    expect(screen.getByText(/The chat has ended/)).toBeInTheDocument();
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: "Type instead" })));
    expect(onType).toHaveBeenCalledTimes(1);
  });
  it("a limit says so in words, and a refused microphone says how to allow it", async () => {
    await act(async () => void draw());
    await tapOrb();
    await act(async () => void sock.say({ type: "limit", reason: "daily_limit", fatal: true }));
    await act(async () => void sock.onclose?.({ code: 4429, reason: "daily_limit" }));
    expect(screen.getByText(/That is enough talking for today/)).toBeInTheDocument();
    cleanup();
    micFails = true;
    await act(async () => void draw());
    await tapOrb();
    expect(screen.getByRole("alert")).toHaveTextContent("The microphone is blocked");
  });
  it("Escape closes it", async () => {
    await act(async () => void draw());
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });
});
