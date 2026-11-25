import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const nav = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: nav.push, replace: vi.fn(), refresh: vi.fn() }) }));

import { appDict } from "@/i18n/app";
import { expectNoSentenceForm } from "../../../../../test/helpers/no-sentence-form";
import { mockDraft, type TellDraft } from "@/lib/jobs/tell";

import { TellAssistant, type TellActions } from "./TellAssistant";

afterEach(cleanup);
beforeEach(() => nav.push.mockClear());
const words = Object.fromEntries(Object.entries(appDict("en") as Record<string, string>).filter(([k]) => /^(jobs\.(tell|kind|f|opt)\.)/.test(k)));
const BASE = "/app/tenants/t";
const SAY = "Call everyone who asks about a saree and book a visit";

function acts(over: Partial<TellActions> = {}): TellActions {
  return {
    describe: vi.fn(async (input) => ({ ok: true as const, data: mockDraft(input.text, input.mode) })),
    turnOn: vi.fn(async () => ({ ok: true as const, data: { jobId: "11111111-1111-4111-8111-111111111111", waiting: false, saved: true } })),
    ...over,
  };
}
const type = (text: string) => fireEvent.change(screen.getByRole("textbox"), { target: { value: text } });
const goOn = async (a: TellActions, text = SAY) => {
  render(<TellAssistant words={words} base={BASE} actions={a} />);
  type(text);
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  await screen.findByText("Here is what it understood");
};

describe("step 1: say it", () => {
  it("is a box, a language, three boxed choices, Continue and a template link", () => {
    const { container } = render(<TellAssistant words={words} base={BASE} actions={acts()} />);
    expect(screen.getByRole("textbox")).toBeInTheDocument();
    expect(screen.getByLabelText("Language")).toHaveValue("any");
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual(["Any language", "English", "తెలుగు", "हिन्दी", "ಕನ್ನಡ"]);
    const modes = screen.getAllByRole("radio");
    expect(modes.map((m) => m.textContent)).toEqual(["New enquiries, right nowReacts the moment someone asks.", "A list of peopleWorks through people who said yes.", "Incoming callsAnswers when people call you."]);
    expect(modes.map((m) => m.getAttribute("aria-checked"))).toEqual(["true", "false", "false"]);
    expect(screen.getByRole("link", { name: "Start from a template" })).toHaveAttribute("href", `${BASE}/jobs?new=1`);
    expect(screen.getByRole("button", { name: "Continue" })).toBeEnabled();
    expectNoSentenceForm(container);
    expect(container.textContent).not.toMatch(/₹|price/i);
  });
  it("the example in the empty box changes every few seconds: English, English, Telugu; words in the box keep still", () => {
    vi.useFakeTimers();
    try {
      render(<TellAssistant words={words} base={BASE} actions={acts()} />);
      const seen = [screen.getByRole("textbox").getAttribute("placeholder")];
      for (let i = 0; i < 2; i += 1) {
        act(() => void vi.advanceTimersByTime(4500));
        seen.push(screen.getByRole("textbox").getAttribute("placeholder"));
      }
      expect(seen[0]).toBe(words["jobs.tell.ph.1"]);
      expect(seen[1]).toBe(words["jobs.tell.ph.2"]);
      expect(seen[2]).toMatch(/[ఀ-౿]/);
      type("hello there");
      const kept = screen.getByRole("textbox").getAttribute("placeholder");
      act(() => void vi.advanceTimersByTime(9000));
      expect(screen.getByRole("textbox").getAttribute("placeholder")).toBe(kept);
    } finally {
      vi.useRealTimers();
    }
  });
  it("too little written: one plain sentence and nothing is asked", () => {
    const a = acts();
    render(<TellAssistant words={words} base={BASE} actions={a} />);
    type("ab");
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Write a little more about the job (at least 3 letters).");
    expect(a.describe).not.toHaveBeenCalled();
  });
  it("the chosen mode and language go with the words", async () => {
    const a = acts();
    render(<TellAssistant words={words} base={BASE} actions={a} />);
    type(SAY);
    fireEvent.click(screen.getByRole("radio", { name: /Incoming calls/ }));
    fireEvent.change(screen.getByLabelText("Language"), { target: { value: "te" } });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await waitFor(() => expect(a.describe).toHaveBeenCalledWith({ text: SAY, language: "te", mode: "incoming" }));
  });
});

