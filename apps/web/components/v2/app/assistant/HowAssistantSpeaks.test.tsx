import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { wordsFor } from "@/i18n/app-words";
import { CALL_LANG_NAMES } from "@/lib/assistant/types";
import { parseHowSpeaks, REGIONS, type HowSpeaks } from "@/lib/talk-training/speaks";
import { EXAMPLES, exampleLine } from "@/lib/talk-training/speaks-examples";
import type { TalkTrainingState } from "@/lib/talk-training/types";

import { HowAssistantSpeaks, changeOf } from "./HowAssistantSpeaks";
import { TalkTraining } from "./TalkTraining";

const W = wordsFor("en", ["tt.", "sp.", "today.err.mfa.link"]);
const t = (key: string, vars?: Record<string, string | number>) => (W[key] ?? key).replace(/\{(\w+)\}/g, (m, k: string) => (vars && k in vars ? String(vars[k]) : m));
const lang = (style = "everyday_mixed", region = "neutral", saved = false) => ({ style, region, saved, examples: "draft" });
const RAW = (over: Record<string, unknown> = {}) => ({
  tone: { value: "friendly", source: "pack_default", pack_default: "friendly", options: ["respectful", "friendly"] },
  words: { languages: { te: lang(), kn: lang(), hi: lang(), ta: lang(), en: lang(), ml: lang() }, options: { styles: ["everyday_mixed", "everyday_pure"] } },
  introduce_as: { kind: "business", text: null, options: ["business", "owner", "custom"], owner_name: "Gowtham", preview: { te: "x", en: "y" } },
  pack_defaults: { tone: "friendly", words: "everyday_mixed", region: "neutral" },
  legacy_address: null,
  updated_at: null,
  ...over,
});
const H = (over: Record<string, unknown> = {}): HowSpeaks => parseHowSpeaks(RAW(over)) as HowSpeaks;
afterEach(cleanup);

const mount = (h: HowSpeaks = H(), save: (c: unknown) => Promise<{ ok: true; data: HowSpeaks } | { ok: false; error: string }> = vi.fn(async () => ({ ok: true as const, data: h })), off = false, demo = true) =>
  render(<HowAssistantSpeaks t={t} langNames={CALL_LANG_NAMES} business="Lakshmi Silks" off={off} panel={{ initial: h, demo, save: save as never }} securityHref="/app/security" />);

