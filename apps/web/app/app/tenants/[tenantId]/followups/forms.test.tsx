import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { DRAFT_CHANNELS, TOUCH_CHANNELS } from "@/lib/api/followups";
import { BODY_TEXT, HASH, TOUCH } from "@/lib/api/followups-fixtures";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

import { CreateDraftForm } from "./create-draft-form";
import { DraftText } from "./draft-text";
import { ApproveForm, DiscardForm, SentForm } from "./draft-forms";
import { PolicyForm } from "./policy-form";
import { QuestionButton, SyncQuestionsForm } from "./question-forms";
import { TouchForm } from "./touch-form";

const ok = () => vi.fn(async () => ({ ok: true as const, message: "Recorded." }));
const hidden = (name: string) => (document.querySelector(`input[name="${name}"]`) as HTMLInputElement | null)?.value;
const NOW = "2026-10-07T12:00";

beforeEach(() => refresh.mockClear());

describe("TouchForm", () => {
  it("offers 'I sent it myself' and 'They replied', no 'send', an empty time and a max of now", () => {
    render(<TouchForm action={ok()} touchId={TOUCH} maxNow={NOW} />);
    expect(screen.getByLabelText("I sent it myself")).toBeChecked();
    expect(screen.getByLabelText("They replied")).not.toBeChecked();
    const when = screen.getByLabelText(/When \(India time\)/) as HTMLInputElement;
    expect(when.value).toBe("");
    expect(when.max).toBe(NOW);
    expect(hidden("touch_id")).toBe(TOUCH);
    expect(screen.getByText(/Nothing is sent/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^send/i })).toBeNull();
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("the channels are the closed list", () => {
    render(<TouchForm action={ok()} touchId={TOUCH} maxNow={NOW} />);
    const select = screen.getByLabelText("Channel") as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.value)).toEqual([...TOUCH_CHANNELS]);
  });

  it("submits the form's fields to the action and shows the outcome", async () => {
    const action = ok();
    render(<TouchForm action={action} touchId={TOUCH} maxNow={NOW} />);
    fireEvent.click(screen.getByRole("button", { name: "Record this" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Recorded."));
    const data = (action.mock.calls[0] as unknown as [unknown, FormData])[1];
    expect(data.get("touch_id")).toBe(TOUCH);
    expect(data.get("direction")).toBe("out");
    expect(data.get("happened_at")).toBe("");
  });

  it("an error is shown as an alert in our words", async () => {
    render(<TouchForm action={vi.fn(async () => ({ ok: false as const, error: "A touch cannot be in the future. Leave the time empty for now." }))} touchId={TOUCH} maxNow={NOW} />);
    fireEvent.click(screen.getByRole("button", { name: "Record this" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("cannot be in the future"));
  });
});

describe("CreateDraftForm: the channel and nothing else", () => {
  it("has no text input for wording", () => {
    render(<CreateDraftForm action={ok()} draftId="d" channel="email" />);
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(document.querySelector("textarea")).toBeNull();
    expect(document.querySelector("input:not([type=hidden])")).toBeNull();
    expect(screen.getByText(/you cannot type or change it here/)).toBeInTheDocument();
    const select = screen.getByLabelText("Channel") as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.value)).toEqual([...DRAFT_CHANNELS]);
    expect(select.value).toBe("email");
    expect(screen.getByRole("button", { name: "Ask for a draft" })).toBeInTheDocument();
  });
});

describe("CreateDraftForm: the channel of the page", () => {
  it("starts on the channel the page is showing", () => {
    render(<CreateDraftForm action={ok()} draftId="d" channel="whatsapp" />);
    expect((screen.getByLabelText("Channel") as HTMLSelectElement).value).toBe("whatsapp");
  });
});

describe("ApproveForm: the second factor and the reviewed fingerprint", () => {
  it("carries the state_hash it was shown", () => {
    render(<ApproveForm action={ok()} stateHash={HASH} secondFactorMissing={false} />);
    expect(hidden("state_hash")).toBe(HASH);
    expect(screen.getByRole("button", { name: "Approve this text" })).toBeInTheDocument();
  });

  it("without the second factor the form is replaced by the notice and a link to the Security page", () => {
    render(<ApproveForm action={ok()} stateHash={HASH} secondFactorMissing />);
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByRole("note")).toHaveTextContent(/authenticator app/);
    expect(screen.getByRole("link", { name: /Security page/ })).toHaveAttribute("href", "/app/security");
  });

  it("a stale refusal shows our sentence and reads the page again", async () => {
    const action = vi.fn(async () => ({ ok: false as const, error: "Something changed since this draft was made.", stale: true }));
    render(<ApproveForm action={action} stateHash={HASH} secondFactorMissing={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Approve this text" }));
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("alert")).toHaveTextContent("Something changed");
  });
});

describe("DiscardForm and SentForm", () => {
  it("discard is the quiet button", () => {
    render(<DiscardForm action={ok()} />);
    expect(screen.getByRole("button", { name: "Discard this draft" })).toHaveClass("secondary");
  });

  it("'I sent it myself' carries the touch id, an empty time and the page's now as max; it never says send", () => {
    render(<SentForm action={ok()} touchId={TOUCH} maxNow={NOW} />);
    expect(hidden("touch_id")).toBe(TOUCH);
    const when = screen.getByLabelText(/When you sent it/) as HTMLInputElement;
    expect(when.value).toBe("");
    expect(when.max).toBe(NOW);
    expect(screen.getByRole("button", { name: "Record: I sent it myself" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^send/i })).toBeNull();
  });
});

describe("DraftText", () => {
  it("shows the text as plain text, never as markup, and copies it", async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    const { container } = render(<DraftText text={`<b>${BODY_TEXT}</b>`} />);
    expect(container.querySelector("b")).toBeNull();
    expect(screen.getByLabelText("Draft text")).toHaveTextContent(`<b>${BODY_TEXT}</b>`);
    fireEvent.click(screen.getByRole("button", { name: "Copy the text" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Paste it into your own message."));
    expect(writeText).toHaveBeenCalledWith(`<b>${BODY_TEXT}</b>`);
    expect(screen.queryByRole("button", { name: /^send/i })).toBeNull();
  });

  it("when the browser refuses the copy it says so", async () => {
    Object.defineProperty(navigator, "clipboard", { value: { writeText: vi.fn(async () => Promise.reject(new Error("no"))) }, configurable: true });
    render(<DraftText text="x" />);
    fireEvent.click(screen.getByRole("button", { name: "Copy the text" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Select the text above"));
  });
});

describe("PolicyForm", () => {
  it("starts from a plain default with at least one weekday ticked, and says the numbers are not the family's", () => {
    render(<PolicyForm action={ok()} policyId="p" today="2026-10-07" secondFactorMissing={false} />);
    expect(hidden("policy_id")).toBe("p");
    expect((screen.getByLabelText("Starts on") as HTMLInputElement).min).toBe("2026-10-07");
    expect(screen.getAllByRole("checkbox").filter((c) => (c as HTMLInputElement).checked).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Publish this policy" })).toBeInTheDocument();
  });

  it("without the second factor there is a notice and no form", () => {
    render(<PolicyForm action={ok()} policyId="p" today="2026-10-07" secondFactorMissing />);
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByRole("note")).toHaveTextContent(/authenticator app/);
  });
});

describe("question forms", () => {
  it("sync and the approve/discard buttons", () => {
    render(
      <>
        <SyncQuestionsForm action={ok()} />
        <QuestionButton action={ok()} label="Approve this question" />
        <QuestionButton action={ok()} label="Discard this question" quiet />
      </>,
    );
    expect(screen.getByRole("button", { name: "Update the questions from the requirement" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Approve this question" })).not.toHaveClass("secondary");
    expect(screen.getByRole("button", { name: "Discard this question" })).toHaveClass("secondary");
  });
});
