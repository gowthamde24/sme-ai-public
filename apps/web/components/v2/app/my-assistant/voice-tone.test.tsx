import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

import { wordsFor } from "@/i18n/app-words";
import { CALL_LANG_NAMES } from "@/lib/assistant/types";
import { parseHowSpeaks, type HowSpeaks } from "@/lib/talk-training/speaks";
import type { TalkTrainingState } from "@/lib/talk-training/types";
import { MOCK_VOICES } from "@/lib/voice-picker/types";

import { VoiceTone, type VoiceToneProps } from "./VoiceTone";

const W = (lang: "en" | "te" | "hi" | "kn" = "en") => wordsFor(lang, ["tt.", "sp.", "vt.", "mya.v.", "bv.end."], ["today.err.mfa.link", "ope.preview", "vp.mock", "vp.err.sample", "vp.owneronly"]);
const lang = (style = "everyday_mixed") => ({ style, region: "neutral", saved: false, examples: "draft" });
const RAW = (over: Record<string, unknown> = {}) => ({
  tone: { value: "friendly", source: "pack_default", pack_default: "friendly", options: ["respectful", "friendly"] },
  words: { languages: { te: lang(), kn: lang(), hi: lang(), ta: lang(), en: lang() }, options: { styles: ["everyday_mixed", "everyday_pure"] } },
  introduce_as: { kind: "business", text: null, options: ["business", "owner", "custom"], owner_name: "Gowtham", preview: { te: "x", en: "y" } },
  pack_defaults: { tone: "friendly", words: "everyday_mixed", region: "neutral" },
  legacy_address: null,
  updated_at: null,
  ...over,
});
const H = (over: Record<string, unknown> = {}): HowSpeaks => parseHowSpeaks(RAW(over)) as HowSpeaks;
const DOC = { greeting: {}, address: "plain" as const, questions: ["What is the saree for?"], neverSay: ["guaranteed"], objections: [{ a: "Too costly", b: "We have sarees in many ranges." }], examples: [], sayLike: [], introduceAs: { kind: "business" as const, text: null } };
const SUGGESTED_EN = "Hello {customer}, this is {assistant}, the {agent_role} of {business}. Do you have a minute?";
const STATE: TalkTrainingState = { training: DOC, defaults: { ...DOC, greeting: { te: "నమస్కారం {customer} గారూ, నేను {assistant}, {business} {agent_role}.", en: SUGGESTED_EN } }, saved: false, rules: ["Always says it is an AI assistant."], updatedAt: null };

afterEach(() => {
  cleanup();
  refresh.mockReset();
  vi.unstubAllGlobals();
});

function setup(over: Partial<VoiceToneProps> = {}) {
  const choose = vi.fn(async () => ({ ok: true as const }));
  const actions = { save: vi.fn(async (d: unknown) => ({ ok: true as const, data: { ...STATE, saved: true, training: d as never } })), reset: vi.fn(async () => ({ ok: true as const, data: STATE })) };
  const speaks = { initial: H(), demo: false, save: vi.fn(async () => ({ ok: true as const, data: H({ tone: { value: "respectful", source: "saved", pack_default: "friendly", options: [] } }) })) };
  const props: VoiceToneProps = {
    words: W(),
    uiLang: "en",
    picker: { voices: MOCK_VOICES, choices: {}, gender: "female", fake: false },
    languages: ["te", "en", "hi", "kn"],
    first: "en",
    endpoint: "/app/tenants/t1/voice-pick",
    choose,
    training: STATE,
    actions,
    canEdit: true,
    securityHref: "/app/security",
    speaks,
    langNames: CALL_LANG_NAMES,
    business: "Lakshmi Silks",
    assistantName: "Priya",
    hearIt: { endpoint: "/app/tenants/t1/voice-sample" },
    ...over,
  };
  render(<VoiceTone {...props} />);
  return { choose, actions, speaks };
}
const root = () => document.querySelector('[data-part="mya-voice-tone"]') as HTMLElement;
const box = () => document.querySelector('[data-part="vt-greeting-box"]') as HTMLElement;

