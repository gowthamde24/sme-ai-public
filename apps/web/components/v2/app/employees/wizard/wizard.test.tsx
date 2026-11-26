import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const nav = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: nav.push, replace: vi.fn(), refresh: vi.fn() }) }));

import { appDict } from "@/i18n/app";
import { INSTRUCTIONS_MAX, type Employee, type EmployeePatch, type Refusal } from "@/lib/employees/types";

import { EmployeeWizard } from "./EmployeeWizard";
import type { WizardActions, WizardVoice } from "./draft";

const UUID = "11111111-2222-4333-8444-555555555555";
const BASE = "/app/tenants/t";
const dict = appDict("en") as Record<string, string>;
const words = Object.fromEntries(Object.entries(dict).filter(([k]) => k.startsWith("emp.") || k.startsWith("vc.")));
const telugu = appDict("te") as Record<string, string>;

const voice = (id: string, language: WizardVoice["language"], name: string, gender: WizardVoice["gender"] = "female"): WizardVoice => ({ id, language, name, label: "Calm", gender, recommended: false });
const VOICES: WizardVoice[] = [voice("te_ramya", "te", "Ramya"), voice("te_arun", "te", "Arun", "male"), voice("en_maya", "en", "Maya"), voice("hi_anika", "hi", "Anika"), voice("hi_dev", "hi", "Dev", "male")];

const employee = (over: Partial<Employee> = {}): Employee => ({
  id: UUID, name: "Priya", roleCode: "receptionist", roleTitle: null, status: "draft", isDefault: false, responsibilities: ["enquiry_reply", "faq_answers"], extraInstructions: null, languages: ["te", "en"], autoSwitchLanguage: true, allowEnglishMixing: true, style: null, speed: null, openingLine: {},
  autonomy: { mayAnswerPrices: false, mayBookVisits: false, maySendMedia: false, mayTalkDues: false, maxDiscountPercent: 0, handoverOwnerAsked: true, handoverUpset: true, handoverOrderAbovePaise: null },
  askFirst: ["send_message", "make_call", "give_discount", "promise_date"], hours: null, neverSay: [], phoneNumberId: null, personaIn: "employee", voices: {}, callsToday: 0, ...over,
});
const fail = (error: Refusal) => ({ ok: false as const, error });

function acts(over: Partial<WizardActions> = {}): WizardActions {
  return {
    create: vi.fn(async (input) => ({ ok: true as const, data: employee({ id: input.id, name: input.name, roleCode: input.roleCode }) })),
    patch: vi.fn(async (_id: string, p: EmployeePatch) => ({ ok: true as const, data: employee({ ...(p.responsibilities ? { responsibilities: [...p.responsibilities] } : {}) }) })),
    setVoice: vi.fn(async () => ({ ok: true as const, data: employee() })),
    preview: vi.fn(async (_id: string, input: { language: string }) => ({ ok: true as const, data: { spokenText: `Hello in ${input.language}`, mime: "audio/wav", base64: "UklGRg==", voiceId: "te_ramya" } })),
    setStatus: vi.fn(async () => ({ ok: true as const, data: employee({ status: "on" }) })),
    ...over,
  };
}
const draw = (a: WizardActions, voices: WizardVoice[] = VOICES) => render(<EmployeeWizard words={words} base={BASE} actions={a} voices={voices} />);

const next = async () => fireEvent.click(await screen.findByRole("button", { name: "Next" }));
const heading = () => screen.getByRole("heading", { level: 2 });
const alert = () => screen.getByRole("alert");
const toStep = async (n: number) => screen.findByText(`Step ${n} of 7`);
const fillName = (v: string) => fireEvent.change(screen.getByLabelText("Name"), { target: { value: v } });

async function toVoice(a: WizardActions) {
  draw(a);
  fireEvent.click(screen.getByRole("radio", { name: /Receptionist/ }));
  await next();
  await toStep(2);
  fillName("Priya");
  await next();
  await toStep(3);
}
async function toRules(a: WizardActions) {
  await toVoice(a);
  fireEvent.click(within(screen.getByRole("group", { name: "Voice for తెలుగు" })).getByRole("radio", { name: /Ramya/ }));
  fireEvent.click(within(screen.getByRole("group", { name: "Voice for English" })).getByRole("radio", { name: /Maya/ }));
  await next();
  await toStep(4);
}

