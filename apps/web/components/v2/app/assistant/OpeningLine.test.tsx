import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: () => undefined }) }));

import { appDict } from "@/i18n/app";
import { CALL_LANG_NAMES } from "@/lib/assistant/types";
import { MOCK_DEFAULTS } from "@/lib/opening-line/types";

import { OpeningLine, type OpeningLineActions } from "./OpeningLine";

const words = Object.fromEntries(Object.entries(appDict("en") as Record<string, string>).filter(([k]) => k.startsWith("ope.")));
const save = vi.fn(async () => ({ ok: true }) as { ok: true } | { ok: false; error: string });
const hear = vi.fn(async () => ({ ok: true, preview: { audio: null, fake: true } }) as never);
const actions = (over: Partial<OpeningLineActions> = {}): OpeningLineActions => ({ save, preview: hear, ...over });
type Props = Partial<Parameters<typeof OpeningLine>[0]>;
const draw = (over: Props = {}) =>
  render(<OpeningLine words={words} langNames={CALL_LANG_NAMES} scope={{ kind: "workspace" }} lines={{}} fallback={MOCK_DEFAULTS} mentionAi={true} effectiveAi={true} names={{ assistant: "Vijaya", business: "Sri Silks" }} canEdit mock={false} actions={actions()} {...over} />);
const box = () => screen.getByLabelText("What is said") as HTMLTextAreaElement;
const pick = (name: string) => fireEvent.click(screen.getByRole("button", { name }));
const type = (text: string) => fireEvent.change(box(), { target: { value: text } });

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
});
afterEach(cleanup);

