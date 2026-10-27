import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));

import { appDict } from "@/i18n/app";
import type { Fact, KDone, KnowledgeSource } from "@/lib/lead-desk/knowledge";
import type { PDone, PlaybookRead } from "@/lib/lead-desk/playbook";

import { KnowledgeStep, type KnowledgeActions } from "./KnowledgeStep";
import { PlaybookStep } from "./PlaybookStep";
import { WizardFrame } from "./WizardFrame";
import { WizardTestCall } from "./WizardTestCall";

const words = Object.fromEntries(Object.entries(appDict("en") as Record<string, string>).filter(([k]) => /^(ld|pc|asst)\./.test(k)));
const src = (over: Partial<KnowledgeSource> = {}): KnowledgeSource => ({ id: "s1", title: "My site", kind: "paste", filename: null, contentType: null, chars: 100, status: "read", createdAt: "x", facts: { draft: 0, approved: 0, rejected: 0 }, ...over });
const fact = (over: Partial<Fact> = {}): Fact => ({ id: "f1", kind: "hours", text: "Open Monday to Saturday.", status: "draft", edited: false, sourceId: "s1", decidedAt: null, decidedByYou: false, ...over });
const ok = <T,>(value: T): KDone<T> => ({ ok: true, value });
beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

const knowledge = (over: Partial<Parameters<typeof KnowledgeStep>[0]> = {}, a: Partial<KnowledgeActions> = {}) => {
  const actions: KnowledgeActions = { addPaste: vi.fn(async () => ok(src())), addFile: vi.fn(async () => ok(src({ kind: "file" }))), draft: vi.fn(async () => ok([fact()])), addFact: vi.fn(async () => ok(fact())), edit: vi.fn(async () => ok(fact({ edited: true }))), decide: vi.fn(async (id: string, d: "approve" | "reject") => ok(fact({ id, status: d === "approve" ? "approved" : "rejected" }))), discard: vi.fn(async () => ok(src({ status: "discarded" }))), ...a };
  render(<KnowledgeStep words={words} sources={[]} facts={[]} actions={actions} canPrice securityHref="/app/security" nextHref="/b/lead-setup?step=2" {...over} />);
  return actions;
};

describe("step 1: what you sell", () => {
  it("adds pasted text with a name, then offers to draft the facts, and nothing is stated before it is approved", async () => {
    const a = knowledge();
    expect(screen.getByRole("button", { name: "Add this text" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Paste the text here"), { target: { value: "We are open Monday to Saturday." } });
    fireEvent.change(screen.getByLabelText("A name for it (optional)"), { target: { value: "My site" } });
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: "Add this text" })));
    const sent = (a.addPaste as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(sent).toMatchObject({ title: "My site", text: "We are open Monday to Saturday." });
    expect(sent.sourceId).toMatch(/^[0-9a-f-]{36}$/);
    expect(screen.getByRole("button", { name: "Draft the facts" })).toBeEnabled();
    expect(refresh).toHaveBeenCalled();
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: "Draft the facts" })));
    expect(a.draft).toHaveBeenCalledWith("s1");
    expect(screen.getByText(/1 facts are waiting for you|facts are waiting for you/)).toBeInTheDocument();
    expect(screen.getByText("Open Monday to Saturday.")).toBeInTheDocument();
  });
  it("a fact can be approved, changed (it goes back to be checked) or rejected", async () => {
    const a = knowledge({ sources: [src({ status: "drafted" })], facts: [fact()] });
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: "Approve" })));
    expect(a.decide).toHaveBeenCalledWith("f1", "approve");
    expect(screen.getByText("Approved")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Change" }));
    fireEvent.change(screen.getByLabelText("The fact"), { target: { value: "Open every day." } });
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: "Save" })));
    expect(a.edit).toHaveBeenCalledWith("f1", { text: "Open every day." });
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: "Reject" })));
    expect(a.decide).toHaveBeenLastCalledWith("f1", "reject");
  });
  it("a price needs the Owner: an Admin cannot approve it, the Owner is told about the second factor, and a refusal links to setting it up", async () => {
    const price = fact({ kind: "price", text: "Flats start at ₹45 lakh." });
    knowledge({ facts: [price], sources: [src()] }, {});
    expect(screen.getByText(/needs your second sign-in step/)).toBeInTheDocument();
    cleanup();
    knowledge({ facts: [price], sources: [src()], canPrice: false });
    expect(screen.getByRole("button", { name: "Approve" })).toBeDisabled();
    expect(screen.getByText("Only the Owner can approve a price.")).toBeInTheDocument();
    cleanup();
    knowledge({ facts: [price], sources: [src()] }, { decide: vi.fn(async (): Promise<KDone<Fact>> => ({ ok: false, error: "mfa" })) });
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: "Approve" })));
    expect(screen.getByRole("alert")).toHaveTextContent("second sign-in step");
    expect(screen.getByRole("link", { name: "Set it up" })).toHaveAttribute("href", "/app/security");
  });
  it("says in words why a file or a read did not work", async () => {
    knowledge({ sources: [src()] }, { draft: vi.fn(async (): Promise<KDone<Fact[]>> => ({ ok: false, error: "reader" })) });
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: "Draft the facts" })));
    expect(screen.getByRole("alert")).toHaveTextContent("Photos and scanned pages cannot be read yet");
    cleanup();
    knowledge();
    const input = screen.getByLabelText("Or upload a file") as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(["x"], "photo.jpg", { type: "image/jpeg" })] } });
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("That kind of file is not read"));
  });
  it("a failure from the action keeps what was there and says nothing changed", async () => {
    knowledge({ facts: [fact()], sources: [src()] }, { decide: vi.fn(async () => Promise.reject(new Error("net"))) });
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: "Approve" })));
    expect(screen.getByRole("alert")).toHaveTextContent("Nothing was changed");
    expect(screen.getByText("To check")).toBeInTheDocument();
  });
});