describe("step 2: the draft as plain labelled fields", () => {
  it("shows Name, Who, When, What it does, Language, what it asks first and the hours, and one neutral line: nothing is switched on yet", async () => {
    const a = acts();
    await goOn(a);
    expect(screen.getByLabelText("Name")).toHaveValue("Call every new enquiry right away");
    for (const label of ["Who", "What it does", "Language of the call", "What it asks first"]) expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    expect(screen.getByLabelText("When it calls a new enquiry")).toHaveValue("right_away");
    expect(screen.getByLabelText("Calls start at")).toBeInTheDocument();
    expect(screen.getByLabelText("Calls stop at")).toBeInTheDocument();
    expect(screen.getByText("Everyone who asks about your business")).toBeInTheDocument();
    expect(document.querySelector('[data-part="tell-nothing"]')).toHaveTextContent("Nothing is switched on yet. It starts only when you turn it on.");
    expect(screen.getByRole("button", { name: "Looks right? Turn it on" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Change" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Cancel" })).toHaveAttribute("href", `${BASE}/jobs`);
    expect(a.turnOn).not.toHaveBeenCalled();
  });
  it("a field the assistant could not tell is marked 'I could not tell', and the job cannot be turned on until it is chosen", async () => {
    await goOn(acts());
    const language = screen.getByLabelText("Language of the call");
    expect(language.closest("[data-field]")).toHaveAttribute("data-unclear");
    expect(language).toHaveValue("");
    expect(within(language as HTMLElement).getByRole("option", { name: "I could not tell" })).toBeInTheDocument();
    expect(screen.getByText("I could not tell this one. Please choose it.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Looks right? Turn it on" })).toBeDisabled();
    expect(screen.getByText("A few things were not clear from what you said: language of the call. Please choose them yourself.")).toBeInTheDocument();
    fireEvent.change(language, { target: { value: "te" } });
    expect(language.closest("[data-field]")).not.toHaveAttribute("data-unclear");
    expect(screen.getByRole("button", { name: "Looks right? Turn it on" })).toBeEnabled();
  });
  it("is plain labelled fields: no fill-in-the-blank sentence anywhere", async () => {
    const { container } = render(<TellAssistant words={words} base={BASE} actions={acts()} />);
    type(SAY);
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await screen.findByText("Here is what it understood");
    expectNoSentenceForm(container);
  });
  it("Turn it on: the normal start with the kind, the name and only the choices the owner saw; then the job's own page", async () => {
    const a = acts();
    await goOn(a);
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Saree calls" } });
    fireEvent.change(screen.getByLabelText("Language of the call"), { target: { value: "te" } });
    fireEvent.click(screen.getByRole("button", { name: "Looks right? Turn it on" }));
    await waitFor(() => expect(a.turnOn).toHaveBeenCalledWith({ kind: "speed_to_lead", name: "Saree calls", settings: { when: "right_away", language: "te", thank_you_whatsapp: false } }));
    await waitFor(() => expect(nav.push).toHaveBeenCalledWith(`${BASE}/jobs/11111111-1111-4111-8111-111111111111?started=1`));
  });
  it("Change goes back to the words (kept); nothing was started", async () => {
    const a = acts();
    await goOn(a);
    fireEvent.click(screen.getByRole("button", { name: "Change" }));
    expect(screen.getByRole("textbox")).toHaveValue(SAY);
    expect(a.turnOn).not.toHaveBeenCalled();
  });
  it("when the Owner's OK comes first: one neutral line, the button stays off, nothing opens", async () => {
    const a = acts({ turnOn: vi.fn(async () => ({ ok: true as const, data: { jobId: null, waiting: true, saved: true } })) });
    render(<TellAssistant words={words} base={BASE} actions={a} />);
    type("answer my calls when I am busy");
    fireEvent.click(screen.getByRole("radio", { name: /Incoming calls/ }));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await screen.findByText("Here is what it understood");
    fireEvent.click(screen.getByRole("button", { name: "Looks right? Turn it on" }));
    expect(await screen.findByText("It needs your OK first. You will find it in Needs you on Today.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Looks right? Turn it on" })).toBeDisabled();
    expect(nav.push).not.toHaveBeenCalled();
  });
});

describe("refusals in plain words", () => {
  it("429 ai_limit: the day's describing is used up, one sentence, nothing else changes", async () => {
    const a = acts({ describe: vi.fn(async () => ({ ok: false as const, kind: "rate_limited" as const, code: "ai_limit", error: "That is enough describing for today. Try again tomorrow, or start from a template." })) });
    render(<TellAssistant words={words} base={BASE} actions={a} />);
    type(SAY);
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("That is enough describing for today. Try again tomorrow, or start from a template.");
    expect(screen.getByRole("textbox")).toHaveValue(SAY);
  });
  it("not understood: one sentence that says what to do", async () => {
    render(<TellAssistant words={words} base={BASE} actions={acts()} />);
    type("asdf asdf asdf");
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("I could not match that to a job we have. Say it another way, or start from a template.");
  });
  it("a kind we do not start from a description (custom) reads as not understood", async () => {
    const odd: TellDraft = { understood: true, templateId: "x_y", kind: "custom", goal: null, fields: [], unclear: [], nearest: [], unclearWords: null };
    render(<TellAssistant words={words} base={BASE} actions={acts({ describe: vi.fn(async () => ({ ok: true as const, data: odd })) })} />);
    type(SAY);
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("I could not match that");
  });
  it("a refusal when turning on is one sentence under the fields, and the fields stay", async () => {
    const a = acts({ turnOn: vi.fn(async () => ({ ok: false as const, kind: "forbidden" as const, error: "You are not allowed to do that." })) });
    await goOn(a);
    fireEvent.change(screen.getByLabelText("Language of the call"), { target: { value: "en" } });
    fireEvent.click(screen.getByRole("button", { name: "Looks right? Turn it on" }));
    expect(await screen.findByText("You are not allowed to do that.")).toBeInTheDocument();
    expect(screen.getByLabelText("Language of the call")).toHaveValue("en");
    expect(nav.push).not.toHaveBeenCalled();
  });
});
