import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CALL_LANG_NAMES } from "@/lib/assistant/types";
import type { TalkTrainingState } from "@/lib/talk-training/types";

import { TalkTraining } from "./TalkTraining";

const DOC = { greeting: {}, address: "plain" as const, questions: ["What is the saree for?"], neverSay: ["guaranteed"], objections: [{ a: "Too costly", b: "We have sarees in many ranges." }], examples: [], sayLike: [] };
const DEFAULTS: TalkTrainingState = { training: DOC, defaults: { ...DOC, greeting: { te: "నమస్తే, నేను AI అసిస్టెంట్‌ని." } }, saved: false, rules: ["Always says it is an AI."], updatedAt: null };
const SAVED: TalkTrainingState = { ...DEFAULTS, saved: true, training: { ...DOC, questions: ["What is the saree for?", "Which colours?"] } };
afterEach(cleanup);
const show = (initial: TalkTrainingState, actions = { save: vi.fn(), reset: vi.fn() }, canEdit = true) =>
  render(<TalkTraining initial={initial} langNames={CALL_LANG_NAMES} canEdit={canEdit} securityHref="/app/security" actions={actions} />);

describe("How I talk to customers", () => {
  it("shows the suggested answers, the greeting's default as a hint, and the platform's own rules read-only", () => {
    show(DEFAULTS);
    expect(screen.getByText("These are the suggested answers for your kind of business. Change anything and save.")).toBeInTheDocument();
    expect(screen.getByLabelText("Greeting")).toHaveAttribute("placeholder", "నమస్తే, నేను AI అసిస్టెంట్‌ని.");
    expect(screen.getByRole("radio", { name: /Plainly/ })).toBeChecked();
    expect(screen.getByLabelText("Question 1")).toHaveValue("What is the saree for?");
    expect(document.querySelector('[data-part="tt-rules"]')).toHaveTextContent("Always says it is an AI.");
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled(); // nothing changed yet
    expect(screen.queryByRole("button", { name: "Use the suggested ones" })).toBeNull(); // nothing of the owner's to remove
  });

  it("the suggested greeting's hint names the business (C1 #364); {business} stays in what is saved", () => {
    const withBiz: TalkTrainingState = { ...DEFAULTS, defaults: { ...DEFAULTS.defaults, greeting: { te: "నమస్కారం, నేను {business} AI assistant ని." } } };
    render(<TalkTraining initial={withBiz} langNames={CALL_LANG_NAMES} canEdit securityHref="/app/security" business="Lakshmi Silks" actions={{ save: vi.fn(), reset: vi.fn() }} />);
    expect(screen.getByLabelText("Greeting")).toHaveAttribute("placeholder", "నమస్కారం, నేను Lakshmi Silks AI assistant ని.");
    expect(screen.getByLabelText("Greeting")).toHaveValue("");
  });

  it("adds a question, saves the whole document and shows what the API answered", async () => {
    const save = vi.fn(async () => ({ ok: true as const, data: SAVED }));
    show(DEFAULTS, { save, reset: vi.fn() });
    fireEvent.click(screen.getByRole("button", { name: "Add a question" }));
    fireEvent.change(screen.getByLabelText("Question 2"), { target: { value: "Which colours?" } });
    fireEvent.click(screen.getByRole("radio", { name: /Garu/ }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.getByText("Saved. Your assistant talks this way from the next call.")).toBeInTheDocument());
    expect(save).toHaveBeenCalledWith({ ...DOC, address: "garu", questions: ["What is the saree for?", "Which colours?"] });
    expect(screen.getByRole("radio", { name: /Plainly/ })).toBeChecked(); // the API's answer, not what was sent
  });

  it("goes back to the suggested ones only after a second yes", async () => {
    const reset = vi.fn(async () => ({ ok: true as const, data: DEFAULTS }));
    show(SAVED, { save: vi.fn(), reset });
    fireEvent.click(screen.getByRole("button", { name: "Use the suggested ones" }));
    expect(reset).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Yes, use the suggested ones" }));
    await waitFor(() => expect(screen.getByText("Back to the suggested ones.")).toBeInTheDocument());
    expect(screen.queryByLabelText("Question 2")).toBeNull();
  });

  it("says a refusal in words: a price or promise, or the missing two-step code with a link to Security", async () => {
    const save = vi.fn().mockResolvedValueOnce({ ok: false, error: "price_or_promise" }).mockResolvedValueOnce({ ok: false, error: "mfa" });
    show(DEFAULTS, { save, reset: vi.fn() });
    fireEvent.change(screen.getByLabelText("Never say 1"), { target: { value: "lowest price" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Please take out amounts, percentages and promises"));
    // the button says "Saving…" until the first answer has settled (a slow machine): press it again only once it is "Save" again
    fireEvent.click(await screen.findByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.getByRole("link", { name: "Open Security" })).toHaveAttribute("href", "/app/security"));
  });

  it("app v4: \"Say it like this\" is edited, saved with the rest, and shown in what goes into the instructions", async () => {
    const save = vi.fn(async () => ({ ok: true as const, data: SAVED }));
    render(<TalkTraining initial={DEFAULTS} langNames={CALL_LANG_NAMES} canEdit securityHref="/app/security" actions={{ save, reset: vi.fn() }} v4 />);
    const preview = () => document.querySelector('[data-part="tt-preview"]')!;
    expect(preview()).toHaveTextContent('"guaranteed"');
    fireEvent.click(screen.getByRole("button", { name: "Add a word" }));
    fireEvent.change(screen.getByLabelText("Say"), { target: { value: "pattu cheera" } });
    fireEvent.change(screen.getByLabelText("Instead of (optional)"), { target: { value: "silk saree" } });
    expect(preview()).toHaveTextContent('"pattu cheera" (not "silk saree")');
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(save).toHaveBeenCalledWith({ ...DOC, sayLike: [{ say: "pattu cheera", insteadOf: "silk saree" }] }));
  });

  it("app v4 with an API that does not know \"Say it like this\" yet: no editor for it, and a save does not send it", async () => {
    const save = vi.fn(async () => ({ ok: true as const, data: SAVED }));
    const older: TalkTrainingState = { ...DEFAULTS, training: { ...DOC, sayLike: null } };
    render(<TalkTraining initial={older} langNames={CALL_LANG_NAMES} canEdit securityHref="/app/security" actions={{ save, reset: vi.fn() }} v4 />);
    expect(document.querySelector('[data-part="tt-say"]')).toBeNull();
    expect(document.querySelector('[data-part="tt-preview"]')).not.toHaveTextContent("Say it like this");
    fireEvent.click(screen.getByRole("radio", { name: /Garu/ }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(save).toHaveBeenCalledWith({ ...DOC, sayLike: null, address: "garu" }));
  });

  it("without v4 there is no say-like editor, no instructions box and no practice", () => {
    render(<TalkTraining initial={DEFAULTS} langNames={CALL_LANG_NAMES} canEdit securityHref="/app/security" actions={{ save: vi.fn(), reset: vi.fn() }} practice={vi.fn()} />);
    for (const part of ["tt-say", "tt-preview", "tt-practice"]) expect(document.querySelector(`[data-part="${part}"]`)).toBeNull();
  });

  it("app v4: a practice call in text, with the unsaved changes; a refusal puts the line back", async () => {
    const practice = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, data: { reply: "Namaste! Which saree are you looking for?", ended: false, handover: false } })
      .mockResolvedValueOnce({ ok: false, error: "busy" })
      .mockResolvedValueOnce({ ok: true, data: { reply: "Thank you for calling. Bye!", ended: true, handover: false } });
    render(<TalkTraining initial={DEFAULTS} langNames={CALL_LANG_NAMES} canEdit securityHref="/app/security" actions={{ save: vi.fn(), reset: vi.fn() }} v4 practice={practice} />);
    const box = () => screen.getByLabelText("What the customer says");
    fireEvent.change(box(), { target: { value: "Do you have Kanchi silk?" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(screen.getByText("Namaste! Which saree are you looking for?")).toBeInTheDocument());
    expect(practice).toHaveBeenLastCalledWith("te", [{ who: "customer", text: "Do you have Kanchi silk?" }], null); // nothing changed: the saved training
    fireEvent.change(screen.getByLabelText("Never say 1"), { target: { value: "lowest price" } });
    fireEvent.change(box(), { target: { value: "Too costly" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("That's a lot of practice this hour."));
    expect(box()).toHaveValue("Too costly");
    expect(practice.mock.calls[1][2]).toMatchObject({ neverSay: ["lowest price"] }); // the unsaved change is tried
    fireEvent.click(await screen.findByRole("button", { name: "Send" }));
    await waitFor(() => expect(screen.getByText("The call ended here.")).toBeInTheDocument());
    expect(screen.queryByLabelText("What the customer says")).toBeNull();
    expect(Array.from(document.querySelectorAll('[data-part="tt-practice-turns"] > li')).map((li) => li.getAttribute("data-who"))).toEqual(["customer", "assistant", "customer", "assistant"]);
    fireEvent.click(screen.getByRole("button", { name: "Start again" }));
    expect(document.querySelector('[data-part="tt-practice-turns"]')).toBeNull();
  });

  it("an Admin reads it and changes nothing", () => {
    show(SAVED, undefined, false);
    expect(screen.getByText("Only the owner can change this.")).toBeInTheDocument();
    expect(screen.getByLabelText("Question 1")).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Add a question" })).toBeNull();
  });
});