const pbBody = { goalAsk: "Book a visit when they are ready.", questions: [{ field: "need", ask: "What are you looking for?", required: true }, { field: "budget", ask: "What budget range?", required: false }], objections: [{ code: "too_expensive", hears: ["too costly"], answer: "I understand." }], followups: [{ when: "no_answer", afterMinutes: 30, channel: "call", maxAttempts: 3, message: null }, { when: "booked", afterMinutes: -60, channel: "whatsapp", maxAttempts: 1, message: "See you." }], raw: {} };
const read = (over: Partial<PlaybookRead> = {}): PlaybookRead => ({ templatePack: "real_estate", saved: false, playbook: pbBody, defaults: { ...pbBody, questions: [...pbBody.questions, { field: "area", ask: "Which area?", required: false }] }, safety: ["Says it is an AI assistant."], updatedAt: null, ...over });
const fieldNames = { need: "What they need", budget: "Budget", area: "Area" };
const playbook = (r = read(), canEdit = true, a: Partial<{ save: (i: unknown) => Promise<PDone<PlaybookRead>>; reset: () => Promise<PDone<PlaybookRead>> }> = {}) => {
  const actions = { save: vi.fn(async (): Promise<PDone<PlaybookRead>> => ({ ok: true, value: read({ saved: true }) })), reset: vi.fn(async (): Promise<PDone<PlaybookRead>> => ({ ok: true, value: read() })), ...a };
  render(<PlaybookStep words={words} read={r} canEdit={canEdit} actions={actions} securityHref="/app/security" nextHref="/b/lead-setup?step=4" fieldNames={fieldNames} />);
  return actions;
};

