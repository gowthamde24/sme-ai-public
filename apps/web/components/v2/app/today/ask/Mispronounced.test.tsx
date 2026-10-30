import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Mispronounced, wordsOf } from "./Mispronounced";

const W: Record<string, string> = { "bv.chat.mis": "Mispronounced?", "bv.chat.mis.pick": "Tap the word", "bv.chat.mis.sound": "How should it sound?", "bv.chat.mis.save": "Save", "bv.chat.mis.cancel": "Cancel", "bv.chat.mis.saved": "Saved it", "bv.chat.mis.err": "Could not save" };
const c = (k: string) => W[k] ?? k;
const bodies: Record<string, unknown>[] = [];
let okAnswer = true;

beforeEach(() => {
  bodies.length = 0;
  okAnswer = true;
  vi.stubGlobal("fetch", vi.fn(async (_u: string, init: { body: string }) => (bodies.push(JSON.parse(init.body)), { json: async () => ({ ok: okAnswer }) })));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('"Mispronounced?" under a spoken message', () => {
  it("offers each plain word once, without markup or punctuation", () => {
    expect(wordsOf("**Pochampally** sarees, pochampally! Order ₹1,200 (kallu) a")).toEqual(["Pochampally", "sarees", "Order", "1,200", "kallu"]);
  });
  it("tap the button, tap the word, type how it sounds, Save: one request for that word in the message's language", async () => {
    render(<Mispronounced text="Welcome to Pochampally Silks" language="te" endpoint="/e" c={c} messageId="m1" />);
    fireEvent.click(screen.getByRole("button", { name: "Mispronounced?" }));
    fireEvent.click(screen.getByRole("button", { name: "Pochampally" }));
    fireEvent.change(screen.getByLabelText("How should it sound?"), { target: { value: "pochampalli" } });
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: "Save" })));
    expect(bodies).toEqual([{ action: "save", word: "Pochampally", sounds_like: "pochampalli", language: "te", message_id: "m1" }]);
    expect(screen.getByRole("status").textContent).toBe("Saved it");
  });
  it("says so when it could not save and keeps the box open", async () => {
    okAnswer = false;
    render(<Mispronounced text="Kallu Silks" language="en" endpoint="/e" c={c} />);
    fireEvent.click(screen.getByRole("button", { name: "Mispronounced?" }));
    fireEvent.click(screen.getByRole("button", { name: "Kallu" }));
    fireEvent.change(screen.getByLabelText("How should it sound?"), { target: { value: "kallu" } });
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: "Save" })));
    expect(screen.getByRole("alert").textContent).toBe("Could not save");
  });
});
