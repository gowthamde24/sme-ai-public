import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ContextState, Done } from "@/lib/context/types";

import { AboutBusiness } from "./AboutBusiness";
import type { Post, PostBody } from "./context-post";

const STATE: ContextState = { notes: "We sell paver blocks.", version: 2, updatedAt: "2026-10-28T10:00:00Z", updatedBy: { id: "u", name: "Ravi" }, prompts: [{ key: "prices", label: "Prices", hint: "" }, { key: "delivery", label: "Delivery", hint: "" }], usedBy: ["chats", "calls"] };
const PREVIEW = { previewId: "pv_12345678", understood: [{ section: "prices" as const, text: "Paver 38" }], notesMarkdown: "## Prices\nPaver 38", source: { kind: "paste", filename: null }, warnings: [], expiresAt: "x" };
type Body = PostBody;
let calls: Body[];
let reply: (b: Body) => Done<unknown>;
const post = (async (b: Body) => {
  calls.push(b);
  return reply(b);
}) as unknown as Post;
const show = (over: Partial<Parameters<typeof AboutBusiness>[0]> = {}) => render(<AboutBusiness initial={STATE} endpoint="/e" canEdit lang="en" sourcesHref="/s" post={post} {...over} />);

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  calls = [];
  reply = (b) => (b.op === "put" ? { ok: true, data: { ...STATE, notes: b.notes, version: b.version + 1 } } : { ok: true, data: STATE });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("About my business", () => {
  it("saves by itself a moment after the person stops typing, with the version it started from, and says so", async () => {
    show();
    const box = screen.getByLabelText("Your notes");
    fireEvent.change(box, { target: { value: "We sell paver blocks and tiles." } });
    fireEvent.change(box, { target: { value: "We sell paver blocks and tiles. Delivery in the city." } });
    expect(calls).toEqual([]); // not on every key
    await act(async () => void (await vi.advanceTimersByTimeAsync(1300)));
    expect(calls).toEqual([{ op: "put", notes: "We sell paver blocks and tiles. Delivery in the city.", version: 2 }]);
    expect(await screen.findByText(/Saved/)).toBeTruthy();
    fireEvent.change(box, { target: { value: "More." } });
    await act(async () => void (await vi.advanceTimersByTimeAsync(1300)));
    expect(calls.at(-1)).toEqual({ op: "put", notes: "More.", version: 3 }); // the next save starts from the newest version
  });
  it("when someone else saved first the person chooses: show theirs, or keep mine on top", async () => {
    reply = (b) => (b.op === "put" && b.version === 2 ? { ok: false, error: "changed" } : b.op === "get" ? { ok: true, data: { ...STATE, notes: "THEIRS", version: 5 } } : { ok: true, data: { ...STATE, notes: (b as { notes: string }).notes, version: 6 } });
    show();
    fireEvent.change(screen.getByLabelText("Your notes"), { target: { value: "mine" } });
    await act(async () => void (await vi.advanceTimersByTimeAsync(1300)));
    expect(await screen.findByText("Someone else saved newer notes while you were writing.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Keep mine" }));
    await waitFor(() => expect(calls.at(-1)).toEqual({ op: "put", notes: "mine", version: 5 }));
    await waitFor(() => expect(screen.queryByText(/Someone else saved/)).toBeNull());
  });
  it("shows the plain sentence when saving fails and keeps the text; a school's refusal says what it cannot hold", async () => {
    reply = () => ({ ok: false, error: "schools_marks" });
    show();
    fireEvent.change(screen.getByLabelText("Your notes"), { target: { value: "marks list" } });
    await act(async () => void (await vi.advanceTimersByTimeAsync(1300)));
    expect((await screen.findByRole("alert")).textContent).toContain("marks");
    expect((screen.getByLabelText("Your notes") as HTMLTextAreaElement).value).toBe("marks list");
  });
  it("a tap on a heading adds it to the notes", () => {
    show();
    fireEvent.click(screen.getByRole("button", { name: "Delivery" }));
    expect((screen.getByLabelText("Your notes") as HTMLTextAreaElement).value).toBe("We sell paver blocks.\n\n## Delivery\n");
  });
  it("pasted text becomes 'Here is what I understood', editable, and is saved only when the person says so (append)", async () => {
    reply = (b) => (b.op === "understand" ? { ok: true, data: PREVIEW } : b.op === "save" ? { ok: true, data: { ...STATE, notes: `${STATE.notes}\n\n${b.notes}`, version: 3 } } : { ok: true, data: STATE });
    show();
    fireEvent.click(screen.getByRole("button", { name: "Paste text" }));
    fireEvent.change(screen.getByLabelText("Paste text", { selector: "textarea" }), { target: { value: "Paver 38 rupees" } });
    fireEvent.click(screen.getByRole("button", { name: "Read it" }));
    expect(await screen.findByText("Here is what I understood")).toBeTruthy();
    expect(calls.some((c) => c.op === "save")).toBe(false); // nothing saved yet
    fireEvent.change(screen.getByLabelText("Here is what I understood", { selector: "textarea" }), { target: { value: "## Prices\nPaver 40" } });
    fireEvent.click(screen.getByRole("button", { name: "Save these notes" }));
    await waitFor(() => expect(calls.at(-1)).toEqual({ op: "save", previewId: "pv_12345678", notes: "## Prices\nPaver 40", mode: "append", version: 2 }));
    await waitFor(() => expect((screen.getByLabelText("Your notes") as HTMLTextAreaElement).value).toContain("Paver 40"));
    expect(screen.queryByText("Here is what I understood")).toBeNull();
  });
  it("a list of customers is not notes: the warning points to Lead sources and nothing can be saved", async () => {
    reply = (b) => (b.op === "understand" ? { ok: true, data: { ...PREVIEW, notesMarkdown: "", understood: [], warnings: ["looks_like_personal_data" as const] } } : { ok: true, data: STATE });
    show();
    fireEvent.click(screen.getByRole("button", { name: "Paste text" }));
    fireEvent.change(screen.getByLabelText("Paste text", { selector: "textarea" }), { target: { value: "9876543210 Ravi" } });
    fireEvent.click(screen.getByRole("button", { name: "Read it" }));
    expect(await screen.findByText(/looks like a list of customers/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Open lead sources" }).getAttribute("href")).toBe("/s");
    expect(screen.queryByRole("button", { name: "Save these notes" })).toBeNull();
  });
  it("'Try it' shows the answer with where it came from, or says it would wait for the owner and why", async () => {
    reply = (b) => (b.op === "test" ? (b.question.includes("price") ? { ok: true, data: { answer: "", language: "en", used: [], wouldHandOver: true, reason: "asked_about_money" } } : { ok: true, data: { answer: "Yes, in the city.", language: "en", used: [{ from: "notes", snippet: "We deliver in the city" }], wouldHandOver: false, reason: null } }) : { ok: true, data: STATE });
    show();
    const q = screen.getByLabelText("Try it");
    fireEvent.change(q, { target: { value: "do you deliver?" } });
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));
    expect(await screen.findByText("Yes, in the city.")).toBeTruthy();
    expect(screen.getByText(/From your notes/)).toBeTruthy();
    fireEvent.change(q, { target: { value: "what is the price?" } });
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));
    expect(await screen.findByText("It would not answer this by itself. It waits for you.")).toBeTruthy();
    expect(screen.getByText(/price or payment/)).toBeTruthy();
  });
  it("earlier versions load when opened and a version can be brought back", async () => {
    reply = (b) => (b.op === "versions" ? { ok: true, data: [{ version: 2, updatedAt: "2026-10-28T10:00:00Z", updatedBy: "Ravi", size: 5, change: "" }, { version: 1, updatedAt: "2026-10-27T10:00:00Z", updatedBy: "Ravi", size: 3, change: "" }] } : b.op === "restore" ? { ok: true, data: { ...STATE, notes: "OLD", version: 3 } } : { ok: true, data: STATE });
    const { container } = show();
    const details = container.querySelector("details") as HTMLDetailsElement;
    details.open = true;
    fireEvent(details, new Event("toggle"));
    const restore = await screen.findAllByRole("button", { name: "Bring back" });
    expect(restore).toHaveLength(1); // the version in force has no button
    fireEvent.click(restore[0]);
    await waitFor(() => expect(calls).toContainEqual({ op: "restore", version: 1 }));
    await waitFor(() => expect((screen.getByLabelText("Your notes") as HTMLTextAreaElement).value).toBe("OLD"));
  });
  it("is read-only for anyone but the Owner and Admins: no typing, no adding, no test", () => {
    show({ canEdit: false });
    expect((screen.getByLabelText("Your notes") as HTMLTextAreaElement).readOnly).toBe(true);
    expect(screen.getByText("Only the Owner and Admins can change these notes.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Paste text" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Ask" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Delivery" })).toBeNull();
  });
});
