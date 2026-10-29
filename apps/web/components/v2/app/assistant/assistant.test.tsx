import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

import { appDict } from "@/i18n/app";
import { assistantProfile } from "@/lib/assistant/defaults";
import type { TestCallResult } from "@/lib/assistant/test-call";
import { withModuleWords } from "@/lib/packs/module-words";

import { AssistantSettings } from "./AssistantSettings";

const raw = (lang: "en" | "te" | "hi" | "kn", modules: string[] | null) => withModuleWords(Object.fromEntries(Object.entries(appDict(lang) as Record<string, string>).filter(([k]) => k.startsWith("asst.") || k === "bv.speaking.in")), modules ? { modules } : null);
const langs = { te: "తెలుగు", hi: "हिन्दी", kn: "ಕನ್ನಡ", en: "English", ta: "தமிழ்", ml: "മലയാളം" };
const draw = (over: Partial<{ modules: string[] | null; canEdit: boolean; saved: boolean; save: (i: unknown) => Promise<{ ok: true } | { ok: false; error: string }>; samples: { endpoint: string; mock: boolean } | null; voiceInUse: { name: string; label: string } | null; defaultName: string; initialName: string; openingLine: { lines: Record<string, string>; defaults: Record<string, string> }; testCall: () => Promise<TestCallResult> }> = {}) => {
  const modules = over.modules === undefined ? null : over.modules;
  const profile = assistantProfile(modules);
  const save = (over.save ?? vi.fn(async () => ({ ok: true as const }))) as ReturnType<typeof vi.fn> & ((i: unknown) => Promise<{ ok: true } | { ok: false; error: string }>);
  render(<AssistantSettings words={raw("en", modules)} initial={over.initialName === undefined ? profile.defaults : { ...profile.defaults, name: over.initialName }} profile={profile} shop="Acme Silks" langs={langs} canEdit={over.canEdit ?? true} testMode saved={over.saved ?? false} actions={{ save, ...(over.testCall ? { testCall: over.testCall } : {}) }} samples={over.samples ?? null} voiceInUse={over.voiceInUse ?? null} defaultName={over.defaultName ?? null} openingLine={(over.openingLine as never) ?? null} />);
  return { save, profile };
};
afterEach(() => {
  cleanup();
  refresh.mockClear();
});