describe("step 3: goal and questions", () => {
  it("shows the goal, each question under the name of its field, the objections, the follow-ups and the fixed safety rules", () => {
    playbook();
    expect(screen.getByLabelText("The goal of the call")).toHaveValue("Book a visit when they are ready.");
    expect(screen.getAllByText("What they need").length).toBeGreaterThan(0);
    expect(screen.getByText("When they say: too costly")).toBeInTheDocument();
    expect(screen.getByText(/60 minutes before/)).toBeInTheDocument();
    expect(screen.getByText("Says it is an AI assistant.")).toBeInTheDocument();
  });
  it("saves the edited goal and questions in order; a removed question can be added back from the standard ones", async () => {
    const a = playbook();
    fireEvent.change(screen.getByLabelText("The goal of the call"), { target: { value: "Book a site visit this week." } });
    fireEvent.click(screen.getAllByRole("button", { name: "Move down" })[0]);
    fireEvent.click(screen.getAllByRole("button", { name: "Remove" })[1]);
    fireEvent.click(screen.getByRole("button", { name: "Area" }));
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: "Save goal and questions" })));
    expect(a.save).toHaveBeenCalledWith({ goalAsk: "Book a site visit this week.", questions: [{ field: "budget", ask: "What budget range?", required: false }, { field: "area", ask: "Which area?", required: false }] });
    expect(screen.getByRole("status")).toHaveTextContent("Saved");
  });
  it("a goal or a question with a price or a promise cannot be saved, and says why", () => {
    playbook();
    fireEvent.change(screen.getByLabelText("The goal of the call"), { target: { value: "We guarantee a loan today." } });
    expect(screen.getByRole("alert")).toHaveTextContent("cannot state a price or a promise");
    expect(screen.getByRole("button", { name: "Save goal and questions" })).toBeDisabled();
  });
  it("only the Owner saves; an approval without the second factor links to setting it up; 'standard' is offered once saved", async () => {
    playbook(read(), false);
    expect(screen.queryByRole("button", { name: "Save goal and questions" })).toBeNull();
    expect(screen.getByText(/Only the Owner can change these/)).toBeInTheDocument();
    cleanup();
    const a = playbook(read({ saved: true }), true, { save: vi.fn(async (): Promise<PDone<PlaybookRead>> => ({ ok: false, error: "mfa" })) });
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: "Save goal and questions" })));
    expect(screen.getByRole("alert")).toHaveTextContent("second sign-in step");
    expect(screen.getByRole("link", { name: "Set it up" })).toBeInTheDocument();
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: "Go back to the standard" })));
    expect(a.reset).toHaveBeenCalled();
  });
});

describe("the frame and the test call", () => {
  it("shows the step of six with a progress bar, every step as a link, skip and back (no skip on the last, no back on the first)", () => {
    render(<WizardFrame words={words} step={3} base="/b"><p>body</p></WizardFrame>);
    expect(screen.getByText("Step 3 of 6")).toBeInTheDocument();
    expect(document.querySelector("progress")).toHaveAttribute("value", "3");
    expect(screen.getByRole("link", { name: "3. Goal and questions" })).toHaveAttribute("aria-current", "step");
    expect(screen.getByRole("link", { name: "Skip this step" })).toHaveAttribute("href", "/b/lead-setup?step=4");
    expect(screen.getByRole("link", { name: "Back" })).toHaveAttribute("href", "/b/lead-setup?step=2");
    cleanup();
    render(<WizardFrame words={words} step={1} base="/b"><p>x</p></WizardFrame>);
    expect(screen.queryByRole("link", { name: "Back" })).toBeNull();
    cleanup();
    render(<WizardFrame words={words} step={6} base="/b"><p>x</p></WizardFrame>);
    expect(screen.queryByRole("link", { name: "Skip this step" })).toBeNull();
  });
  it("the test call shows what would be said and recorded as plain text; a failure says so; a non-owner cannot run it", async () => {
    const run = vi.fn(async () => ({ ok: true as const, call: { note: "A simulation.", transcript: [{ speaker: "assistant" as const, text: "Hello <b>there</b>" }], outcome: { outcome: "positive" as const, category: "interested", reason: "Asked for details." } } }));
    render(<WizardTestCall words={words} run={run} canRun lang="en" />);
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: "Try a test call (a simulation)" })));
    expect(screen.getByText("A simulation.")).toBeInTheDocument();
    expect(document.querySelector("[data-part=wizard-test-call]")?.textContent).toContain("Hello <b>there</b>");
    cleanup();
    render(<WizardTestCall words={words} run={async () => ({ ok: false, error: "mfa" })} canRun lang="en" />);
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: "Try a test call (a simulation)" })));
    expect(screen.getByRole("alert")).toBeInTheDocument();
    cleanup();
    render(<WizardTestCall words={words} run={run} canRun={false} lang="en" />);
    expect(screen.getByRole("button", { name: "Try a test call (a simulation)" })).toBeDisabled();
    expect(screen.getByText("Only the Owner can run the test.")).toBeInTheDocument();
  });
});
