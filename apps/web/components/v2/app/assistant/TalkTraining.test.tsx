import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CALL_LANG_NAMES } from "@/lib/assistant/types";
import type { TalkTrainingState } from "@/lib/talk-training/types";

import { TalkTraining } from "./TalkTraining";

const DOC = { greeting: {}, address: "plain" as const, questions: ["What is the saree for?"], neverSay: ["guaranteed"], objections: [{ a: "Too costly", b: "We have sarees in many ranges." }], examples: [] };
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

  it("an Admin reads it and changes nothing", () => {
    show(SAVED, undefined, false);
    expect(screen.getByText("Only the owner can change this.")).toBeInTheDocument();
    expect(screen.getByLabelText("Question 1")).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Add a question" })).toBeNull();
  });
});