describe("Settings > AI assistant", () => {
  it("the preview names the voice in force as 'Speaking in <language> · <voice>' and the old persona words (voice, way of talking, speed) are gone; the name is the default 'Your assistant' until the owner chooses one", () => {
    draw({ voiceInUse: { name: "Ramya", label: "Warm" }, defaultName: "Your assistant" });
    const aside = document.querySelector("aside") as HTMLElement;
    expect(aside).toHaveTextContent("Your assistant · AI assistant");
    expect(aside).toHaveTextContent("Speaking in తెలుగు · Ramya");
    expect(document.body.textContent).not.toMatch(/Warm and friendly|Respectful|1\.0×|Speaking speed/);
    expect(screen.queryByRole("slider")).toBeNull();
    expect(document.body.textContent).not.toMatch(/Male · calm|Female · warm|Male · lively|Female · clear/);
    expect(screen.queryByRole("radiogroup", { name: /Voice/ })).toBeNull();
    expect(aside.querySelector('[data-part="preview-line"]')?.textContent).not.toMatch(/your assistant|Vijaya/i); // the example line names nobody
  });
  it("there is no persona list, no warm/crisp choice and no sample buttons here any more: the voice is chosen in ONE place, Settings > AI assistant > Voice (the picker)", () => {
    draw({});
    expect(screen.queryByRole("radiogroup", { name: /Voice/ })).toBeNull();
    expect(document.querySelector("[data-sample]")).toBeNull();
    expect(screen.queryByRole("radio", { name: /^(Crisp|Warm)$/ })).toBeNull();
    cleanup();
    draw({ samples: { endpoint: "/app/tenants/t/voice-sample", mock: false } });
    expect(screen.queryByRole("radiogroup", { name: /Voice/ })).toBeNull();
    expect(screen.getByRole("radiogroup", { name: /Languages|Language/ })).toBeInTheDocument();
  });
  it("with the API on, the card shows the ONE line the API resolves (the same words 'Hear it' speaks, asked from the same route) and there is no second text box or example sentence", async () => {
    const asked: string[] = [];
    const said = "నమస్కారం రవి గారూ, నేను కల్లు, ఆక్మీ సిల్క్స్ నుంచి.";
    vi.stubGlobal("fetch", vi.fn(async (url: string) => (asked.push(url), { ok: true, json: async () => ({ text: said }) })));
    vi.stubGlobal("Audio", class { onended: (() => void) | null = null; onerror: (() => void) | null = null; play() { return Promise.resolve(); } pause() {} });
    draw({ voiceInUse: { name: "Ramya", label: "Warm" }, samples: { endpoint: "/app/tenants/t/voice-sample", mock: false }, openingLine: { lines: {}, defaults: { te: "template {business}" } } });
    await waitFor(() => expect(document.querySelector('aside [data-part="preview-line"]')).toHaveTextContent(said));
    expect(asked.every((u) => u.includes("&text=1"))).toBe(true);
    expect(document.body.textContent).not.toContain("template");
    fireEvent.click(screen.getByRole("button", { name: /Hear it/ }));
    expect(document.querySelector('[data-part="preview-text"]')).toBeNull();
    expect(document.querySelector('aside [data-part="preview-line"]')).toHaveTextContent(said);
    vi.unstubAllGlobals();
  });
  it("the card says the opening line a call speaks: the saved line, else the default of the language, with the real business and the name; no separate example sentence", () => {
    const defaults = { te: "నమస్కారం అండీ, నేను {business} నుంచి AI assistant ని మాట్లాడుతున్నాను.", en: "Hello, this is the AI assistant of {business}." };
    draw({ initialName: "", defaultName: "your assistant", openingLine: { lines: {}, defaults } });
    expect(document.querySelector('[data-part="preview-line"]')).toHaveTextContent("నమస్కారం అండీ, నేను Acme Silks నుంచి AI assistant ని మాట్లాడుతున్నాను.");
    cleanup();
    draw({ initialName: "Meera", openingLine: { lines: { te: "{assistant} here from {business}, hello {customer}." }, defaults } });
    expect(document.querySelector('[data-part="preview-line"]')).toHaveTextContent("Meera here from Acme Silks, hello రవి.");
  });
  it("a workspace that has never saved has NO name: the box is empty with \"your assistant\" as its hint, the card says \"your assistant\", and saving asks for a name", () => {
    draw({ initialName: "", defaultName: "your assistant", saved: false });
    const box = screen.getByLabelText("Assistant name") as HTMLInputElement;
    expect(box.value).toBe("");
    expect(box.placeholder).toBe("your assistant");
    expect(screen.getByText(/Give your assistant a name to save/)).toBeInTheDocument();
    expect(box).not.toHaveAttribute("aria-invalid", "true"); // nothing is wrong yet, it is just not named
    expect(screen.getByRole("button", { name: /^Save/ })).toBeDisabled();
    fireEvent.change(box, { target: { value: "Meera" } });
    expect(screen.queryByText(/Give your assistant a name to save/)).toBeNull();
    expect(screen.getByRole("button", { name: /^Save/ })).not.toBeDisabled();
  });
  it("starts from the defaults of the business type, says so, and says that mentioning 'AI assistant' in the greeting is the owner's choice", () => {
    draw();
    expect(screen.getByRole("heading", { name: "Set up your AI assistant" })).toBeInTheDocument();
    expect(screen.getByText(/standard settings for your kind of business/)).toBeInTheDocument();
    expect(screen.getByLabelText("Assistant name")).toHaveValue("your assistant");
    expect(screen.getByText(/Customers hear: “your assistant, the assistant of Acme Silks\.” Whether the greeting also says it is an AI assistant is your choice, in the opening line below\./)).toBeInTheDocument();
    expect(screen.getByText("Test mode: your choices are kept on this device only.")).toBeInTheDocument();
  });
  it("the preview follows the name and the language, and the circle speaks", () => {
    draw();
    fireEvent.change(screen.getByLabelText("Assistant name"), { target: { value: "Meera" } });
    expect(screen.getByText("Meera · AI assistant")).toBeInTheDocument();
    const line = () => document.querySelector('[data-part="preview-line"]')!;
    expect(line().getAttribute("lang")).toBe("te");
    expect(line().textContent).toContain("Meera");
    expect(line().textContent).toContain("Acme Silks");
    fireEvent.click(screen.getByRole("radio", { name: "English" }));
    expect(line().getAttribute("lang")).toBe("en");
    expect(line().textContent).toContain("I'm Meera, the AI assistant at Acme Silks");
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
    fireEvent.click(screen.getByRole("switch", { name: "Talk about dues" }));
    fireEvent.change(screen.getByLabelText("Highest discount it may offer"), { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: "Sat" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(save).toHaveBeenCalledOnce());
    expect(save.mock.calls[0][0]).toMatchObject({ name: "Meera", may: { dues: true }, maxDiscount: 5, hours: { days: ["mon", "tue", "wed", "thu", "fri"] } });
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
  it("the languages and the days are radio groups and buttons with their state", () => {
    draw();
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

    it("'Hear it' on the preview card asks the ONE preview route (the saved line in the voice in force), says so in words when the browser cannot play it, and asks for no words in the test screens", async () => {
      install(true);
      draw({ samples });
      fireEvent.click(screen.getByRole("button", { name: /Hear it/ }));
      expect(await screen.findByRole("alert")).toHaveTextContent(/sample/i);
      cleanup();
      install();
      const fetched = vi.fn();
      vi.stubGlobal("fetch", fetched);
      draw({ samples: { ...samples, mock: true } });
      fireEvent.click(screen.getByRole("button", { name: /Hear it/ }));
      expect(fetched).not.toHaveBeenCalled();
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
