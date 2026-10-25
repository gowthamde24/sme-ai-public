import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { VoiceMode, type VoiceModeWords, type VoicePhase } from "./VoiceMode";

const words: VoiceModeWords = { title: "Voice mode", listening: "I'm listening…", starting: "Getting the microphone ready…", thinking: "Thinking…", speaking: "Answering…", done: "Done", show: "Show the answer", cancel: "Never mind", tap: "Tap the circle to talk", close: "Close voice mode" };
const draw = (phase: VoicePhase, over: Partial<{ left: number | null; caption: string }> = {}) => {
  const fns = { onTapOrb: vi.fn(), onDone: vi.fn(), onCancel: vi.fn(), onClose: vi.fn() };
  render(<VoiceMode phase={phase} caption={over.caption ?? ""} left={over.left ?? null} words={words} {...fns} />);
  return fns;
};
afterEach(cleanup);

describe("voice mode: the full-screen circle", () => {
  it("is a modal dialog with one big centred circle, which listens (halo), thinks, speaks (halo) and then stands still", () => {
    const expected: Record<VoicePhase, [string, boolean]> = { starting: ["think", false], listening: ["ambient", true], thinking: ["think", false], answering: ["speak", true], done: ["still", false], error: ["still", false] };
    for (const [phase, [orb, halo]] of Object.entries(expected) as [VoicePhase, [string, boolean]][]) {
      draw(phase);
      expect(screen.getByRole("dialog", { name: "Voice mode" })).toHaveAttribute("aria-modal", "true");
      expect(document.querySelector("[data-orb]")!.getAttribute("data-orb"), phase).toBe(orb);
      expect(Boolean(document.querySelector(".orb-halo")), phase).toBe(halo);
      cleanup();
    }
  });
  it("says what is happening in one line, never the words of the answer", () => {
    for (const [phase, line] of [["starting", words.starting], ["listening", words.listening], ["thinking", words.thinking], ["answering", words.speaking], ["done", words.tap]] as const) {
      draw(phase);
      expect(screen.getByText(line), phase).toBeInTheDocument();
      cleanup();
    }
    draw("error", { caption: "That did not work. Close this to see why." });
    expect(screen.getByText("That did not work. Close this to see why.")).toBeInTheDocument();
  });
  it("while it listens: a Done button (focused), a way to throw it away, the time left, and the circle stops the recording too", () => {
    const f = draw("listening", { left: 42 });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Done" }));
    expect(document.querySelector('[data-voice-mode="countdown"]')!.textContent).toBe("0:42");
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    fireEvent.click(screen.getByRole("button", { name: "Never mind" }));
    fireEvent.click(screen.getByRole("button", { name: "Done" }).closest("[role=dialog]")!.querySelector('[data-voice="orb"]')!);
    expect([f.onDone.mock.calls.length, f.onCancel.mock.calls.length, f.onTapOrb.mock.calls.length]).toEqual([1, 1, 1]);
  });
  it("after the answer: 'Show the answer' closes it, and the circle starts a new question", () => {
    const f = draw("done");
    fireEvent.click(screen.getByRole("button", { name: "Show the answer" }));
    expect(f.onClose).toHaveBeenCalledOnce();
    fireEvent.click(document.querySelector('[data-voice="orb"]')!);
    expect(f.onTapOrb).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "Close voice mode" }));
    expect(f.onClose).toHaveBeenCalledTimes(2);
  });
});