describe("Settings > AI assistant > Opening line", () => {
  it("shows the default line of a language with the placeholders filled in by made-up values, and says it is the default", () => {
    draw();
    pick("English");
    expect(box().value).toBe(MOCK_DEFAULTS.en);
    expect(screen.getByText("Hello Ravi, this is Vijaya, the AI assistant of Sri Silks. Do you have a minute?")).toBeInTheDocument();
    expect(screen.getByText("This is the default line. Change it to make it yours.")).toBeInTheDocument();
  });
  it("a live preview follows what is typed; the four placeholders can be put in at the cursor", () => {
    draw();
    pick("English");
    type("Hi {customer}, it's {business}.");
    expect(screen.getByText("Hi Ravi, it's Sri Silks.")).toBeInTheDocument();
    pick("{assistant}");
    expect(box().value).toContain("{assistant}");
    for (const p of ["{customer}", "{assistant}", "{business}", "{agent_role}"]) expect(screen.getByRole("button", { name: p })).toBeInTheDocument();
  });
  it("refuses a placeholder that is not one of the four, and a text that is too short, and saves nothing", () => {
    draw();
    pick("English");
    type("Hi {name}, this is a call");
    expect(screen.getByRole("alert")).toHaveTextContent("{name} is not one of the four placeholders.");
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    type("Hi");
    expect(screen.getByRole("alert")).toHaveTextContent("Write at least 10 characters.");
  });
  it("saves only the languages that were touched, then refreshes; a reset language is sent as null", async () => {
    draw({ lines: { te: "నమస్కారం {customer} గారూ, నేను {assistant}." } });
    pick("English");
    type("Hello {customer}, this is {assistant} from {business}.");
    pick("తెలుగు");
    expect(box().value).toContain("నమస్కారం");
    pick("Reset to default");
    expect(box().value).toBe(MOCK_DEFAULTS.te);
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: "Save" })));
    expect(save).toHaveBeenCalledWith({ lines: { en: "Hello {customer}, this is {assistant} from {business}.", te: null }, mentionAi: true });
    expect(screen.getByRole("status")).toHaveTextContent("Saved. New calls start with this line.");
    expect(refresh).toHaveBeenCalled();
  });
  it("shows the API's refusal in words", async () => {
    save.mockResolvedValueOnce({ ok: false, error: "forbidden" });
    draw();
    pick("English");
    type("Hello {customer}, this is {assistant}.");
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: "Save" })));
    expect(screen.getByRole("alert")).toHaveTextContent("Only the Owner can change this.");
  });
  it("the switch is on by default; turning it off says ONCE that the assistant still answers honestly and that some regulators expect disclosure", () => {
    draw();
    const sw = screen.getByRole("switch", { name: "Mention that I'm an AI assistant in the greeting" });
    expect(sw).toBeChecked();
    fireEvent.click(sw);
    expect(sw).not.toBeChecked();
    const note = screen.getByRole("note");
    expect(note).toHaveTextContent("Vijaya will still answer honestly if someone asks whether it is an AI.");
    expect(note).toHaveTextContent("Some regulators expect AI calls to be disclosed; check with your advisor.");
    fireEvent.click(screen.getByRole("button", { name: "Got it" }));
    fireEvent.click(sw);
    fireEvent.click(sw);
    expect(screen.queryByRole("note")).toBeNull(); // said once, in this browser
  });
  it("'Hear it' asks for the sound of the FILLED text in the chosen language and the switch's state; without sound it says so", async () => {
    draw({ mentionAi: false, effectiveAi: false });
    pick("English");
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: "Hear it" })));
    expect(hear).toHaveBeenCalledWith("en", "Hello Ravi, this is Vijaya, the AI assistant of Sri Silks. Do you have a minute?", false);
    expect(screen.getByRole("status")).toHaveTextContent("There is no sound in this mode.");
    expect(screen.getByText(/Preview of the voice\. In real calls Vijaya talks naturally and answers what the customer says\./)).toBeInTheDocument();
  });
  it("'Hear it' plays the sound from a blob: address (the page's media rule does not allow data:)", async () => {
    const made: string[] = [];
    const played: string[] = [];
    vi.stubGlobal("Audio", class { src: string; onended: (() => void) | null = null; constructor(src: string) { this.src = src; made.push(src); } play() { played.push(this.src); return Promise.resolve(); } pause() {} });
    URL.createObjectURL = vi.fn(() => "blob:http://x/abc");
    URL.revokeObjectURL = vi.fn();
    const withSound = vi.fn(async () => ({ ok: true, preview: { audio: { base64: btoa("RIFF"), mime: "audio/wav", seconds: 1 }, fake: false } }) as never);
    draw({ actions: actions({ preview: withSound }) });
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: "Hear it" })));
    expect(made).toEqual(["blob:http://x/abc"]);
    expect(played).toEqual(["blob:http://x/abc"]);
    vi.unstubAllGlobals();
  });
  it("a viewer of it (the Admin) can read and hear but not change: no box to type in, no Save, no reset", () => {
    draw({ canEdit: false });
    expect(box()).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Reset to default" })).toBeNull();
    expect(screen.getByText("Only the Owner can change this.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Hear it" })).toBeInTheDocument();
  });
  it("for a campaign: an empty language follows the business, the switch can follow it too, and there is a way back to the campaign", async () => {
    draw({ scope: { kind: "campaign", backHref: "/app/tenants/T/campaigns/C" }, mentionAi: null, effectiveAi: true, fallback: { ...MOCK_DEFAULTS, en: "Business line {customer}." } });
    pick("English");
    expect(box().value).toBe("Business line {customer}.");
    expect(screen.getByText("This campaign follows the business's line.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Same as the business" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Do not mention it" }));
    expect(screen.getByRole("note")).toBeInTheDocument();
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: "Save" })));
    expect(save).toHaveBeenCalledWith({ lines: {}, mentionAi: false });
    expect(screen.getByRole("link", { name: "Back to the campaign" })).toHaveAttribute("href", "/app/tenants/T/campaigns/C");
  });
  it("test mode is said on the card", () => {
    draw({ mock: true });
    expect(screen.getByText(/Test mode: your changes are kept in this browser only/)).toBeInTheDocument();
  });
});
