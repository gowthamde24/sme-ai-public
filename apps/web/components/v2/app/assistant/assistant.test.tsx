import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

import { appDict } from "@/i18n/app";
import { assistantProfile } from "@/lib/assistant/defaults";
import type { TestCallResult } from "@/lib/assistant/test-call";
import { VOICES } from "@/lib/assistant/types";
import { withModuleWords } from "@/lib/packs/module-words";

import { AssistantSettings } from "./AssistantSettings";

const raw = (lang: "en" | "te" | "hi" | "kn", modules: string[] | null) => withModuleWords(Object.fromEntries(Object.entries(appDict(lang) as Record<string, string>).filter(([k]) => k.startsWith("asst."))), modules ? { modules } : null);
const langs = { te: "తెలుగు", hi: "हिन्दी", kn: "ಕನ್ನಡ", en: "English", ta: "தமிழ்", ml: "മലയാളം" };
const voiceNames = Object.fromEntries(VOICES.map((v) => [v, (appDict("en") as Record<string, string>)[`asst.voice.${v}`]])) as Record<(typeof VOICES)[number], string>;
const draw = (over: Partial<{ modules: string[] | null; canEdit: boolean; saved: boolean; save: (i: unknown) => Promise<{ ok: true } | { ok: false; error: string }>; samples: { endpoint: string; mock: boolean } | null; voicePickerOn: boolean; testCall: () => Promise<TestCallResult> }> = {}) => {
  const modules = over.modules === undefined ? null : over.modules;
  const profile = assistantProfile(modules);
  const save = (over.save ?? vi.fn(async () => ({ ok: true as const }))) as ReturnType<typeof vi.fn> & ((i: unknown) => Promise<{ ok: true } | { ok: false; error: string }>);
  render(<AssistantSettings words={raw("en", modules)} initial={profile.defaults} profile={profile} shop="Acme Silks" langs={langs} voiceNames={voiceNames} canEdit={over.canEdit ?? true} testMode saved={over.saved ?? false} actions={{ save, ...(over.testCall ? { testCall: over.testCall } : {}) }} samples={over.samples ?? null} voicePickerOn={over.voicePickerOn ?? false} />);
  return { save, profile };
};
afterEach(() => {
  cleanup();
  refresh.mockClear();
});

