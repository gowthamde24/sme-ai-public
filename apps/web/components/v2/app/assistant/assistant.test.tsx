import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

import { appDict } from "@/i18n/app";
import { assistantProfile } from "@/lib/assistant/defaults";
import { VOICES } from "@/lib/assistant/types";
import { withModuleWords } from "@/lib/packs/module-words";

import { AssistantSettings } from "./AssistantSettings";

const raw = (lang: "en" | "te" | "hi" | "kn", modules: string[] | null) => withModuleWords(Object.fromEntries(Object.entries(appDict(lang) as Record<string, string>).filter(([k]) => k.startsWith("asst."))), modules ? { modules } : null);
const langs = { te: "తెలుగు", hi: "हिन्दी", kn: "ಕನ್ನಡ", en: "English" };
const voiceNames = Object.fromEntries(VOICES.map((v) => [v, (appDict("en") as Record<string, string>)[`asst.voice.${v}`]])) as Record<(typeof VOICES)[number], string>;
const draw = (over: Partial<{ modules: string[] | null; canEdit: boolean; saved: boolean; save: (i: unknown) => Promise<{ ok: true } | { ok: false; error: string }> }> = {}) => {
  const modules = over.modules === undefined ? null : over.modules;
  const profile = assistantProfile(modules);
  const save = (over.save ?? vi.fn(async () => ({ ok: true as const }))) as ReturnType<typeof vi.fn> & ((i: unknown) => Promise<{ ok: true } | { ok: false; error: string }>);
  render(<AssistantSettings words={raw("en", modules)} initial={profile.defaults} profile={profile} shop="Acme Silks" langs={langs} voiceNames={voiceNames} canEdit={over.canEdit ?? true} testMode saved={over.saved ?? false} actions={{ save }} />);
  return { save, profile };
};
afterEach(() => {
  cleanup();
  refresh.mockClear();
});

describe("Settings > AI assistant", () => {
  it("starts from the defaults of the business type, says so, and says the words 'AI assistant' are always said", () => {
    draw();
    expect(screen.getByRole("heading", { name: "Set up your AI assistant" })).toBeInTheDocument();
    expect(screen.getByText(/standard settings for your kind of business/)).toBeInTheDocument();
    expect(screen.getByLabelText("Assistant name")).toHaveValue("Vijaya");
    expect(screen.getByText(/Customers hear: “Vijaya, the AI assistant of Acme Silks\.” The words “AI assistant” are always said\./)).toBeInTheDocument();
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
    fireEvent.click(screen.getByRole("button", { name: "Call me now for a test" }));
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
});
