import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AddFieldForm } from "./add-field-form";
import { ExtractForm } from "./extract-form";
import { FieldControls } from "./field-controls";
import { PasteEnquiryForm } from "./paste-enquiry-form";
import { QuestionList } from "./question-list";
import { RequirementActions } from "./requirement-actions";

const ENQ = "44444444-4444-4444-4444-444444444444";

describe("PasteEnquiryForm", () => {
  it("sends the page's id and an exact instant in hidden fields, and says what is removed", async () => {
    render(<PasteEnquiryForm action={vi.fn()} enquiryId={ENQ} />);
    expect((document.querySelector('input[name="enquiry_id"]') as HTMLInputElement).value).toBe(ENQ);
    await waitFor(() => expect((document.querySelector('input[name="received_at"]') as HTMLInputElement).value).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/));
    expect(screen.getByText(/E-mail addresses and mobile numbers are removed before this is saved/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save enquiry" })).toBeEnabled();
    expect(Array.from((screen.getByLabelText(/where did it come from/i) as HTMLSelectElement).options).map((o) => o.value)).toEqual(["email", "whatsapp", "form", "other"]);
    fireEvent.change(screen.getByLabelText(/when was it received/i), { target: { value: "2026-10-05T09:30" } });
    expect((document.querySelector('input[name="received_at"]') as HTMLInputElement).value).toBe(new Date("2026-10-05T09:30").toISOString());
  });

  it("shows the outcome the action returns", async () => {
    const action = vi.fn(async () => ({ ok: false as const, error: "Paste the enquiry text." }));
    render(<PasteEnquiryForm action={action} enquiryId={ENQ} />);
    fireEvent.change(screen.getByLabelText(/the enquiry, as you received it/i), { target: { value: "x" } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Save enquiry" })));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Paste the enquiry text."));
  });
});

describe("FieldControls", () => {
  const decide = vi.fn(async () => ({ ok: true as const, message: "Approved." }));
  beforeEach(() => vi.clearAllMocks());

  it("an undecided field shows approve, reject and a correction form", () => {
    render(<FieldControls decide={decide} decided={false} label="f1" />);
    expect(screen.getByRole("button", { name: "Approve" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reject" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save correction" })).toBeInTheDocument();
    expect(document.querySelector("details")).toBeNull();
  });

  it("a decided field hides the controls behind an explicit Change", () => {
    render(<FieldControls decide={decide} decided label="f1" />);
    expect(document.querySelector("details")).not.toBeNull();
    expect(screen.getByText("Change")).toBeInTheDocument();
  });

  it("approving submits the decision value and shows the result", async () => {
    render(<FieldControls decide={decide} decided={false} label="f1" />);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Approve" })));
    await waitFor(() => expect(decide).toHaveBeenCalled());
    const data = (decide.mock.calls[0] as unknown as [unknown, FormData])[1];
    expect(data.get("decision")).toBe("confirm");
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Approved."));
  });
});

describe("AddFieldForm", () => {
  it("asks for a line only for the fields that have one", () => {
    render(<AddFieldForm add={vi.fn()} />);
    expect(screen.getByLabelText(/line \(which kind of saree\)/i)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Field"), { target: { value: "delivery_city" } });
    expect(screen.queryByLabelText(/line \(which kind of saree\)/i)).toBeNull();
    fireEvent.change(screen.getByLabelText("Field"), { target: { value: "quantity" } });
    expect(screen.getByLabelText(/line \(which kind of saree\)/i)).toBeInTheDocument();
  });
});

describe("ExtractForm", () => {
  it("sends the page's run id and says suggestions stay suggestions", () => {
    render(<ExtractForm action={vi.fn()} runId="77777777-7777-4777-8777-777777777777" replaces={false} />);
    expect((document.querySelector('input[name="run_id"]') as HTMLInputElement).value).toBe("77777777-7777-4777-8777-777777777777");
    expect(screen.getByText(/stays "Suggested" until a person|stays &quot;Suggested&quot; until a person|Suggested/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Suggest the fields" })).toBeInTheDocument();
  });
});

describe("QuestionList", () => {
  const questions = [{ code: "missing_delivery_city", text: "Which city should we deliver to?", field_key: "delivery_city" as const, line_no: null }];

  it("shows each question as text with a Copy button and no send control", async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    render(<QuestionList questions={questions} />);
    expect(screen.getByText("Which city should we deliver to?")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /send|approve|discard/i })).toBeNull();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Copy" })));
    expect(writeText).toHaveBeenCalledWith("Which city should we deliver to?");
    await waitFor(() => expect(screen.getByRole("button", { name: "Copied" })).toBeInTheDocument());
  });

  it("says so when there is nothing to ask", () => {
    render(<QuestionList questions={[]} />);
    expect(screen.getByText(/Nothing to ask/)).toBeInTheDocument();
  });
});

describe("RequirementActions", () => {
  it("cannot approve until the requirement is confirmable, and discarding hides behind an explicit control", () => {
    render(<RequirementActions confirm={vi.fn()} discard={vi.fn()} status="draft" confirmable={false} />);
    expect(screen.getByRole("button", { name: "Approve requirement" })).toBeDisabled();
    expect(screen.getByText(/Approve \(or correct\) a saree type and a quantity/)).toBeInTheDocument();
    expect(document.querySelector("details")).not.toBeNull();
  });

  it("an approved requirement offers only discard", () => {
    render(<RequirementActions confirm={vi.fn()} discard={vi.fn()} status="confirmed" confirmable />);
    expect(screen.queryByRole("button", { name: "Approve requirement" })).toBeNull();
    expect(screen.getByText("Discard this requirement")).toBeInTheDocument();
  });
});