describe("Settings > AI assistant", () => {
  it("the four-persona voice list is shown, and is left out when the voice picker is on (the picker chooses the voice of each language)", () => {
    draw({});
    expect(screen.getByRole("radiogroup", { name: /Voice/ })).toBeInTheDocument();
    cleanup();
    draw({ voicePickerOn: true });
    expect(screen.queryByRole("radiogroup", { name: /Voice/ })).toBeNull();
    expect(screen.getByRole("radiogroup", { name: /Languages|Language/ })).toBeInTheDocument();
  });
  it("starts from the defaults of the business type, says so, and says that mentioning 'AI assistant' in the greeting is the owner's choice", () => {
    draw();
    expect(screen.getByRole("heading", { name: "Set up your AI assistant" })).toBeInTheDocument();
    expect(screen.getByText(/standard settings for your kind of business/)).toBeInTheDocument();
    expect(screen.getByLabelText("Assistant name")).toHaveValue("your assistant");
    expect(screen.getByText(/Customers hear: “your assistant, the assistant of Acme Silks\.” Whether the greeting also says it is an AI assistant is your choice, in the opening line below\./)).toBeInTheDocument();
    expect(screen.getByText("Test mode: your choices are kept on this device only.")).toBeInTheDocument();
  });
  it("the preview follows the name, the language and the way of talking, and the circle speaks", () => {
    draw();
    fireEvent.change(screen.getByLabelText("Assistant name"), { target: { value: "Meera" } });
    expect(screen.getByText("Meera · AI assistant")).toBeInTheDocument();
    const line = () => document.querySelector('[data-part="preview-line"]')!;
    expect(line().getAttribute("lang")).toBe("te");
    expect(line().textContent).toContain("Meera");
    expect(line().textContent).toContain("Acme Silks");
    fireEvent.click(screen.getByRole("radio", { name: "English" }));
    fireEvent.click(screen.getByRole("radio", { name: /Respectful/ }));
    expect(line().getAttribute("lang")).toBe("en");
    expect(line().textContent).toContain("Namaste, I'm Meera, the AI assistant of Acme Silks");
    expect(document.querySelector('[data-orb="speak"]')).not.toBeNull();
  });
  it("a name that is not letters and numbers is refused and nothing is saved", async () => {
    const { save } = draw();
    fireEvent.change(screen.getByLabelText("Assistant name"), { target: { value: "<b>Vani</b>" } });
    expect(screen.getByRole("alert")).toHaveTextContent("Use letters and numbers, up to 24 characters.");
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    expect(save).not.toHaveBeenCalled();
  });
  it("saves the whole settings, says 'Saved.' and reads the screen again", async () => {
    const { save } = draw();
    fireEvent.change(screen.getByLabelText("Assistant name"), { target: { value: "Meera" } });
    fireEvent.click(screen.getByRole("radio", { name: /Male · calm/ }));
    fireEvent.click(screen.getByRole("switch", { name: "Talk about dues" }));
    fireEvent.change(screen.getByLabelText("Highest discount it may offer"), { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: "Sat" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(save).toHaveBeenCalledOnce());
    expect(save.mock.calls[0][0]).toMatchObject({ name: "Meera", voice: "male_calm", may: { dues: true }, maxDiscount: 5, hours: { days: ["mon", "tue", "wed", "thu", "fri"] } });
    expect(await screen.findByRole("status")).toHaveTextContent("Saved.");
    expect(refresh).toHaveBeenCalled();
  });
  it("hours that end before they start, or no day, cannot be saved", () => {
    draw();
    fireEvent.change(screen.getByLabelText("From"), { target: { value: "20:00" } });
    expect(screen.getByRole("alert")).toHaveTextContent("The end must be after the start, and at least one day must be on.");
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });
  it("a school sees no 'talk about dues', no discount and no order limit; its words are the school's", () => {
    draw({ modules: ["programmes", "fees"] });
    expect(screen.queryByRole("switch", { name: "Talk about dues" })).toBeNull();
    expect(screen.queryByLabelText("Highest discount it may offer")).toBeNull();
    expect(screen.queryByLabelText("Order above (rupees)")).toBeNull();
    expect(screen.getByRole("switch", { name: "Book campus visits" })).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Answer fee questions from your fee plan" })).toBeInTheDocument();
  });
  it("building materials books site visits and may talk about dues", () => {
    draw({ modules: ["materials"] });
    expect(screen.getByRole("switch", { name: "Book site and shop visits" })).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Talk about dues" })).toHaveAttribute("aria-checked", "true");
  });
  it("nobody but the Owner changes it: everything is switched off and Save is disabled", () => {
    draw({ canEdit: false });
    expect(screen.getByText("Only the Owner can change the assistant.")).toBeInTheDocument();
    expect(screen.getByLabelText("Assistant name")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });
  it("voice samples and the test call do not exist yet, and it says so instead of pretending", () => {
    draw();
    expect(screen.getByRole("button", { name: /Hear it/ })).toBeDisabled();
    expect(screen.getAllByText("Voice samples come with early access.").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "Try a test call (a simulation)" }));
    expect(screen.getByText("Test calls are not available yet. They come with AI calls (early access).")).toBeInTheDocument();
  });
  it("a save the server refuses says so", async () => {
    draw({ save: async () => ({ ok: false, error: "invalid" }) });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("That did not save. Check the name, the hours and the numbers.");
  });
  it("the voices, the languages and the days are radio groups and buttons with their state", () => {
    draw();
    expect(within(screen.getByRole("radiogroup", { name: "Voice" })).getAllByRole("radio")).toHaveLength(4);
    expect(screen.getByRole("radio", { name: "తెలుగు" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("button", { name: "Mon" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Sun" })).toHaveAttribute("aria-pressed", "false");
  });
  it("every word exists in all four languages", () => {
    for (const lang of ["te", "hi", "kn"] as const) for (const k of Object.keys(raw("en", null))) expect(raw(lang, null)[k], `${lang}:${k}`).toBeTruthy();
  });
  describe("the voice picker and the test call (job DQ part 3)", () => {
    const samples = { endpoint: "/app/tenants/t/voice-sample", mock: false };
    const made: { src: string; pause: ReturnType<typeof vi.fn>; fail: boolean }[] = [];
    const install = (fail = false) => {
      made.length = 0;
      vi.stubGlobal(
        "Audio",
        class {
          src: string;
          pause = vi.fn();
          onended: (() => void) | null = null;
          onerror: (() => void) | null = null;
          constructor(src: string) {
            this.src = src;
            made.push({ src, pause: this.pause, fail });
          }
          play() {
            return fail ? Promise.reject(new Error("blocked")) : Promise.resolve();
          }
        },
      );
    };
    afterEach(() => vi.unstubAllGlobals());

    it("draws a play button beside each voice that has a sample (not the owner's own voice) and the warm/crisp choice, only when samples are on", () => {
      draw();
      expect(document.querySelector("[data-sample]")).toBeNull();
      expect(screen.queryByRole("radio", { name: "Crisp" })).toBeNull();
      cleanup();
      draw({ samples });
      expect(document.querySelectorAll("[data-sample]").length).toBe(VOICES.filter((v) => v !== "own_voice").length);
      expect(document.querySelector('[data-sample="own_voice"]')).toBeNull();
      expect(screen.getByRole("radio", { name: "Warm" })).toHaveAttribute("aria-checked", "true");
    });
    it("plays the voice in the language and tone now chosen, the name now typed; a second press stops it; another voice replaces it", () => {
      install();
      draw({ samples });
      fireEvent.change(screen.getByLabelText("Assistant name"), { target: { value: "Asha" } });
      fireEvent.click(screen.getByRole("radio", { name: "Crisp" }));
      const first = document.querySelector('[data-sample="female_warm"]') as HTMLElement;
      fireEvent.click(first);
      expect(made[0].src).toBe("/app/tenants/t/voice-sample?voice=female_warm&lang=te&tone=crisp&name=Asha");
      expect(first).toHaveAttribute("aria-pressed", "true");
      fireEvent.click(first);
      expect(made[0].pause).toHaveBeenCalled();
      expect(first).toHaveAttribute("aria-pressed", "false");
      fireEvent.click(document.querySelector('[data-sample="male_calm"]') as HTMLElement);
      expect(made[1].src).toContain("voice=male_calm");
    });
    it("labels it as a preview of the voice with the assistant's name, and shows the words that are spoken (with the real names) once they are read", async () => {
      install();
      const fetched = vi.fn(async () => ({ ok: true, json: async () => ({ text: "Hello, this is Asha from Pavers Corner." }) }));
      vi.stubGlobal("fetch", fetched);
      draw({ samples });
      fireEvent.change(screen.getByLabelText("Assistant name"), { target: { value: "Asha" } });
      expect(document.querySelector('[data-part="preview-label"]')).toHaveTextContent("Preview of the voice. In real calls Asha talks naturally and answers what the customer says.");
      fireEvent.click(document.querySelector('[data-sample="female_warm"]') as HTMLElement);
      expect(await screen.findByText(/Hello, this is Asha from Pavers Corner\./)).toBeInTheDocument();
      expect(fetched).toHaveBeenCalledWith("/app/tenants/t/voice-sample?voice=female_warm&lang=te&tone=warm&name=Asha&text=1", { cache: "no-store" });
    });
    it("the test screens' own sound has no words to show and asks for none", () => {
      install();
      const fetched = vi.fn();
      vi.stubGlobal("fetch", fetched);
      draw({ samples: { ...samples, mock: true } });
      fireEvent.click(document.querySelector('[data-sample="female_warm"]') as HTMLElement);
      expect(fetched).not.toHaveBeenCalled();
    });
    it("a sample the browser cannot play says so, in words", async () => {
      install(true);
      draw({ samples });
      fireEvent.click(document.querySelector('[data-sample="female_warm"]') as HTMLElement);
      expect(await screen.findByRole("alert")).toHaveTextContent(/sample/i);
    });
    it("says the samples are only a sound of the test screens when they are", () => {
      draw({ samples });
      expect(screen.queryByText(/It is not how they will sound/)).toBeNull();
      cleanup();
      draw({ samples: { ...samples, mock: true } });
      expect(screen.getByText(/It is not how they will sound/)).toBeInTheDocument();
    });
    it("shows the AI disclosure in the preview, and 'Hear it' plays the chosen voice", () => {
      install();
      draw({ samples });
      expect(screen.getByText(/Unless you turn it off in the opening line, every call opens by saying it is an AI assistant/)).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: /Hear it/ }));
      expect(made).toHaveLength(1);
    });
    it("the test call shows what the assistant would say and record, as plain text, and says nothing was called", async () => {
      const testCall = vi.fn(async (): Promise<TestCallResult> => ({
        ok: true,
        call: { note: "This is a simulation.", transcript: [{ speaker: "assistant", text: "Hello <b>there</b>" }, { speaker: "customer", text: "Yes" }], outcome: { outcome: "positive", category: "interested", reason: "Asked for details." } },
      }));
      draw({ testCall });
      fireEvent.click(screen.getByRole("button", { name: "Try a test call (a simulation)" }));
      const box = await screen.findByText("What the test call would be");
      const region = box.closest("[data-part='test-call']") as HTMLElement;
      expect(within(region).getByText("This is a simulation.")).toBeInTheDocument();
      expect(region.textContent).toContain("Hello <b>there</b>");
      expect(region.querySelector("b")).toBeNull();
      expect(region.textContent).toContain("Asked for details.");
    });
    it("a test call that fails says so and the button comes back", async () => {
      draw({ testCall: async () => ({ ok: false, error: "mfa" }) });
      const button = screen.getByRole("button", { name: "Try a test call (a simulation)" });
      fireEvent.click(button);
      expect(await screen.findByRole("alert")).toBeInTheDocument();
      await waitFor(() => expect(button).toBeEnabled());
    });
  });
});
