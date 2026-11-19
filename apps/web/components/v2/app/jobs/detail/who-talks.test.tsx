import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { appDict } from "@/i18n/app";
import { mockJobDetail } from "@/lib/jobs/detail-mock";
import { MOCK_JOBS } from "@/lib/jobs/mock";
import { speaksPatch, type SpeaksPatch, type WhoTarget } from "@/lib/jobs/who";

import { JobPage } from "./JobPage";
import type { JobPageActions, WhoExtra } from "./types";

vi.mock("./LazyJobLists", async () => ({ ...(await import("./JobLists")), WhoTalks: (await import("./WhoTalks")).WhoTalks }));

afterEach(cleanup);
const words = Object.fromEntries(Object.entries(appDict("en") as Record<string, string>).filter(([k]) => k.startsWith("jobs.")));
const BASE = "/app/tenants/t";
const detailOf = (kind: string) => mockJobDetail(MOCK_JOBS.find((j) => j.kind === kind)!.id)!;
const patched = (over = {}) => ({ ok: true as const, data: { customName: null, enabled: true, status: "running" as const, says: null, ...over } });
const acts = (over: Partial<JobPageActions> = {}): JobPageActions => ({
  setEnabled: vi.fn(async (enabled: boolean) => ({ ok: true as const, data: { id: "x", enabled, status: enabled ? ("running" as const) : ("paused" as const) } })),
  rename: vi.fn(async (name: string) => patched({ customName: name === "" ? null : name })),
  setSetting: vi.fn(async () => patched()),
  setFindsOut: vi.fn(async () => patched()),
  addFaq: vi.fn(async (question: string, answer: string) => ({ ok: true as const, data: { id: "new-1", question, answer } })),
  removeFaq: vi.fn(async (id: string) => ({ ok: true as const, data: { id } })),
  test: vi.fn(async (channel) => ({ ok: true as const, data: { channel, sent: false, minutesUsed: 0 } })),
  setSpeaks: vi.fn(async () => patched()),
  ...over,
});
const TARGET: WhoTarget = { id: "66666666-6666-4666-8666-666666666605", kind: "store_visits", customName: null, language: "en", to: "te" };
const extra = (over: Partial<WhoExtra> = {}): WhoExtra => ({ sampleEndpoint: "/app/tenants/t/voice-sample", target: TARGET, changeJob: vi.fn(async () => patched()), ...over });
const view = (kind = "speed_to_lead", a: JobPageActions | null = acts(), w: WhoExtra | null = extra()) => render(<JobPage detail={detailOf(kind)} words={words} base={BASE} lang="en" ago={{ unit: "min", n: 9 }} actions={a} whoExtra={w} />);
const card = () => document.querySelector('[data-part="who-talks"]') as HTMLElement;
const pill = (n: number) => within(card()).getByRole("combobox", { name: `This job speaks … in a … voice from …. (${n})` }) as HTMLSelectElement;

describe("Who talks: the card", () => {
  it("is a plain sentence with the choice inside: Telugu, friendly, the shop number; with the AI line that cannot be switched off", () => {
    view();
    expect(card()).toHaveTextContent("Who talks");
    expect(card()).toHaveTextContent("Always says it is an AI");
    expect([pill(1).value, pill(2).value, pill(3).value]).toEqual(["te", "friendly", "shop"]);
    expect(within(card()).getByText(/This job speaks/)).toBeInTheDocument();
    expect(card().querySelector('[data-part="who-ai-line"]')).toHaveTextContent("Customers are always told it is an AI assistant, in every call and message. This cannot be switched off.");
    // no switch for the AI line anywhere
    expect(card().querySelectorAll('[role="switch"]')).toHaveLength(0);
    expect(card().querySelector('[data-part="who-tone-example"]')).toHaveTextContent("friendly “Hi Suresh garu, …”");
    expect(card().querySelector('[data-part="who-tone-example"]')).toHaveTextContent("+91 98480 xxx10");
  });
  it("offers three voices, the chosen one ticked (round radios), and at most four choices on the card", () => {
    view();
    const voices = [...card().querySelectorAll('[data-voice] input[type="radio"]')] as HTMLInputElement[];
    expect(voices.map((v) => v.value)).toEqual(["female_warm", "female_clear", "male_calm"]);
    expect(voices.map((v) => v.checked)).toEqual([true, false, false]);
    expect(card()).toHaveTextContent("Soft woman voice");
    expect(card()).toHaveTextContent("Bright woman voice");
    expect(card()).toHaveTextContent("Calm man voice");
    expect(card().querySelectorAll("select")).toHaveLength(3);
  });
  it("the language lives here: the old language line of What it says is gone", () => {
    view();
    expect(within(document.querySelector('[data-part="job-says"]') as HTMLElement).queryByRole("combobox", { name: "Speak in …" })).toBeNull();
  });
  it("a job that talks to nobody (the researcher) has no card", () => {
    view("researcher");
    expect(card()).toBeNull();
  });
});