describe("Voice & tone: one plain card (owner, 19 Nov 2026)", () => {
  it("has ONE heading, the plain sentences, at most three choices in view and More choices for the rest", () => {
    setup();
    expect(within(root()).getAllByRole("heading", { level: 2 }).map((h) => h.textContent)).toEqual(["How your assistant sounds"]);
    for (const old of ["How I talk to customers", "How your assistant speaks", "How it talks to customers", "Choose a sound"]) expect(root()).not.toHaveTextContent(old);
    expect(root()).toHaveTextContent("Voice");
    expect(root()).toHaveTextContent("Speak to customers:");
    expect(root()).toHaveTextContent("Greeting");
    expect(document.querySelector('[data-part="more-choices"]')).toHaveTextContent("More choices");
    // the visible choices: a voice, a way of speaking, the greeting
    expect(document.querySelectorAll('[data-part="vt-voice"],[data-part="vt-tone"],[data-part="vt-greeting"]')).toHaveLength(3);
    // a round radio list, nothing else, for the voice
    expect(root().querySelectorAll('input[type="checkbox"]')).toHaveLength(0);
  });

  it("the voice: three, one play button and one line each, the chosen one marked; choosing saves at once with the picker's own action", async () => {
    const { choose } = setup({ first: "te" });
    const rows = [...document.querySelectorAll("[data-sound]")] as HTMLElement[];
    expect(rows.map((r) => r.getAttribute("data-sound"))).toEqual(["warm", "calm", "bright"]);
    expect(within(rows[0]).getAllByRole("button")).toHaveLength(1);
    expect(rows[0]).toHaveTextContent("Friendly and close, like a neighbour.");
    expect(rows[0]).toHaveAttribute("data-selected", "true");
    expect(rows[0]).toHaveTextContent("In use");
    expect(within(rows[1]).queryAllByRole("button")).toHaveLength(0); // no voice with this sound in Telugu
    expect(rows[1]).toHaveTextContent("No voice with this sound in this language yet.");
    fireEvent.click(within(rows[2]).getByRole("radio"));
    await waitFor(() => expect(choose).toHaveBeenCalledWith("te", "te-sindhu"));
    await waitFor(() => expect(screen.getByText("Sound saved.")).toBeInTheDocument());
    expect(refresh).toHaveBeenCalled();
  });

  it("a voice that cannot be saved says so and goes back", async () => {
    const choose = vi.fn(async () => ({ ok: false as const, error: "down" }));
    setup({ choose, first: "te" });
    fireEvent.click(within(document.querySelector('[data-sound="bright"]') as HTMLElement).getByRole("radio"));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Could not save the sound."));
    expect(document.querySelector('[data-sound="warm"]')).toHaveAttribute("data-selected", "true");
  });

  it("Speak to customers: Friendly (the usual) or Respectful, with a live example of the real difference, in the app's language", async () => {
    const { speaks, actions } = setup();
    const tone = document.querySelector('[data-part="vt-tone"]') as HTMLElement;
    const select = within(tone).getByRole("combobox") as HTMLSelectElement;
    expect([...select.options].map((o) => o.textContent)).toEqual(["Respectful", "Friendly (the usual)"]);
    expect(select.value).toBe("friendly");
    expect(tone.querySelector('[data-part="vt-example"]')).toHaveTextContent("Hi Ravi, …");
    fireEvent.change(select, { target: { value: "respectful" } });
    expect(tone.querySelector('[data-part="vt-example"]')).toHaveTextContent("Good morning, Mr. Ravi, …");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(speaks.save).toHaveBeenCalledWith({ tone: "respectful" })); // the same payload as the old form: only what changed
    expect(actions.save).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByText("Saved. Your assistant talks this way from the next call.")).toBeInTheDocument());
  });

  it.each([
    ["te", "నమస్కారం Ravi, …", "నమస్కారం Ravi గారు, …"],
    ["hi", "नमस्ते Ravi, …", "नमस्ते Ravi जी, …"],
    ["kn", "ನಮಸ್ಕಾರ Ravi, …", "ನಮಸ್ಕಾರ Ravi ಅವರೇ, …"],
  ] as const)("the example follows the app language: %s", (l, friendly, respectful) => {
    setup({ words: W(l), uiLang: l });
    const ex = document.querySelector('[data-part="vt-example"]') as HTMLElement;
    expect(ex).toHaveTextContent(friendly);
    fireEvent.change(within(document.querySelector('[data-part="vt-tone"]') as HTMLElement).getByRole("combobox"), { target: { value: "respectful" } });
    expect(ex).toHaveTextContent(respectful);
  });

  it("never says 'Not chosen yet' next to a chosen tone, and the business type's usual is only a word on the option", () => {
    setup();
    expect(root()).not.toHaveTextContent(/Not chosen yet/);
    expect(root()).not.toHaveTextContent(/The usual for your kind of business/);
    cleanup();
    setup({ speaks: { initial: H({ tone: { value: "respectful", source: "migrated", pack_default: "friendly", options: [] }, legacy_address: "garu" }), demo: false, save: vi.fn() } });
    expect(root()).toHaveTextContent("Chosen for you from your old");
  });

  it("the greeting is ONE box with our suggestion in it, names as plain-word pills, a Hear it button and no curly braces anywhere", () => {
    setup();
    expect(box()).toHaveTextContent("Hello the customer's name, this is your assistant's name, the AI assistant of your shop name. Do you have a minute?");
    expect(box().querySelectorAll("[data-ph]")).toHaveLength(4);
    expect(root().textContent).not.toMatch(/[{}]/);
    expect(root()).not.toHaveTextContent("Put in:");
    for (const jargon of ["{customer}", "{assistant}", "{business}", "{agent_role}", "agent_role"]) expect(root()).not.toHaveTextContent(jargon);
    expect(screen.getByRole("button", { name: /Hear it/ })).toBeInTheDocument();
    expect(root()).toHaveTextContent("What the customer hears, with made-up names");
    expect(root()).toHaveTextContent("Hello Ravi, this is Priya, the AI assistant of Lakshmi Silks.");
    expect(root()).toHaveTextContent("Your assistant always says it is an AI assistant.");
  });

  it("the Telugu greeting shows no braces either", () => {
    setup({ first: "te" });
    expect(root().textContent).not.toMatch(/[{}]/);
    expect(box().querySelectorAll("[data-ph]")).toHaveLength(4);
  });

  it("adding a name puts a pill in; Save sends the stored text with the placeholder, exactly what the API takes today (the whole document)", async () => {
    const { actions, speaks } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Add the customer's name" }));
    expect(box().querySelectorAll('[data-ph="customer"]').length).toBe(2);
    expect(root().textContent).not.toMatch(/[{}]/);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(actions.save).toHaveBeenCalledTimes(1));
    expect(actions.save).toHaveBeenCalledWith({ ...DOC, greeting: { en: `${SUGGESTED_EN}{customer}` } });
    expect(speaks.save).not.toHaveBeenCalled();
  });

  it("typing text keeps the pills, an emptied box goes back to the suggestion (the key is left out), and nothing is sent while nothing changed", async () => {
    const { actions } = setup();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    box().appendChild(document.createTextNode(" Thanks!"));
    fireEvent.input(box());
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(actions.save).toHaveBeenCalledWith({ ...DOC, greeting: { en: `${SUGGESTED_EN} Thanks!` } }));
  });

  it("curly brackets typed by hand are refused in words and Save waits", () => {
    setup();
    box().appendChild(document.createTextNode(" {oops}"));
    fireEvent.input(box());
    expect(screen.getByRole("alert")).toHaveTextContent("Please take out the curly brackets.");
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("Region, Introduce as, the Casual line and Lead Desk are not on this page (their data and save stay in code)", () => {
    setup();
    for (const gone of ["Region", "Introduce as", "Casual is only for your own test calls", "Lead Desk", "Hear an example", "Neutral (understood everywhere)"]) expect(root()).not.toHaveTextContent(gone);
    expect(document.querySelector('[data-part="sp-region"]')).toBeNull();
    expect(document.querySelector('[data-part="tt-introduce"]')).toBeNull();
  });

  it("a save of Tone and the greeting sends both, each as before, and keeps Region and Introduce as out of the change", async () => {
    const { actions, speaks } = setup();
    fireEvent.change(within(document.querySelector('[data-part="vt-tone"]') as HTMLElement).getByRole("combobox"), { target: { value: "respectful" } });
    fireEvent.click(screen.getByRole("button", { name: "Add your shop name" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(speaks.save).toHaveBeenCalledWith({ tone: "respectful" }));
    expect(actions.save).toHaveBeenCalledTimes(1);
  });

  it("More choices holds Words, the address, never-say, questions, answers and the platform's rules; Words saves as before", async () => {
    const { speaks } = setup();
    const more = document.querySelector('[data-part="more-choices"]') as HTMLElement;
    expect(more.querySelector('[data-part="sp-words"]')).toBeInTheDocument();
    expect(more.querySelector('[data-part="tt-address"]')).toBeInTheDocument();
    expect(more.querySelector('[data-part="tt-never"]')).toBeInTheDocument();
    expect(more.querySelector('[data-part="tt-questions"]')).toBeInTheDocument();
    expect(more.querySelector('[data-part="tt-rules"]')).toHaveTextContent("Always says it is an AI assistant.");
    fireEvent.click(within(more).getByRole("radio", { name: /fewer English words/ }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(speaks.save).toHaveBeenCalledWith({ words: { te: { style: "everyday_pure" }, kn: { style: "everyday_pure" }, hi: { style: "everyday_pure" }, ta: { style: "everyday_pure" } } }),
    );
  });

  it("the second step: a refused save says to confirm the two-step code and links to it; nothing else is hidden", async () => {
    const save = vi.fn(async () => ({ ok: false as const, error: "mfa" as const }));
    setup({ actions: { save, reset: vi.fn() } });
    fireEvent.click(screen.getByRole("button", { name: "Add the customer's name" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/two-step code/i);
    expect(within(alert).getByRole("link")).toHaveAttribute("href", "/app/security");
  });

  it("a refused tone says it in words (the speaks refusal), and only the Owner can change anything", async () => {
    const speaks = { initial: H(), demo: false, save: vi.fn(async () => ({ ok: false as const, error: "forbidden" })) };
    setup({ speaks });
    fireEvent.change(within(document.querySelector('[data-part="vt-tone"]') as HTMLElement).getByRole("combobox"), { target: { value: "respectful" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Only the Owner can change this.");
    cleanup();
    setup({ canEdit: false });
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Add the customer/ })).toBeNull();
    expect(box()).toHaveAttribute("contenteditable", "false");
    expect(within(document.querySelector('[data-part="vt-tone"]') as HTMLElement).getByRole("combobox")).toBeDisabled();
    expect(root()).toHaveTextContent("Only the owner can change this.");
  });

  it("without the voice picker or the speaks panel the card still draws what it has (a missing part is not drawn)", () => {
    setup({ picker: null, speaks: null });
    expect(document.querySelector('[data-part="vt-voice"]')).toBeNull();
    expect(document.querySelector('[data-part="vt-tone"]')).toBeNull();
    expect(document.querySelector('[data-part="vt-greeting"]')).not.toBeNull();
    cleanup();
    setup({ training: null, speaks: null });
    expect(document.querySelector('[data-part="vt-greeting"]')).toBeNull();
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
  });

  it("Hear it plays the greeting sample and Stop ends it", async () => {
    const play = vi.fn(async () => undefined);
    const pause = vi.fn();
    vi.stubGlobal("Audio", function (this: Record<string, unknown>, src: string) { this.src = src; this.play = play; this.pause = pause; });
    setup();
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: /Hear it/ })));
    expect(play).toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /Stop/ })).toBeInTheDocument();
  });
});