describe("How your assistant speaks (owner decision 11 Nov; C1's contract docs/contracts/how-assistant-speaks.md)", () => {
  it("one panel: Tone (Respectful, Friendly, never Casual), Words (never Formal), Region and Introduce as; the test mode says it is made up", () => {
    mount();
    const root = document.querySelector('[data-part="sp-panel"]') as HTMLElement;
    expect(within(root).getByRole("heading", { name: "How your assistant speaks" })).toBeInTheDocument();
    expect(root.querySelector('[data-part="sp-notsaved"]')).toHaveTextContent("Test mode");
    const tone = root.querySelector('[data-part="sp-tone"]') as HTMLElement;
    expect([...tone.querySelectorAll("input")].map((i) => i.value)).toEqual(["respectful", "friendly"]);
    expect(within(tone).getByRole("radio", { name: /Friendly/ })).toBeChecked();
    expect(tone).toHaveTextContent("Casual is only for your own test calls");
    expect(root).not.toHaveTextContent(/Formal/);
    const words = root.querySelector('[data-part="sp-words"]') as HTMLElement;
    expect([...words.querySelectorAll("input")].map((i) => i.value)).toEqual(["everyday_mixed", "everyday_pure"]);
    expect(root.querySelector('[data-part="tt-introduce"]')).toBeInTheDocument();
    cleanup();
    mount(H(), undefined, false, false);
    expect(document.querySelector('[data-part="sp-notsaved"]')).toBeNull(); // the real thing says nothing of a test mode
  });
  it("Tone says where it came from: chosen from the old \"How to address customers\", or the business type's usual", () => {
    mount(H({ tone: { value: "respectful", source: "migrated", pack_default: "friendly", options: [] }, legacy_address: "garu" }));
    expect(document.querySelector('[data-part="sp-tone"]')).toHaveTextContent("Chosen for you from your old \"How to address customers\" setting. Save to keep it.");
    expect(within(document.querySelector('[data-part="sp-tone"]') as HTMLElement).getByRole("radio", { name: /Respectful/ })).toBeChecked();
    cleanup();
    mount(H({ tone: { value: "respectful", source: "pack_default", pack_default: "respectful", options: [] } }));
    expect(document.querySelector('[data-part="sp-tone-source"]')).toHaveTextContent("The usual for your kind of business is Respectful.");
    cleanup();
    mount(H({ tone: { value: "friendly", source: "saved", pack_default: "friendly", options: [] } }));
    expect(document.querySelector('[data-part="sp-tone-source"]')).toBeNull();
  });
  it("Words is ONE choice for all languages by default; \"Set per language\" opens the chooser, which opens by itself where the languages already differ; Region is for Telugu, Kannada and Tamil with their own regions", () => {
    mount();
    const words = document.querySelector('[data-part="sp-words"]') as HTMLElement;
    expect(words.querySelector('[data-part="sp-words-all"]')).toBeInTheDocument();
    expect([...words.querySelectorAll("input")].map((i) => i.value)).toEqual(["everyday_mixed", "everyday_pure"]);
    expect(within(words).getByRole("radio", { name: /with English words/ })).toBeChecked();
    expect(words.querySelectorAll("button[aria-pressed]")).toHaveLength(0); // no language chips yet
    fireEvent.click(within(words).getByRole("button", { name: "Set per language" }));
    expect([...words.querySelectorAll("button[aria-pressed]")].map((b) => b.textContent)).toEqual(["తెలుగు", "ಕನ್ನಡ", "हिन्दी", "தமிழ்"]);
    fireEvent.click(within(words).getByRole("button", { name: "ಕನ್ನಡ" }));
    fireEvent.click(within(words).getByRole("radio", { name: /fewer English words/ }));
    fireEvent.click(within(words).getByRole("button", { name: "తెలుగు" }));
    expect(within(words).getByRole("radio", { name: /with English words/ })).toBeChecked(); // Telugu is as it was
    fireEvent.click(within(words).getByRole("button", { name: "Use one choice for all languages" }));
    expect(words.querySelector('[data-part="sp-words-differ"]')).toHaveTextContent("Your languages have different choices");
    expect(within(words).getByRole("radio", { name: /with English words/ })).not.toBeChecked(); // they differ: neither is shown as chosen
    cleanup();
    const diff = H({ words: { languages: { te: lang(), kn: lang("everyday_pure"), hi: lang(), ta: lang(), en: lang(), ml: lang() }, options: {} } });
    mount(diff);
    expect(document.querySelector('[data-part="sp-words"] button[aria-pressed]')).toBeInTheDocument(); // opened by itself: they already differ
    cleanup();
    mount();
    const region = document.querySelector('[data-part="sp-region"]') as HTMLElement;
    expect([...region.querySelectorAll("input")].map((i) => i.value)).toEqual([...REGIONS.te]);
    fireEvent.click(within(region).getByRole("radio", { name: "Telangana" }));
    expect(within(region).getByRole("button", { name: /తెలుగు/ })).toHaveTextContent("·");
    fireEvent.click(within(region).getByRole("button", { name: "தமிழ்" }));
    expect([...region.querySelectorAll("input")].map((i) => i.value)).toEqual([...REGIONS.ta]);
    expect(within(region).getByRole("radio", { name: "Neutral (understood everywhere)" })).toBeChecked();
  });
  it("Save sends only what changed, in the contract's words (the single Words choice goes to every language), and shows what the API answered; nothing changed = nothing to save", async () => {
    const answered = H({ tone: { value: "respectful", source: "saved", pack_default: "friendly", options: [] } });
    const save = vi.fn(async () => ({ ok: true as const, data: answered }));
    mount(H(), save);
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    fireEvent.click(within(document.querySelector('[data-part="sp-tone"]') as HTMLElement).getByRole("radio", { name: /Respectful/ }));
    const words = document.querySelector('[data-part="sp-words"]') as HTMLElement;
    fireEvent.click(within(words).getByRole("radio", { name: /fewer English words/ }));
    fireEvent.click(within(document.querySelector('[data-part="sp-region"]') as HTMLElement).getByRole("radio", { name: "Telangana" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(save).toHaveBeenCalledWith({ tone: "respectful", words: { te: { style: "everyday_pure", region: "telangana" }, kn: { style: "everyday_pure" }, hi: { style: "everyday_pure" }, ta: { style: "everyday_pure" } } })); // the one choice writes the same value to every language
    expect(await screen.findByRole("status")).toHaveTextContent("Saved.");
    await waitFor(() => expect(screen.getByRole("button", { name: "Save" })).toBeDisabled()); // what was saved is the new start (the button says "Saving…" until the transition ends)
  });
  it("Introduce as is part of it: its rules and preview as before, \"My name\" is filled from the profile and cannot be used with no first name; Save waits for a good one", async () => {
    const save = vi.fn(async () => ({ ok: true as const, data: H() }));
    mount(H(), save);
    const box = document.querySelector('[data-part="tt-introduce"]') as HTMLElement;
    fireEvent.click(within(box).getByRole("radio", { name: "My name" }));
    expect(screen.getByLabelText("Your name")).toHaveValue("Gowtham");
    expect(box.querySelector('[data-part="tt-intro-preview"]')).toHaveTextContent("Hello, this is Gowtham's AI assistant.");
    fireEvent.click(within(box).getByRole("radio", { name: "My own words" }));
    fireEvent.change(screen.getByLabelText("Your own words"), { target: { value: "a human assistant" } });
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Your own words"), { target: { value: "Gowtham's AI assistant" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(save).toHaveBeenCalledWith({ introduceAs: { kind: "custom", text: "Gowtham's AI assistant" } }));
    cleanup();
    mount(H({ introduce_as: { kind: "business", text: null, options: [], owner_name: null } }));
    const none = document.querySelector('[data-part="tt-introduce"]') as HTMLElement;
    expect(within(none).getByRole("radio", { name: "My name" })).toBeDisabled();
    expect(none.querySelector('[data-part="tt-intro-noname"]')).toHaveTextContent("Your first name is not in your profile yet");
  });
  it("a refusal is said in words (the second factor with a link to Security); an Admin or Viewer reads it and has no Save", async () => {
    const save = vi.fn(async (): Promise<{ ok: true; data: HowSpeaks } | { ok: false; error: string }> => ({ ok: false, error: "mfa" }));
    mount(H(), save);
    fireEvent.click(within(document.querySelector('[data-part="sp-tone"]') as HTMLElement).getByRole("radio", { name: /Respectful/ }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Saving here needs your two-step code first.");
    expect(screen.getByRole("link")).toHaveAttribute("href", "/app/security");
    cleanup();
    mount(H(), undefined, true);
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
    expect(within(document.querySelector('[data-part="sp-tone"]') as HTMLElement).getByRole("radio", { name: /Friendly/ })).toBeDisabled();
  });
  it("Hear an example: a sample line in the chosen language for the chosen tone and words, with the business name; it follows the choices; marked as a draft", () => {
    mount();
    const tone = document.querySelector('[data-part="sp-tone"]') as HTMLElement;
    expect(tone.querySelector('[data-part="sp-example-tone"]')).toBeNull();
    fireEvent.click(within(tone).getByRole("button", { name: "Hear an example" }));
    const ex = tone.querySelector('[data-part="sp-example-tone"]') as HTMLElement;
    expect(ex.querySelector('[data-part="sp-line"]')).toHaveTextContent(exampleLine("friendly", "everyday_mixed", "te", "Lakshmi Silks"));
    expect(ex.querySelector('[data-part="sp-line"]')).toHaveAttribute("lang", "te");
    expect(ex).toHaveTextContent("A native reader has not checked it yet");
    expect(ex).toHaveTextContent("recorded samples come later");
    fireEvent.click(within(ex).getByRole("button", { name: "English" }));
    expect(ex.querySelector('[data-part="sp-line"]')).toHaveTextContent("Hi! This is the AI assistant of Lakshmi Silks.");
    fireEvent.click(within(tone).getByRole("radio", { name: /Respectful/ }));
    expect(ex.querySelector('[data-part="sp-line"]')).toHaveTextContent("Good morning. This is the AI assistant of Lakshmi Silks.");
    fireEvent.click(within(ex).getByRole("button", { name: "ಕನ್ನಡ" }));
    fireEvent.click(within(document.querySelector('[data-part="sp-words"]') as HTMLElement).getByRole("radio", { name: /fewer English words/ })); // one choice for all languages: Kannada too
    expect(ex.querySelector('[data-part="sp-line"]')).toHaveTextContent(exampleLine("respectful", "everyday_pure", "kn", "Lakshmi Silks"));
    fireEvent.click(within(tone).getByRole("button", { name: "Hear an example" }));
    expect(tone.querySelector('[data-part="sp-example-tone"]')).toBeNull();
  });
  it("every tone, word style and language has an example line that says it is an AI assistant and names no price, promise or number", () => {
    for (const l of ["te", "kn", "hi", "en"] as const) for (const tn of ["respectful", "friendly"] as const) for (const st of ["everyday_mixed", "everyday_pure"] as const) {
      const line = exampleLine(tn, st, l, "Lakshmi Silks");
      expect(line, `${l} ${tn} ${st}`).toMatch(/AI assistant/);
      expect(line).not.toMatch(/\d|₹|%|guarantee/i);
      expect(line).toContain("Lakshmi Silks");
    }
    expect(Object.keys(EXAMPLES).sort()).toEqual(["en", "hi", "kn", "te"]);
  });
  it("changeOf: nothing changed is null; a region alone, and Introduce as with the same text, are not sent twice", () => {
    const h = H();
    const same = { tone: h.tone.value, words: Object.fromEntries((["te", "kn", "hi", "ta"] as const).map((l) => [l, { style: h.words[l].style, region: h.words[l].region }])) as never, introduceAs: { kind: "business" as const, text: null } };
    expect(changeOf(h, same)).toBeNull();
    expect(changeOf(h, { ...same, words: { ...(same.words as Record<string, unknown>), te: { style: "everyday_mixed", region: "coastal" } } as never })).toEqual({ words: { te: { region: "coastal" } } });
    expect(changeOf(h, { ...same, introduceAs: { kind: "business", text: "ignored" } })).toBeNull();
  });
});

describe("in Talk training", () => {
  const DOC = { greeting: {}, address: "plain" as const, questions: ["What is the saree for?"], neverSay: ["guaranteed"], objections: [], examples: [], sayLike: [], introduceAs: { kind: "business" as const, text: null } };
  const STATE: TalkTrainingState = { training: DOC, defaults: DOC, saved: true, rules: [], updatedAt: null };
  const show = (speaks: boolean) => render(<TalkTraining words={W} initial={STATE} langNames={CALL_LANG_NAMES} canEdit securityHref="/s" business="Lakshmi Silks" speaks={speaks ? { initial: H(), demo: true, save: vi.fn() as never } : null} actions={{ save: vi.fn(), reset: vi.fn() }} />);
  it("with the panel it replaces \"How to address customers\" and holds the only Introduce as; without it, Talk training is as it was", () => {
    show(true);
    expect(document.querySelector('[data-part="tt-address"]')).toBeNull();
    expect(document.querySelectorAll('[data-part="tt-introduce"]')).toHaveLength(1);
    expect((document.querySelector('[data-part="sp-panel"]') as HTMLElement).querySelector('[data-part="tt-introduce"]')).toBeInTheDocument();
    cleanup();
    show(false);
    expect(document.querySelector('[data-part="sp-panel"]')).toBeNull();
    expect(document.querySelector('[data-part="tt-address"]')).toBeInTheDocument();
    expect(document.querySelectorAll('[data-part="tt-introduce"]')).toHaveLength(1);
  });
});