const played: string[] = [];
beforeEach(() => {
  nav.push.mockClear();
  played.length = 0;
  vi.spyOn(crypto, "randomUUID").mockReturnValue(UUID);
  vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: vi.fn(() => "blob:sample"), revokeObjectURL: vi.fn() }));
  class FakeAudio {
    onended: (() => void) | null = null;
    onerror: (() => void) | null = null;
    constructor(public src: string) {
      played.push(src);
    }
    play() {
      return Promise.resolve();
    }
    pause() {}
  }
  vi.stubGlobal("Audio", FakeAudio);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("the new AI employee wizard", () => {
  it("opens on step 1 with the seven roles as cards, a step list with the current step marked, and Back to the AI team", () => {
    draw(acts());
    expect(screen.getByText("Step 1 of 7")).toBeInTheDocument();
    expect(heading()).toHaveTextContent("What will this AI employee do?");
    expect(screen.getAllByRole("radio")).toHaveLength(7);
    expect(screen.getByText("Handles new enquiries, prices and quotes.")).toBeInTheDocument();
    const current = screen.getByRole("navigation", { name: "Steps" }).querySelector('[aria-current="step"]');
    expect(current).toHaveTextContent("Role");
    expect(screen.getByRole("link", { name: "Back to your AI team" })).toHaveAttribute("href", `${BASE}/employees`);
  });

  it("Next is blocked with a plain sentence until a role is chosen", async () => {
    const a = acts();
    draw(a);
    await next();
    expect(alert()).toHaveTextContent("Choose a role to go on.");
    expect(screen.getByText("Step 1 of 7")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: /Sales helper/ }));
    expect(alert()).toHaveTextContent("");
    await next();
    await toStep(2);
    expect(a.create).not.toHaveBeenCalled();
  });

  it("the name starts empty (no default is made up) and the draft is made only when it is saved", async () => {
    const a = acts();
    draw(a);
    fireEvent.click(screen.getByRole("radio", { name: /Receptionist/ }));
    await next();
    await toStep(2);
    const box = screen.getByLabelText("Name") as HTMLInputElement;
    expect(box.value).toBe("");
    expect(box).toHaveAttribute("maxlength", "24");
    await next();
    expect(alert()).toHaveTextContent("Type a name to go on.");
    expect(a.create).not.toHaveBeenCalled();
    fillName("  Priya ");
    await next();
    await toStep(3);
    expect(a.create).toHaveBeenCalledWith({ id: UUID, roleCode: "receptionist", name: "Priya" });
  });

  it("a name that is taken shows its sentence; the retry is the same employee (one id, minted once)", async () => {
    const create = vi.fn().mockResolvedValueOnce(fail("name_taken")).mockImplementation(async (input: { id: string; name: string }) => ({ ok: true as const, data: employee({ id: input.id, name: input.name }) }));
    const a = acts({ create });
    draw(a);
    fireEvent.click(screen.getByRole("radio", { name: /Receptionist/ }));
    await next();
    await toStep(2);
    fillName("Priya");
    await next();
    await waitFor(() => expect(alert()).toHaveTextContent("Another AI employee already has that name. Pick a different name."));
    expect(screen.getByText("Step 2 of 7")).toBeInTheDocument();
    fillName("Anu");
    await next();
    await toStep(3);
    expect(create).toHaveBeenCalledTimes(2);
    expect(create.mock.calls[0][0].id).toBe(UUID);
    expect(create.mock.calls[1][0]).toEqual({ id: UUID, roleCode: "receptionist", name: "Anu" });
    expect(crypto.randomUUID).toHaveBeenCalledTimes(1);
  });

  it("Back keeps what was typed, and a changed name later is a patch of the same draft, not a second employee", async () => {
    const a = acts();
    await toVoice(a);
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByText("Step 2 of 7")).toBeInTheDocument();
    expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe("Priya");
    fillName("Anu");
    await next();
    await toStep(3);
    expect(a.create).toHaveBeenCalledTimes(1);
    expect(a.patch).toHaveBeenCalledWith(UUID, { name: "Anu" });
  });

  it("voices: one voice for each language chosen, saved the moment it is picked (languages first), and the per-language sentence is shown", async () => {
    const a = acts();
    await toVoice(a);
    expect(heading()).toHaveTextContent("Which languages does it speak?");
    expect(screen.getByRole("checkbox", { name: "తెలుగు" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "English" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "हिन्दी" })).not.toBeChecked();
    expect(screen.getAllByRole("group", { name: /^Voice for / })).toHaveLength(2);
    expect(screen.getByText(/A voice is chosen for each language\. A voice chosen for తెలుగు does not change the other languages\./)).toBeInTheDocument();
    await next();
    expect(alert()).toHaveTextContent("Pick a voice for తెలుగు.");
    fireEvent.click(within(screen.getByRole("group", { name: "Voice for తెలుగు" })).getByRole("radio", { name: /Ramya/ }));
    await waitFor(() => expect(a.setVoice).toHaveBeenCalledWith(UUID, "te", "te_ramya"));
    expect(a.patch).toHaveBeenCalledWith(UUID, { languages: ["te", "en"] });
    // the English voice is not touched by the Telugu choice
    expect(a.setVoice).toHaveBeenCalledTimes(1);
    await next();
    expect(alert()).toHaveTextContent("Pick a voice for English.");
    fireEvent.click(screen.getByRole("checkbox", { name: "हिन्दी" }));
    expect(screen.getAllByRole("group", { name: /^Voice for / })).toHaveLength(3);
    fireEvent.click(screen.getByRole("checkbox", { name: "English" }));
    expect(screen.queryByRole("group", { name: "Voice for English" })).toBeNull();
    fireEvent.click(within(screen.getByRole("group", { name: "Voice for हिन्दी" })).getByRole("radio", { name: /Anika/ }));
    await next();
    await toStep(4);
    expect(a.patch).toHaveBeenCalledWith(UUID, { languages: ["te", "hi"] });
    expect(a.setVoice).toHaveBeenCalledWith(UUID, "hi", "hi_anika");
  });

  it("Play sample is off until a voice is picked, then speaks that language's own preview from a blob: address; voice_unavailable has its own sentence", async () => {
    const a = acts();
    await toVoice(a);
    const teGroup = within(screen.getByRole("group", { name: "Voice for తెలుగు" }));
    expect(teGroup.getByRole("button", { name: "Play sample" })).toBeDisabled();
    fireEvent.click(teGroup.getByRole("radio", { name: /Ramya/ }));
    await waitFor(() => expect(a.setVoice).toHaveBeenCalled());
    await waitFor(() => expect(teGroup.getByRole("button", { name: "Play sample" })).toBeEnabled());
    fireEvent.click(teGroup.getByRole("button", { name: "Play sample" }));
    await waitFor(() => expect(played).toEqual(["blob:sample"]));
    expect(a.preview).toHaveBeenCalledWith(UUID, { language: "te" });
    expect(teGroup.getByRole("button", { name: "Stop" })).toBeInTheDocument();

    vi.mocked(a.preview).mockResolvedValueOnce(fail("voice_unavailable"));
    fireEvent.click(teGroup.getByRole("button", { name: "Stop" }));
    fireEvent.click(teGroup.getByRole("button", { name: "Play sample" }));
    await waitFor(() => expect(alert()).toHaveTextContent("This voice cannot speak right now. No other voice was used."));
    expect(played).toHaveLength(1);
  });

  it("a language the catalogue has no voices for says so and does not block Next", async () => {
    const a = acts();
    await toVoice(a);
    fireEvent.click(screen.getByRole("checkbox", { name: "ಕನ್ನಡ" }));
    expect(screen.getByText("No voices are listed for ಕನ್ನಡ yet. The standard voice is used.")).toBeInTheDocument();
    fireEvent.click(within(screen.getByRole("group", { name: "Voice for తెలుగు" })).getByRole("radio", { name: /Ramya/ }));
    fireEvent.click(within(screen.getByRole("group", { name: "Voice for English" })).getByRole("radio", { name: /Maya/ }));
    await next();
    await toStep(4);
  });

  it("rules: the first four are ticked to ask first; hours must stay inside 10:00 to 21:00, and a wider time is refused with its sentence before anything is saved", async () => {
    const a = acts();
    await toRules(a);
    for (const name of ["Sending a message", "Making a call", "Giving a discount", "Promising a date"]) expect(screen.getByRole("checkbox", { name })).toBeChecked();
    for (const name of ["Booking a visit", "Sharing a price", "Sending photos or files"]) expect(screen.getByRole("checkbox", { name })).not.toBeChecked();
    expect(screen.getByRole("radio", { name: "Same as the business" })).toBeChecked();
    fireEvent.click(screen.getByRole("radio", { name: "Only these hours" }));
    expect(screen.getByRole("checkbox", { name: "Sun" })).not.toBeChecked();
    fireEvent.change(screen.getByLabelText("From"), { target: { value: "09:00" } });
    await next();
    expect(alert()).toHaveTextContent("Hours must be inside 10:00 to 21:00.");
    fireEvent.change(screen.getByLabelText("From"), { target: { value: "10:00" } });
    fireEvent.change(screen.getByLabelText("To"), { target: { value: "22:00" } });
    await next();
    expect(alert()).toHaveTextContent("Hours must be inside 10:00 to 21:00.");
    fireEvent.change(screen.getByLabelText("To"), { target: { value: "10:00" } });
    await next();
    expect(alert()).toHaveTextContent("Type the times like 10:00 and 18:00, with the start before the end.");
    fireEvent.change(screen.getByLabelText("To"), { target: { value: "18:00" } });
    for (const d of ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]) fireEvent.click(screen.getByRole("checkbox", { name: d }));
    await next();
    expect(alert()).toHaveTextContent("Choose at least one day.");
    fireEvent.click(screen.getByRole("checkbox", { name: "Mon" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Sending photos or files" }));
    await next();
    await toStep(5);
    expect(a.patch).toHaveBeenLastCalledWith(UUID, { askFirst: ["send_message", "make_call", "give_discount", "promise_date", "send_media"], hours: { days: [1], fromMinute: 600, toMinute: 1080 }, neverSay: [], extraInstructions: null });
  });

  it("rules: never-say words are added and removed (up to 30), and the instructions have a live counter against the limit of 1500", async () => {
    const a = acts();
    await toRules(a);
    const box = screen.getByLabelText("Add a word or phrase");
    fireEvent.change(box, { target: { value: "guarantee" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    fireEvent.change(box, { target: { value: "cheapest" } });
    fireEvent.keyDown(box, { key: "Enter" });
    expect(screen.getByText("2 of 30 words", { exact: false })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Remove guarantee" }));
    expect(screen.queryByText("guarantee")).toBeNull();
    expect(screen.getByText("cheapest")).toBeInTheDocument();
    expect(box).toHaveAttribute("maxlength", "60");

    expect(screen.getByText(`0 of ${INSTRUCTIONS_MAX}`)).toBeInTheDocument();
    const text = screen.getByLabelText("Extra instructions");
    fireEvent.change(text, { target: { value: "x".repeat(1500) } });
    expect(screen.getByText("1500 of 1500")).toBeInTheDocument();
    fireEvent.change(text, { target: { value: "x".repeat(1501) } });
    expect(screen.getByText("1501 of 1500")).toBeInTheDocument();
    await next();
    expect(alert()).toHaveTextContent("Make it 1500 letters or fewer.");
    expect(a.patch).not.toHaveBeenCalledWith(UUID, expect.objectContaining({ askFirst: expect.anything() }));
    fireEvent.change(text, { target: { value: "Be polite." } });
    await next();
    await toStep(5);
    expect(a.patch).toHaveBeenLastCalledWith(UUID, { askFirst: ["send_message", "make_call", "give_discount", "promise_date"], hours: null, neverSay: ["cheapest"], extraInstructions: "Be polite." });
  });

  it("only 30 never-say words fit", async () => {
    const a = acts();
    await toRules(a);
    const box = screen.getByLabelText("Add a word or phrase");
    for (let i = 0; i < 31; i++) {
      fireEvent.change(box, { target: { value: `word${i}` } });
      fireEvent.keyDown(box, { key: "Enter" });
    }
    expect(screen.getAllByRole("button", { name: /^Remove / })).toHaveLength(30);
    expect(screen.getByText(/You have added all the words you can\./)).toBeInTheDocument();
  });

  it("work: the role's own jobs are ticked from the draft, Next needs one job or a role title (3 to 60 letters), and both are saved", async () => {
    const a = acts();
    await toRules(a);
    await next();
    await toStep(5);
    expect(screen.getByRole("checkbox", { name: "Reply to new enquiries" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Answer common questions" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Book store visits" })).not.toBeChecked();
    fireEvent.click(screen.getByRole("checkbox", { name: "Reply to new enquiries" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Answer common questions" }));
    await next();
    expect(alert()).toHaveTextContent("Tick at least one job or give a role title.");
    fireEvent.change(screen.getByLabelText("Role title"), { target: { value: "ab" } });
    await next();
    expect(alert()).toHaveTextContent("The role title needs 3 to 60 letters.");
    fireEvent.change(screen.getByLabelText("Role title"), { target: { value: "Showroom helper" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "Book store visits" }));
    await next();
    await toStep(6);
    expect(a.patch).toHaveBeenLastCalledWith(UUID, { responsibilities: ["visit_booking"], roleTitle: "Showroom helper" });
  });

  it("preview plays each language's opening line and shows what it says; there is no test-call button", async () => {
    const a = acts();
    await toRules(a);
    await next();
    await toStep(5);
    await next();
    await toStep(6);
    expect(heading()).toHaveTextContent("Hear how it will greet customers");
    expect(screen.queryByText(/test call/i)).toBeNull();
    const te = within(document.querySelector<HTMLElement>('[data-part="wiz-preview-lang"][data-lang="te"]') as HTMLElement);
    fireEvent.click(te.getByRole("button", { name: "Play sample" }));
    await waitFor(() => expect(te.getByText("Hello in te")).toBeInTheDocument());
    expect(a.preview).toHaveBeenCalledWith(UUID, { language: "te" });
    expect(played).toEqual(["blob:sample"]);
  });

  it("turn on: the summary shows the choices, Turn on calls the action and goes to the employee's page; Save and turn on later leaves it a draft", async () => {
    const a = acts();
    await toRules(a);
    await next();
    await toStep(5);
    await next();
    await toStep(6);
    await next();
    await toStep(7);
    expect(heading()).toHaveTextContent("Ready to turn on?");
    expect(screen.getByText("Priya")).toBeInTheDocument();
    expect(screen.getByText("తెలుగు: Ramya · English: Maya")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Next" })).toBeNull();
    expect(screen.getByRole("link", { name: "Save and turn on later" })).toHaveAttribute("href", `${BASE}/employees`);
    expect(a.setStatus).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Turn on" }));
    await waitFor(() => expect(nav.push).toHaveBeenCalledWith(`${BASE}/employees/${UUID}`));
    expect(a.setStatus).toHaveBeenCalledWith(UUID, "on");
  });

  it("turn on refused: the plain sentence shows and nothing navigates", async () => {
    const a = acts({ setStatus: vi.fn(async () => fail("employee_limit")) });
    await toRules(a);
    await next();
    await toStep(5);
    await next();
    await toStep(6);
    await next();
    await toStep(7);
    fireEvent.click(screen.getByRole("button", { name: "Turn on" }));
    await waitFor(() => expect(alert()).toHaveTextContent("You have all the AI employees your plan allows."));
    expect(nav.push).not.toHaveBeenCalled();
  });

  it("Back goes one step at a time and the counter follows", async () => {
    const a = acts();
    await toVoice(a);
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByText("Step 2 of 7")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByText("Step 1 of 7")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /Receptionist/ })).toBeChecked();
  });
});

describe("the words", () => {
  it("every key the wizard draws is in the store in Telugu too (no raw keys on screen)", () => {
    draw(acts());
    expect(document.body.textContent).not.toMatch(/emp\.wiz\.|emp\.role\./);
    for (const k of ["emp.wiz.step_of", "emp.wiz.err.role", "emp.ask.send_media", "emp.resp.appointment_reminder", "emp.hours.note", "emp.day.7"]) expect(telugu[k], k).toBeTruthy();
  });
});
