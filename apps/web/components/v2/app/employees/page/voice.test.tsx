import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { show } from "./fixtures";

const played: string[] = [];
beforeEach(() => {
  played.length = 0;
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
});
afterEach(() => vi.unstubAllGlobals());

vi.mock("next/link", () => import("./link-mock"));

const card = async (name: string) => (await screen.findByRole("heading", { name })).closest("section") as HTMLElement;

describe("Voice and language", () => {
  it("says a voice is chosen for each language and names the voice in use", async () => {
    show({ initialTab: "voice" });
    expect(await screen.findByText(/A voice is chosen for each language\. A voice chosen for తెలుగు does not change the other languages\./)).toBeInTheDocument();
    const te = await card("తెలుగు");
    expect(within(te).getByText("Voice now: Ramya")).toBeInTheDocument();
    const en = await card("English");
    expect(within(en).getByText("Voice now: Riya")).toBeInTheDocument();
  });

  it("lists the voices of each language only, women first, with Recommended and a Play button each", async () => {
    show({ initialTab: "voice" });
    const te = await card("తెలుగు");
    const rows = within(te).getAllByRole("listitem");
    expect(rows.map((r) => r.getAttribute("data-voice"))).toEqual(["te_ramya", "te_kavitha", "te_arun"]);
    expect(within(rows[0]).getByText("Recommended")).toBeInTheDocument();
    expect(within(rows[0]).getByText("In use")).toBeInTheDocument();
    expect(within(te).queryByText("Riya")).toBeNull();
  });

  it("plays the recorded sample of a voice from this app's own address", async () => {
    show({ initialTab: "voice" });
    const te = await card("తెలుగు");
    fireEvent.click(within(te).getByRole("button", { name: /^Hear Kavitha/ }));
    await waitFor(() => expect(played).toEqual(["/app/tenants/t/voice-pick?id=te_kavitha"]));
  });

  it("chooses a voice, says Saved for the language and plays the sample through a blob address", async () => {
    const { a } = show({ initialTab: "voice" });
    const te = await card("తెలుగు");
    fireEvent.click(within(te).getByRole("button", { name: "Use Kavitha" }));
    await waitFor(() => expect(a.setVoice).toHaveBeenCalledWith("te", "te_kavitha"));
    expect(await within(te).findByText("Saved: Kavitha for తెలుగు. New calls use it.")).toBeInTheDocument();
    fireEvent.click(within(te).getByRole("button", { name: "Play sample" }));
    await waitFor(() => expect(a.preview).toHaveBeenCalledWith({ language: "te" }));
    await waitFor(() => expect(played).toContain("blob:sample"));
  });

  it("says the closed sentence when the voice cannot speak", async () => {
    const { a } = show({ initialTab: "voice" });
    a.setVoice.mockResolvedValueOnce({ ok: false, error: "voice_unavailable" });
    const te = await card("తెలుగు");
    fireEvent.click(within(te).getByRole("button", { name: "Use Arun" }));
    expect(await within(te).findByRole("alert")).toHaveTextContent("This voice cannot speak right now. No other voice was used.");
    expect(within(te).queryByText(/^Saved:/)).toBeNull();
  });

  it("says the sample limit when playing is refused", async () => {
    const { a } = show({ initialTab: "voice" });
    a.preview.mockResolvedValueOnce({ ok: false, error: "rate_limited" });
    const te = await card("తెలుగు");
    fireEvent.click(within(te).getByRole("button", { name: "Use Kavitha" }));
    fireEvent.click(await within(te).findByRole("button", { name: "Play sample" }));
    expect(await screen.findByText("You have played enough samples today. Try again tomorrow.")).toBeInTheDocument();
    expect(played).toEqual([]);
  });

  it("saves the opening line of one language in the map and plays it", async () => {
    const { a } = show({ initialTab: "voice" });
    const en = await card("English");
    const box = within(en).getByLabelText("Opening line in English");
    fireEvent.change(box, { target: { value: "  Welcome, I am the AI assistant of the shop.  " } });
    fireEvent.click(within(en).getByRole("button", { name: "Play this line" }));
    await waitFor(() => expect(a.preview).toHaveBeenCalledWith({ language: "en", text: "Welcome, I am the AI assistant of the shop." }));
    fireEvent.click(within(en).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(a.patch).toHaveBeenCalledWith({ openingLine: { te: "నమస్కారం, నేను AI అసిస్టెంట్ ని.", en: "Welcome, I am the AI assistant of the shop." } }));
    expect(await within(en).findByText("Saved")).toBeInTheDocument();
  });

  it("does not send an opening line shorter than 10 letters, and cannot play it", async () => {
    const { a } = show({ initialTab: "voice" });
    const en = await card("English");
    fireEvent.change(within(en).getByLabelText("Opening line in English"), { target: { value: "Hello" } });
    expect(within(en).getByRole("button", { name: "Play this line" })).toBeDisabled();
    fireEvent.click(within(en).getByRole("button", { name: "Save" }));
    expect(await within(en).findByRole("alert")).toHaveTextContent("Please check what you wrote and try again.");
    expect(a.patch).not.toHaveBeenCalled();
  });

  it("removes the line of a language when its box is emptied", async () => {
    const { a } = show({ initialTab: "voice" });
    const te = await card("తెలుగు");
    fireEvent.change(within(te).getByLabelText("Opening line in తెలుగు"), { target: { value: "" } });
    fireEvent.click(within(te).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(a.patch).toHaveBeenCalledWith({ openingLine: {} }));
  });

  it("saves style, speed and the switches as exactly what changed", async () => {
    const { a } = show({ initialTab: "voice" });
    const speak = await card("How it speaks");
    expect(within(speak).getByRole("button", { name: "Save" })).toBeDisabled();
    fireEvent.click(within(speak).getByRole("radio", { name: "Respectful" }));
    fireEvent.change(within(speak).getByRole("slider"), { target: { value: "1.15" } });
    fireEvent.click(within(speak).getByRole("switch", { name: /Allow English words/ }));
    fireEvent.click(within(speak).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(a.patch).toHaveBeenCalledWith({ style: "respectful", speed: 1.15, allowEnglishMixing: false }));
    expect(a.patch).toHaveBeenCalledTimes(1);
  });

  it("keeps the speed slider inside 0.7 to 1.3", async () => {
    show({ initialTab: "voice" });
    const speak = await card("How it speaks");
    const slider = within(speak).getByRole("slider");
    expect(slider).toHaveAttribute("min", "0.7");
    expect(slider).toHaveAttribute("max", "1.3");
  });

  it("saves the languages it speaks, at least one", async () => {
    const { a } = show({ initialTab: "voice" });
    const langs = await card("Languages it speaks");
    fireEvent.click(within(langs).getByRole("checkbox", { name: "हिन्दी" }));
    fireEvent.click(within(langs).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(a.patch).toHaveBeenCalledWith({ languages: ["te", "hi", "en"] }));
    fireEvent.click(within(langs).getByRole("checkbox", { name: "తెలుగు" }));
    fireEvent.click(within(langs).getByRole("checkbox", { name: "हिन्दी" }));
    fireEvent.click(within(langs).getByRole("checkbox", { name: "English" }));
    fireEvent.click(within(langs).getByRole("button", { name: "Save" }));
    expect(await within(langs).findByRole("alert")).toHaveTextContent("Please check what you wrote");
  });

  it("says plainly when the voices cannot be listed", async () => {
    show({ initialTab: "voice", catalogue: null });
    const te = await card("తెలుగు");
    expect(within(te).getByText("The voices cannot be listed right now. The voice in use stays as it is.")).toBeInTheDocument();
  });

  it("for a reader: no Use buttons, no Save, values only", async () => {
    show({ initialTab: "voice", canEdit: false });
    const te = await card("తెలుగు");
    expect(within(te).queryByRole("button", { name: /^Use / })).toBeNull();
    expect(within(te).queryByRole("button", { name: "Save" })).toBeNull();
    expect(within(te).getByLabelText("Opening line in తెలుగు")).toBeDisabled();
  });
});