describe("Who talks: it saves exactly the adapter's payload", () => {
  it("one choice = one patch of the adapter's closed words: tone, number, language, voice", async () => {
    const a = acts();
    view("speed_to_lead", a);
    fireEvent.change(pill(2), { target: { value: "casual" } });
    fireEvent.change(pill(3), { target: { value: "second" } });
    fireEvent.change(pill(1), { target: { value: "hi" } });
    fireEvent.click(card().querySelector('[data-voice="male_calm"] input') as HTMLElement);
    await waitFor(() => expect(a.setSpeaks).toHaveBeenCalledTimes(4));
    const sent = (a.setSpeaks as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0]);
    expect(sent).toEqual([speaksPatch("tone", "casual"), speaksPatch("number", "second"), speaksPatch("language", "hi"), speaksPatch("voice", "male_calm")]);
    expect(sent).toEqual([{ tone: "casual" }, { number: "second" }, { language: "hi" }, { voice: "male_calm" }]);
    expect(card().querySelector('[data-part="who-tone-example"]')).toHaveTextContent("casual “Hi Suresh, …”");
  });
  it("puts the choice back and says why when the API says no", async () => {
    const a = acts({ setSpeaks: vi.fn(async () => ({ ok: false as const, kind: "invalid" as const, error: "That voice is not available." })) });
    view("speed_to_lead", a);
    fireEvent.change(pill(2), { target: { value: "casual" } });
    expect(await screen.findByText("That voice is not available.")).toBeInTheDocument();
    expect(pill(2).value).toBe("friendly");
  });
  it("a person who only reads sees the card with every choice off, no rename and no command", () => {
    view("speed_to_lead", null, null);
    expect(card()).toBeTruthy();
    expect(card().querySelectorAll("select:disabled")).toHaveLength(3);
    expect(card().querySelectorAll('input[type="radio"]:disabled')).toHaveLength(3);
    expect(within(card()).queryByRole("button", { name: "Rename" })).toBeNull();
    expect(card().querySelector('[data-part="who-command"]')).toBeNull();
  });
});

describe("Who talks: the job's own name", () => {
  it("no name: the plain job name, and customers hear only the AI assistant of the shop", () => {
    view();
    expect(card().querySelector('[data-part="who-name"]')).toHaveTextContent("Call every new enquiry right away");
    expect(card().querySelector('[data-part="who-hear"]')).toHaveTextContent("Customers hear: “the AI assistant of Neelambari Silks”");
  });
  it("a set name shows “Priya, the AI assistant of Neelambari Silks”; clearing it goes back to the plain name", async () => {
    const a = acts();
    view("speed_to_lead", a);
    fireEvent.click(within(card()).getByRole("button", { name: "Rename" }));
    const box = within(card()).getByRole("textbox") as HTMLInputElement;
    fireEvent.change(box, { target: { value: "Priya" } });
    expect(card().querySelector("form")).toHaveTextContent("Customers hear: “Priya, the AI assistant of Neelambari Silks”");
    fireEvent.click(within(card()).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(a.rename).toHaveBeenCalledWith("Priya"));
    expect(await screen.findByText("Customers hear: “Priya, the AI assistant of Neelambari Silks”")).toBeInTheDocument();
    expect(card().querySelector('[data-part="who-name"]')).toHaveTextContent("Priya");
    fireEvent.click(within(card()).getByRole("button", { name: "Rename" }));
    expect(card().querySelector("form")).toHaveTextContent("Clear it, and it goes back to “Call every new enquiry right away”.");
    fireEvent.click(within(card()).getByRole("button", { name: "Use the plain name" }));
    await waitFor(() => expect(a.rename).toHaveBeenLastCalledWith(""));
    await waitFor(() => expect(card().querySelector('[data-part="who-name"]')).toHaveTextContent("Call every new enquiry right away"));
  });
  it("a name that is too long or has odd characters is refused before the API is asked", () => {
    const a = acts();
    view("speed_to_lead", a);
    fireEvent.click(within(card()).getByRole("button", { name: "Rename" }));
    fireEvent.change(within(card()).getByRole("textbox"), { target: { value: "<b>x</b>" } });
    fireEvent.click(within(card()).getByRole("button", { name: "Save" }));
    expect(within(card()).getByRole("alert")).toHaveTextContent("Use letters and numbers only.");
    expect(a.rename).not.toHaveBeenCalled();
  });
});

