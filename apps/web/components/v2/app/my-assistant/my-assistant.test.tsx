import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

import { appDict } from "@/i18n/app";
import { CALL_LANG_NAMES } from "@/lib/assistant/types";
import { MOCK_VOICES, type PickerLang } from "@/lib/voice-picker/types";

import type { TeachActions } from "../ds/TeachThis";
import { GoLiveButton, fixHref, type GoLiveAct } from "./GoLiveButton";
import { GoLivePanel } from "./GoLivePanel";
import { MyAssistantTabs } from "./MyAssistantTabs";
import { PracticePanel } from "./PracticePanel";
import { inUseId, SOUNDS, voiceFor } from "./sounds";
import { TABS, tabHref, tabOf, tabUsesDefaults } from "./tabs";
import { VoiceCards } from "./VoiceCards";
import { VoiceSegments } from "./VoiceSegments";

const BASE = "/app/tenants/t1";
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  refresh.mockReset();
});

describe("the tabs", () => {
  it("are five, each its own address; anything else asked for is the first", () => {
    expect(TABS).toEqual(["knowledge", "voice", "rules", "practice", "golive"]);
    expect(tabOf("rules")).toBe("rules");
    expect(tabOf(["voice", "rules"])).toBe("voice");
    expect(tabOf("../x")).toBe("knowledge");
    expect(tabOf(undefined)).toBe("knowledge");
    expect(tabHref(BASE, "knowledge")).toBe(`${BASE}/my-assistant`);
    expect(tabHref(BASE, "golive")).toBe(`${BASE}/my-assistant?tab=golive`);
  });
  it("only Knowledge, Voice & tone and Rules can be 'using defaults'", () => {
    expect(TABS.filter((t) => tabUsesDefaults(t, ["knowledge", "voice", "rules"]))).toEqual(["knowledge", "voice", "rules"]);
    expect(TABS.filter((t) => tabUsesDefaults(t, ["voice"]))).toEqual(["voice"]);
    expect(TABS.filter((t) => tabUsesDefaults(t, []))).toEqual([]);
  });
  it("mark the current tab and say 'Using defaults' only under the parts not yet changed", () => {
    render(<MyAssistantTabs base={BASE} current="voice" usingDefaults={["voice", "rules"]} />);
    const nav = screen.getByRole("navigation", { name: "My assistant sections" });
    const links = within(nav).getAllByRole("link");
    expect(links.map((l) => l.textContent)).toEqual(["Knowledge", "Voice & toneUsing defaults", "RulesUsing defaults", "Practice", "Go live"]);
    expect(links.find((l) => l.getAttribute("aria-current") === "page")).toHaveAttribute("data-tab", "voice");
    expect(links[0]).toHaveAttribute("href", `${BASE}/my-assistant`);
    expect(links[2]).toHaveAttribute("href", `${BASE}/my-assistant?tab=rules`);
  });
});

