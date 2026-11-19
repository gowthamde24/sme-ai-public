import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { wordsFor } from "@/i18n/app-words";
import type { TalkTraining } from "@/lib/talk-training/types";

import { TestCallIntroduce, type IntroduceSave } from "./TestCallIntroduce";

const W = wordsFor("en", ["tc.", "tt.intro.", "vt.", "sp.err.", "tt.err."], ["sp.save", "sp.saving", "sp.saved", "today.err.mfa.link"]);
const DOC: TalkTraining = { greeting: {}, address: "plain", questions: ["What is the saree for?"], neverSay: [], objections: [], examples: [], sayLike: [], introduceAs: { kind: "business", text: null } };
afterEach(cleanup);

const mount = (via: IntroduceSave, over: { ownerName?: string | null } = {}) => render(<TestCallIntroduce words={W} initial={{ kind: "business", text: null }} ownerName={"ownerName" in over ? over.ownerName : "Gowtham"} business="Lakshmi Silks" via={via} securityHref="/app/security" />);

describe("Introduce as, now on Place a test call (owner, 19 Nov 2026)", () => {
  it("is drawn here with its rules, its preview and the note, which no longer names Lead Desk", () => {
    mount({ kind: "speaks", save: vi.fn() });
    const card = document.querySelector('[data-part="test-call-introduce-saved"]') as HTMLElement;
    expect(within(card).getByRole("heading", { name: "Introduce as, on your test calls" })).toBeInTheDocument();
    expect(card.querySelector('[data-part="tt-introduce"]')).toBeInTheDocument();
    expect(card).toHaveTextContent("Hello, this is the AI assistant of Lakshmi Silks.");
    expect(card).toHaveTextContent("Calls to your customers always use the business name for now.");
    expect(card).not.toHaveTextContent("Lead Desk");
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("saves as the speaks change { introduceAs }, the same payload the old panel sent", async () => {
    const save = vi.fn(async (c: { introduceAs: { kind: "owner"; text: string } }) => ({ ok: true as const, data: { introduceAs: { ...c.introduceAs, ownerName: "Gowtham" } } }));
    mount({ kind: "speaks", save: save as never });
    fireEvent.click(screen.getByRole("radio", { name: "My name" }));
    expect(screen.getByRole("textbox")).toHaveValue("Gowtham"); // filled from the profile
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(save).toHaveBeenCalledWith({ introduceAs: { kind: "owner", text: "Gowtham" } }));
    expect(await screen.findByText("Saved.")).toBeInTheDocument();
  });

  it("without the speaks panel it saves the whole Talk training document with the new introduce_as", async () => {
    const save = vi.fn(async (d: TalkTraining) => ({ ok: true as const, data: { training: d } }));
    mount({ kind: "training", doc: DOC, save });
    fireEvent.click(screen.getByRole("radio", { name: "My own words" }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Gowtham's AI assistant" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(save).toHaveBeenCalledWith({ ...DOC, introduceAs: { kind: "custom", text: "Gowtham's AI assistant" } }));
  });

  it("a bad choice waits for a good one, and the second step is asked for with a link", async () => {
    const save = vi.fn(async () => ({ ok: false as const, error: "mfa" }));
    mount({ kind: "speaks", save: save as never });
    fireEvent.click(screen.getByRole("radio", { name: "My own words" }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Hi" } });
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Gowtham's AI assistant" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/two-step code/i);
    expect(within(alert).getByRole("link")).toHaveAttribute("href", "/app/security");
  });

  it("with no first name in the profile, 'My name' cannot be used", () => {
    mount({ kind: "speaks", save: vi.fn() }, { ownerName: null });
    expect(screen.getByRole("radio", { name: "My name" })).toBeDisabled();
  });
});