describe("Who talks: the voices play through the voice sample route", () => {
  const created: string[] = [];
  beforeEach(() => {
    created.length = 0;
    vi.stubGlobal("Audio", class { src: string; onended: (() => void) | null = null; onerror: (() => void) | null = null; constructor(src: string) { this.src = src; created.push(src); } pause() {} play() { return Promise.resolve(); } });
  });
  afterEach(() => vi.unstubAllGlobals());
  it("each voice has a Play button with the route's own query (voice, language, tone, the job's name)", () => {
    view();
    expect(card().querySelectorAll("[data-play]")).toHaveLength(3);
    fireEvent.click(card().querySelector('[data-play="female_clear"]') as HTMLElement);
    expect(created).toEqual(["/app/tenants/t/voice-sample?voice=female_clear&lang=te&tone=warm"]);
    expect(card().querySelector('[data-play="female_clear"]')).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(card().querySelector('[data-play="female_clear"]') as HTMLElement);
    expect(card().querySelector('[data-play="female_clear"]')).toHaveAttribute("aria-pressed", "false");
  });
  it("no sample route, no play buttons", () => {
    view("speed_to_lead", acts(), extra({ sampleEndpoint: null }));
    expect(card().querySelectorAll("[data-play]")).toHaveLength(0);
  });
});

describe("Who talks: “Make the visits job speak Telugu” as a command to the assistant", () => {
  it("shows the command, then a plan card in plain words; Yes changes only that job's language with the same patch; Undo puts it back", async () => {
    const changeJob = vi.fn<(id: string, p: SpeaksPatch) => Promise<ReturnType<typeof patched>>>(async () => patched());
    view("speed_to_lead", acts(), extra({ changeJob }));
    const cmd = () => card().querySelector('[data-part="who-command"]') as HTMLElement;
    expect(cmd()).toHaveTextContent("Or just ask your assistant");
    fireEvent.click(within(cmd()).getByRole("button", { name: /Make the visits job speak Telugu/ }));
    const plan = cmd().querySelector('[data-part="who-plan"]') as HTMLElement;
    expect(plan).toHaveTextContent("Change “Book and remind store visits”");
    expect(plan.querySelector('[data-part="who-plan-change"]')).toHaveTextContent("Language · English → Telugu");
    expect(plan).toHaveTextContent("Nothing already sent changes. Same voice, same number.");
    expect(changeJob).not.toHaveBeenCalled();
    fireEvent.click(within(plan).getByRole("button", { name: "Yes, change it" }));
    await waitFor(() => expect(changeJob).toHaveBeenCalledWith(TARGET.id, { language: "te" }));
    expect(await screen.findByText("The visits job now speaks Telugu")).toBeInTheDocument();
    fireEvent.click(within(cmd()).getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(changeJob).toHaveBeenLastCalledWith(TARGET.id, { language: "en" }));
    expect(cmd().querySelector('[data-part="who-plan"]')).toBeNull();
    expect(within(cmd()).getByRole("button", { name: /Make the visits job speak Telugu/ })).toBeInTheDocument();
  });
  it("No changes nothing; a refusal shows its reason and keeps the plan", async () => {
    const changeJob = vi.fn(async () => ({ ok: false as const, kind: "forbidden" as const, error: "Not allowed." }));
    view("speed_to_lead", acts(), extra({ changeJob }));
    const cmd = () => card().querySelector('[data-part="who-command"]') as HTMLElement;
    fireEvent.click(within(cmd()).getByRole("button", { name: /Make the visits job speak Telugu/ }));
    fireEvent.click(within(cmd()).getByRole("button", { name: "No" }));
    expect(changeJob).not.toHaveBeenCalled();
    fireEvent.click(within(cmd()).getByRole("button", { name: /Make the visits job speak Telugu/ }));
    fireEvent.click(within(cmd()).getByRole("button", { name: "Yes, change it" }));
    expect(await screen.findByText("Not allowed.")).toBeInTheDocument();
    expect(cmd().querySelector('[data-part="who-plan"]')).toBeTruthy();
  });
  it("there is no command when there is no other job to change", () => {
    view("speed_to_lead", acts(), extra({ target: null }));
    expect(card().querySelector('[data-part="who-command"]')).toBeNull();
  });
});