describe("Go live and Pause", () => {
  const ok = (state: "live" | "in_training") => vi.fn<GoLiveAct>(async () => ({ ok: true as const, state }));
  const draw = (over: Partial<Parameters<typeof GoLiveButton>[0]> = {}, act: GoLiveAct = ok("live")) => {
    render(<GoLiveButton state="not_live" canGoLive missing={[]} owner act={act} base={BASE} {...over} />);
    return act;
  };

  it("an admin gets a line that says who can, and no button", () => {
    draw({ owner: false });
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText("Only the owner can go live or pause.")).toBeInTheDocument();
  });
  it("Go live asks the server, says it is live and redraws the page (the menu's badge)", async () => {
    const act = draw();
    fireEvent.click(screen.getByRole("button", { name: "Go live" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Your assistant is live."));
    expect(act).toHaveBeenCalledWith("go-live");
    expect(refresh).toHaveBeenCalled();
  });
  it("while live the button is Pause", async () => {
    const act = draw({ state: "live" }, ok("in_training"));
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Your assistant is paused."));
    expect(act).toHaveBeenCalledWith("pause");
  });
  it("with something missing the button asks nothing: it explains what is missing, with the link that fixes each", () => {
    const act = draw({ canGoLive: false, missing: ["phone_number"] });
    const button = screen.getByRole("button", { name: "Go live" });
    expect(button).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(button);
    expect(act).not.toHaveBeenCalled();
    const box = document.querySelector('[data-part="mya-missing"]') as HTMLElement;
    expect(box).toHaveTextContent("Needed before it can go live");
    expect(within(box).getByRole("link", { name: "Connect a phone number" })).toHaveAttribute("href", `${BASE}/phone-number`);
    expect(within(box).queryByRole("link", { name: "Add your business name" })).toBeNull();
    expect(box).toHaveTextContent("Only these two are needed");
    expect(button).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(button);
    expect(document.querySelector('[data-part="mya-missing"]')).toBeNull();
  });
  it("when the API still says not ready, the list opens with what it says is missing", async () => {
    draw({}, vi.fn(async () => ({ ok: false as const, error: "missing" as const, missing: ["business_name" as const] })));
    fireEvent.click(screen.getByRole("button", { name: "Go live" }));
    const box = await screen.findByRole("status");
    expect(within(box).getByRole("link", { name: "Add your business name" })).toHaveAttribute("href", `${BASE}/settings?section=business`);
  });
  it("lists both when the status could not say what is missing", () => {
    draw({ canGoLive: false, missing: [] });
    fireEvent.click(screen.getByRole("button", { name: "Go live" }));
    expect(screen.getAllByRole("link")).toHaveLength(2);
  });
  it.each([
    ["forbidden", "Only the owner can do this."],
    ["down", "That did not work. Please try again in a minute."],
    ["not_available", "This is not switched on yet."],
  ] as const)("a %s answer is said in plain words", async (error, text) => {
    draw({}, vi.fn(async () => ({ ok: false as const, error })));
    fireEvent.click(screen.getByRole("button", { name: "Go live" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(text);
  });
  it("a failing call is 'down', never a crash", async () => {
    draw({}, vi.fn(async () => Promise.reject(new Error("net"))));
    fireEvent.click(screen.getByRole("button", { name: "Go live" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("That did not work");
  });
  it("two of them on one page keep their own ids", () => {
    render(
      <>
        <GoLiveButton state="not_live" canGoLive={false} missing={["phone_number"]} owner act={ok("live")} base={BASE} />
        <GoLiveButton state="not_live" canGoLive={false} missing={["phone_number"]} owner act={ok("live")} base={BASE} />
      </>,
    );
    screen.getAllByRole("button", { name: "Go live" }).forEach((b) => fireEvent.click(b));
    const ids = [...document.querySelectorAll('[data-part="mya-missing"]')].map((n) => n.id);
    expect(new Set(ids).size).toBe(2);
    expect(fixHref(BASE, "phone_number")).toBe(`${BASE}/phone-number`);
  });
});

describe("the Go live tab", () => {
  const status = (over = {}) => ({ state: "not_live" as const, canGoLive: false, missing: ["phone_number" as const], usingDefaults: ["voice" as const, "rules" as const], ...over });
  it("ticks what is done, links what is not, lists the parts on defaults (and says that is fine) and carries the button", () => {
    render(<GoLivePanel base={BASE} status={status()} button={<button type="button">Go live</button>} mock />);
    const rows = [...document.querySelectorAll('[data-part="mya-requirements"] li')];
    expect(rows.map((r) => r.getAttribute("data-done"))).toEqual(["true", "false"]);
    expect(rows[0]).toHaveTextContent("✓Your business nameDone");
    expect(within(rows[1] as HTMLElement).getByRole("link", { name: "Connect a phone number" })).toHaveAttribute("href", `${BASE}/phone-number`);
    const defaults = within(document.querySelector('[data-part="mya-defaults-list"]') as HTMLElement).getAllByRole("link");
    expect(defaults.map((l) => [l.textContent, l.getAttribute("href")])).toEqual([["Voice & tone", `${BASE}/my-assistant?tab=voice`], ["Rules", `${BASE}/my-assistant?tab=rules`]]);
    expect(screen.getByText(/You can change them any time/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Go live" })).toBeInTheDocument();
    expect(document.querySelector('[data-status="no_answer"]')).toHaveTextContent("Not live");
    expect(screen.getByText(/going live here only changes the status shown/)).toBeInTheDocument();
  });
  it("says the honest line about real customers; the test-mode line only in the test mode", () => {
    render(<GoLivePanel base={BASE} status={status({ state: "live", missing: [], usingDefaults: [] })} button={null} mock={false} />);
    expect(screen.getByText(/answer real customers by phone and chat/)).toBeInTheDocument();
    expect(document.querySelector('[data-part="mya-mock"]')).toBeNull();
    expect(document.querySelector('[data-part="mya-defaults-list"]')).toBeNull();
    expect(document.querySelector('[data-status="completed"]')).toHaveTextContent("Live");
  });
  it("an unreadable status is an empty state with its next step", () => {
    render(<GoLivePanel base={BASE} status={null} button={null} mock={false} />);
    expect(document.querySelector('[data-part="empty-next"]')).toHaveTextContent("Status is not available yet");
    expect(screen.getByRole("link", { name: "Open Settings" })).toHaveAttribute("href", `${BASE}/settings?section=business`);
  });
});

describe("the three sounds", () => {
  it("are Warm, Calm, Bright; a card's voice is of the workspace's gender, preferring the one in use, then the sound as first tag", () => {
    expect(SOUNDS).toEqual(["warm", "calm", "bright"]);
    expect(voiceFor(MOCK_VOICES, "warm", "te", "female", null)?.id).toBe("te-ramya");
    expect(voiceFor(MOCK_VOICES, "bright", "te", "female", null)?.id).toBe("te-sindhu");
    expect(voiceFor(MOCK_VOICES, "calm", "te", "male", null)?.id).toBe("te-kiran");
    // kn: Disha is [warm, calm] and the only female with both; the one in use wins
    expect(voiceFor(MOCK_VOICES, "calm", "kn", "female", "kn-disha")?.id).toBe("kn-disha");
  });
  it("a sound no voice of the gender has in the language is null (a voice of the other gender would not take effect)", () => {
    expect(voiceFor(MOCK_VOICES, "calm", "te", "female", null)).toBeNull();
    expect(voiceFor(MOCK_VOICES, "bright", "hi", "male", null)).toBeNull();
  });
  it("the voice in use is the chosen one of the gender, else the default", () => {
    expect(inUseId(MOCK_VOICES, {}, "te", "female")).toBe("te-ramya");
    expect(inUseId(MOCK_VOICES, { te: "te-sindhu" }, "te", "female")).toBe("te-sindhu");
    expect(inUseId(MOCK_VOICES, { te: "te-kiran" }, "te", "female")).toBe("te-ramya");
  });
});

describe("the voice cards", () => {
  type Fake = { src: string; play: ReturnType<typeof vi.fn>; pause: ReturnType<typeof vi.fn>; onended: (() => void) | null; onerror: (() => void) | null };
  let made: Fake[] = [];
  beforeEach(() => {
    made = [];
    vi.stubGlobal("Audio", function (this: Fake, src: string) {
      this.src = src;
      this.play = vi.fn(async () => undefined);
      this.pause = vi.fn();
      this.onended = null;
      this.onerror = null;
      made.push(this);
    });
  });
  const draw = (over: Partial<{ canEdit: boolean; mock: boolean; choices: Partial<Record<PickerLang, string | null>>; choose: (l: PickerLang, v: string | null) => Promise<{ ok: true } | { ok: false; error: string }> }> = {}) => {
    const choose = over.choose ?? vi.fn(async () => ({ ok: true as const }));
    render(<VoiceCards voices={MOCK_VOICES} choices={over.choices ?? {}} gender="female" languages={["te", "kn", "en", "hi"]} first="te" langNames={CALL_LANG_NAMES} canEdit={over.canEdit ?? true} endpoint={`${BASE}/voice-pick`} mock={over.mock ?? false} choose={choose} />);
    return choose;
  };
  const card = (s: string) => document.querySelector(`[data-sound="${s}"]`) as HTMLElement;

  it("draws three cards named by their sound, with no person's name anywhere", () => {
    draw();
    expect([...document.querySelectorAll("[data-sound]")].map((c) => c.getAttribute("data-sound"))).toEqual(["warm", "calm", "bright"]);
    expect(within(card("warm")).getByRole("heading")).toHaveTextContent("Warm");
    const text = document.body.textContent ?? "";
    for (const v of MOCK_VOICES) expect(text).not.toContain(v.name);
  });
  it("marks the voice in use; the default of the gender is in use until another is chosen", () => {
    draw();
    expect(card("warm")).toHaveAttribute("data-selected", "true");
    expect(card("warm")).toHaveTextContent("In use");
    expect(card("bright")).toHaveAttribute("data-selected", "false");
    expect(within(card("bright")).getByRole("button", { name: "Use this sound" })).toBeInTheDocument();
  });
  it("a sound the language does not have is said so, not drawn empty", () => {
    draw();
    expect(card("calm")).toHaveTextContent("No voice with this sound in this language yet.");
    expect(within(card("calm")).queryByRole("button")).toBeNull();
  });
  it("Hear greeting plays the recorded sample of that card's voice through the app's own route, one at a time; again stops it", () => {
    draw();
    fireEvent.click(within(card("warm")).getByRole("button", { name: /Hear greeting/ }));
    expect(made).toHaveLength(1);
    expect(made[0].src).toBe(`${BASE}/voice-pick?id=te-ramya`);
    expect(made[0].play).toHaveBeenCalled();
    fireEvent.click(within(card("bright")).getByRole("button", { name: /Hear greeting/ }));
    expect(made[0].pause).toHaveBeenCalled();
    expect(made[1].src).toBe(`${BASE}/voice-pick?id=te-sindhu`);
    fireEvent.click(within(card("bright")).getByRole("button", { name: /Stop/ }));
    expect(made[1].pause).toHaveBeenCalled();
  });
  it("a sample that cannot play is said", async () => {
    draw();
    fireEvent.click(within(card("warm")).getByRole("button", { name: /Hear greeting/ }));
    act(() => made[0].onerror?.());
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });
  it("Use this sound saves the voice for the language shown (the default as 'back to default'), says so and redraws", async () => {
    const choose = draw();
    fireEvent.click(within(card("bright")).getByRole("button", { name: "Use this sound" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Sound saved."));
    expect(choose).toHaveBeenCalledWith("te", "te-sindhu");
    expect(card("bright")).toHaveAttribute("data-selected", "true");
    expect(card("warm")).toHaveAttribute("data-selected", "false");
    expect(refresh).toHaveBeenCalled();
    fireEvent.click(within(card("warm")).getByRole("button", { name: "Use this sound" }));
    await waitFor(() => expect(choose).toHaveBeenLastCalledWith("te", null));
  });
  it("a refused save goes back to the previous choice and says so", async () => {
    draw({ choose: vi.fn(async () => ({ ok: false as const, error: "down" })) });
    fireEvent.click(within(card("bright")).getByRole("button", { name: "Use this sound" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not save the sound");
    expect(card("warm")).toHaveAttribute("data-selected", "true");
  });
  it("another language draws its own voices; a person who cannot edit gets no Use button; the test mode says the sounds are tones", () => {
    draw({ canEdit: false, mock: true });
    fireEvent.click(screen.getByRole("button", { name: CALL_LANG_NAMES.hi }));
    expect(card("calm")).toHaveAttribute("data-selected", "true"); // Hindi: the default (calm) is in use
    expect(card("warm")).toHaveAttribute("data-selected", "false");
    fireEvent.click(within(card("warm")).getByRole("button", { name: /Hear greeting/ }));
    expect(made[0].src).toBe(`${BASE}/voice-pick?id=hi-esha`);
    expect(screen.queryByRole("button", { name: "Use this sound" })).toBeNull();
    expect(screen.getByText(appDict("en")["vp.mock"] as string)).toBeInTheDocument();
  });
});

describe("the segmented control over how it speaks", () => {
  it("shows one part at a time (Tone first); the parts are chosen by data-seg, which design/ds.css turns into hiding", () => {
    render(
      <VoiceSegments>
        <p>panel</p>
      </VoiceSegments>,
    );
    const group = screen.getByRole("group", { name: "Fine-tune how it speaks" });
    expect([...group.querySelectorAll("button")].map((b) => b.textContent)).toEqual(["Tone", "Words", "Region", "Addresses"]);
    expect(document.querySelector("[data-seg]")).toHaveAttribute("data-seg", "tone");
    expect(screen.getByRole("button", { name: "Tone" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Addresses" }));
    expect(document.querySelector("[data-seg]")).toHaveAttribute("data-seg", "address");
    expect(screen.getByRole("button", { name: "Addresses" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Tone" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByText("panel")).toBeInTheDocument();
  });
});

describe("the Practice panel", () => {
  const ID = "11111111-aaaa-4aaa-8aaa-000000000001";
  const teach = (): TeachActions => ({ save: vi.fn(async () => ({ ok: true as const, id: ID })), undo: vi.fn(async () => ({ ok: true as const })) });
  const draw = (over: Partial<Parameters<typeof PracticePanel>[0]> = {}) => render(<PracticePanel language="en" langName="English" practice={null} teach={teach()} testCallHref={`${BASE}/calls?test=1`} {...over} />);

  it("starts with the real orb, Talk now, and Call my phone as a link to the sandbox test call", () => {
    draw();
    const panel = document.querySelector('[data-part="practice-panel"]') as HTMLElement;
    expect(panel).toHaveClass("ds-glow");
    expect(panel.querySelector("[data-orb]")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Talk now" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Call my phone" })).toHaveAttribute("href", `${BASE}/calls?test=1`);
    expect(screen.getByText("Rings a phone on the test list. Never a customer.")).toBeInTheDocument();
    expect(screen.getByText("Press Talk now, or type what a customer would ask.")).toBeInTheDocument();
  });
  it("without test calls the button is off and says why; there is no number anywhere", () => {
    draw({ testCallHref: null });
    expect(screen.getByRole("button", { name: "Call my phone" })).toBeDisabled();
    expect(screen.getByText("Test calls are not switched on here.")).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/\+?\d[\d ]{9,}/);
  });
  it("Talk now turns the panel into the live conversation IN PLACE; the assistant's line gets Teach this for source 'practice'; End goes back", () => {
    vi.useFakeTimers();
    const t = teach();
    draw({ teach: t });
    fireEvent.click(screen.getByRole("button", { name: "Talk now" }));
    expect(document.querySelector('[data-part="talk-live"]')).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Talk now" })).toBeNull();
    act(() => void vi.advanceTimersByTime(3500));
    const line = document.querySelector('[data-who="assistant"]') as HTMLElement;
    expect(line).toHaveTextContent("Kanchipuram");
    const box = line.parentElement as HTMLElement;
    fireEvent.click(within(box).getByRole("button", { name: /Teach this/ }));
    expect((within(box).getByLabelText("What should it have said?") as HTMLTextAreaElement).value).toContain("Kanchipuram");
    expect(document.querySelectorAll('[data-who="owner"] ~ [data-part="teach"]')).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "End" }));
    expect(document.querySelector('[data-part="talk-live"]')).toBeNull();
    expect(screen.getByRole("button", { name: "Talk now" })).toBeInTheDocument();
  });
  it("saving Teach this on a talk line sends source practice, a practice id and the line's place", async () => {
    vi.useFakeTimers();
    const t = teach();
    draw({ teach: t });
    fireEvent.click(screen.getByRole("button", { name: "Talk now" }));
    act(() => void vi.advanceTimersByTime(3500));
    fireEvent.click(screen.getByRole("button", { name: /Teach this/ }));
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: "Save to Knowledge" })));
    expect(t.save).toHaveBeenCalledWith(expect.objectContaining({ source: "practice", sourceId: expect.stringMatching(/^practice-[a-z0-9]+$/), lineIndex: 1 }));
  });
  it("a person who may not teach (no actions) gets no Teach this", () => {
    vi.useFakeTimers();
    draw({ teach: null });
    fireEvent.click(screen.getByRole("button", { name: "Talk now" }));
    act(() => void vi.advanceTimersByTime(3500));
    expect(document.querySelector('[data-part="teach"]')).toBeNull();
  });
  it("Type ends the voice and puts the cursor in the typing box", () => {
    vi.useFakeTimers();
    draw({ practice: vi.fn() });
    fireEvent.click(screen.getByRole("button", { name: "Talk now" }));
    fireEvent.click(screen.getByRole("button", { name: "Type" }));
    act(() => void vi.advanceTimersByTime(10));
    expect(document.querySelector('[data-part="talk-live"]')).toBeNull();
    expect(document.activeElement).toBe(screen.getByLabelText("What the customer says"));
  });
  it("typing as a customer asks the practice endpoint with the turns so far; the answer gets Teach this; Start again clears", async () => {
    const practice = vi.fn(async () => ({ ok: true as const, data: { reply: "We open at 9 am.", ended: false, handover: false } }));
    const t = teach();
    draw({ practice, teach: t });
    fireEvent.change(screen.getByLabelText("What the customer says"), { target: { value: "  When do you open?  " } });
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: "Send" })));
    expect(practice).toHaveBeenCalledWith("en", [{ who: "customer", text: "When do you open?" }], null);
    const turns = document.querySelector('[data-part="practice-turns"]') as HTMLElement;
    expect(turns).toHaveTextContent("We open at 9 am.");
    fireEvent.click(within(turns).getByRole("button", { name: /Teach this/ }));
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: "Save to Knowledge" })));
    expect(t.save).toHaveBeenCalledWith(expect.objectContaining({ source: "practice", lineIndex: 1, answer: "We open at 9 am." }));
    fireEvent.click(screen.getByRole("button", { name: "Start again" }));
    expect(document.querySelector('[data-part="practice-turns"]')).toBeNull();
  });
  it("a typed line that was not answered goes back into the box with the reason in plain words", async () => {
    draw({ practice: vi.fn(async () => ({ ok: false as const, error: "busy" as const })) });
    fireEvent.change(screen.getByLabelText("What the customer says"), { target: { value: "Hello" } });
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: "Send" })));
    expect(screen.getByRole("alert")).toHaveTextContent("a lot of practice");
    expect((screen.getByLabelText("What the customer says") as HTMLInputElement).value).toBe("Hello");
  });
  it("a call that ends (or hands over) closes the typing box", async () => {
    draw({ practice: vi.fn(async () => ({ ok: true as const, data: { reply: "Goodbye.", ended: true, handover: false } })) });
    fireEvent.change(screen.getByLabelText("What the customer says"), { target: { value: "Bye" } });
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: "Send" })));
    expect(screen.getByText("The call ended here.")).toBeInTheDocument();
    expect(screen.queryByLabelText("What the customer says")).toBeNull();
  });
  it("no practice endpoint = no typing box, the panel still works", () => {
    draw({ practice: null });
    expect(screen.queryByLabelText("What the customer says")).toBeNull();
    expect(screen.getByRole("button", { name: "Talk now" })).toBeInTheDocument();
  });
});
