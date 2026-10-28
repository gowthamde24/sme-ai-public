import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { wordsFor } from "@/i18n/app-words";

import { GstinForm, type GstinSave } from "./GstinForm";

const WORDS = wordsFor("en", ["gst.", "apierr.", "problem."], ["dta.btn.working"]);
const GOOD = "27AAPFU0939F1ZV";
const ok = (gstin: string | null, state: string | null = gstin ? "Maharashtra" : null): GstinSave => vi.fn(async () => ({ ok: true as const, data: { gstin, state } }));
const fail = (kind: string, code?: string, extra: Record<string, unknown> = {}) => ({ ok: false as const, kind: kind as never, error: "", ...(code ? { code } : {}), ...extra });
const press = (name: string | RegExp) => act(async () => fireEvent.click(screen.getByRole("button", { name })));
const type = (v: string) => fireEvent.change(screen.getByLabelText("GSTIN (15 characters)"), { target: { value: v } });
beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

describe("the GSTIN form", () => {
  it("shows the saved number with its state, and says when there is none", () => {
    render(<GstinForm words={WORDS} title="Our GSTIN" initial={{ gstin: GOOD, state: "Maharashtra" }} canEdit save={ok(null)} />);
    expect(screen.getByText(GOOD)).toBeInTheDocument();
    expect(screen.getByText("State: Maharashtra")).toBeInTheDocument();
    cleanup();
    render(<GstinForm words={WORDS} title="Our GSTIN" initial={{ gstin: null, state: null }} canEdit save={ok(null)} />);
    expect(screen.getByText("No GSTIN saved.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Remove the GSTIN" })).toBeNull();
  });
  it("checks the number as it is typed, in the order a person fixes it, and the button waits for a good one", () => {
    render(<GstinForm words={WORDS} title="Our GSTIN" initial={{ gstin: null, state: null }} canEdit save={ok(GOOD)} />);
    const save = screen.getByRole("button", { name: "Save GSTIN" });
    expect(save).toBeDisabled();
    type("27AAPFU0939F1Z");
    expect(screen.getByRole("alert")).toHaveTextContent("A GSTIN has 15 characters.");
    type("99999FU0939F1ZV");
    expect(screen.getByRole("alert")).toHaveTextContent("This GSTIN is not valid: check the 15 characters.");
    type("27AAPFU0939F1ZW");
    expect(screen.getByRole("alert")).toHaveTextContent("The last character does not fit the others.");
    expect(save).toBeDisabled();
    type(" 27aapfu-0939 f1zv ");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByText("State: Maharashtra")).toBeInTheDocument(); // named from the first two digits while typing
    expect(save).toBeEnabled();
  });
  it("sends the plain 15 characters, then shows what the server holds", async () => {
    const save = ok(GOOD);
    render(<GstinForm words={WORDS} title="Our GSTIN" initial={{ gstin: null, state: null }} canEdit save={save} />);
    type(" 27aapfu-0939 f1zv ");
    await press("Save GSTIN");
    expect(save).toHaveBeenCalledWith(GOOD);
    expect(screen.getByRole("status")).toHaveTextContent("GSTIN saved.");
    expect(screen.getByLabelText("GSTIN (15 characters)")).toHaveValue(GOOD);
    expect(screen.getByRole("button", { name: "Remove the GSTIN" })).toBeInTheDocument();
  });
  it("removes it with null", async () => {
    const save = ok(null);
    render(<GstinForm words={WORDS} title="Our GSTIN" initial={{ gstin: GOOD, state: "Maharashtra" }} canEdit save={save} />);
    await press("Remove the GSTIN");
    expect(save).toHaveBeenCalledWith(null);
    expect(screen.getByRole("status")).toHaveTextContent("GSTIN removed.");
    expect(screen.getByText("No GSTIN saved.")).toBeInTheDocument();
  });
  it.each([
    [fail("mfa", undefined, { mfa: true }), /two-step code/],
    [fail("invalid", "validation_error"), /This GSTIN is not valid: check the 15 characters\./],
    [fail("forbidden"), /Your role cannot do this/],
    [fail("rate_limited", undefined, { retryAfter: 8 }), /Wait 8 seconds/],
    [fail("unavailable"), /could not reach the service/],
  ])("a refusal (%j) is said in words and keeps what was typed", async (reply, words) => {
    render(<GstinForm words={WORDS} title="Our GSTIN" initial={{ gstin: null, state: null }} canEdit save={vi.fn(async () => reply)} />);
    type(GOOD);
    await press("Save GSTIN");
    expect(screen.getByRole("alert")).toHaveTextContent(words);
    expect(screen.getByLabelText("GSTIN (15 characters)")).toHaveValue(GOOD);
  });
  it("says it only checks the form of the number, never that the business exists", () => {
    render(<GstinForm words={WORDS} title="Our GSTIN" initial={{ gstin: null, state: null }} canEdit save={ok(null)} />);
    expect(screen.getByText(/We do not check with the GST portal that the business exists or is active/)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/verified/i);
  });
  it("a customer's number is flagged as personal data", () => {
    render(<GstinForm words={WORDS} title="Customer's GSTIN" personal initial={{ gstin: null, state: null }} canEdit save={ok(null)} />);
    expect(screen.getByText(/holds the owner's PAN/)).toBeInTheDocument();
  });
  it("without the right to change it, it only reads", () => {
    render(<GstinForm words={WORDS} title="Our GSTIN" initial={{ gstin: GOOD, state: "Maharashtra" }} canEdit={false} save={ok(null)} />);
    expect(screen.queryByRole("button", { name: "Save GSTIN" })).toBeNull();
    expect(screen.getByText("Only an owner or an admin can change the shop's GSTIN.")).toBeInTheDocument();
    expect(screen.getByText(GOOD)).toBeInTheDocument();
  });
});
