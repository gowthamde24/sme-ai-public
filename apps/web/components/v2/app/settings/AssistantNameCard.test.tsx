import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { appDict } from "@/i18n/app";

import { AssistantNameCard, type RenameFn } from "./AssistantNameCard";

afterEach(cleanup);
const words = appDict("en") as Record<string, string>;
const show = (name: string | null, rename: RenameFn) => render(<AssistantNameCard words={words} name={name} rename={rename} />);
const ok = (name: string | null) => vi.fn<RenameFn>(async () => ({ ok: true, name }));

describe("the assistant name on the Settings home (owner 15 Nov)", () => {
  it("says what the name is now, or that there is none and 'your assistant' is used", () => {
    show("Vani", ok("Vani"));
    expect(screen.getByText("Now: Vani")).toBeInTheDocument();
    cleanup();
    show(null, ok(null));
    expect(screen.getByText(/No name now/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Use “your assistant”/ })).toBeNull();
  });

  it("saves a new name, says so, and Undo puts the earlier name back (the same call with the earlier value)", async () => {
    const rename = vi.fn<RenameFn>(async (n) => ({ ok: true, name: n }));
    show("Meera", rename);
    fireEvent.change(screen.getByLabelText("Assistant name"), { target: { value: "  Vani " } });
    fireEvent.click(screen.getByRole("button", { name: "Save name" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Saved: Vani"));
    expect(rename).toHaveBeenLastCalledWith("Vani");
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Back to the earlier name."));
    expect(rename).toHaveBeenLastCalledWith("Meera");
    expect(screen.getByText("Now: Meera")).toBeInTheDocument();
  });

  it("'Use your assistant' removes the name (null), and Undo brings it back", async () => {
    const rename = vi.fn<RenameFn>(async (n) => ({ ok: true, name: n }));
    show("Meera", rename);
    fireEvent.click(screen.getByRole("button", { name: /Use “your assistant”/ }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Name removed"));
    expect(rename).toHaveBeenLastCalledWith(null);
    expect(screen.getByLabelText("Assistant name")).toHaveValue("");
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(rename).toHaveBeenLastCalledWith("Meera"));
  });

  it("an empty box saves as no name; nothing is sent when nothing changed", async () => {
    const rename = ok(null);
    show("Meera", rename);
    expect(screen.getByRole("button", { name: "Save name" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Assistant name"), { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: "Save name" }));
    await waitFor(() => expect(rename).toHaveBeenCalledWith(null));
  });

  it("says a refusal in plain words and keeps the box as typed", async () => {
    const rename = vi.fn<RenameFn>(async () => ({ ok: false, error: "invalid" }));
    show(null, rename);
    fireEvent.change(screen.getByLabelText("Assistant name"), { target: { value: "Vani!" } });
    fireEvent.click(screen.getByRole("button", { name: "Save name" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Use letters, digits and spaces only"));
    expect(screen.getByLabelText("Assistant name")).toHaveValue("Vani!");
    cleanup();
    show(null, vi.fn<RenameFn>(async () => ({ ok: false, error: "not_available" })));
    fireEvent.change(screen.getByLabelText("Assistant name"), { target: { value: "Vani" } });
    fireEvent.click(screen.getByRole("button", { name: "Save name" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Could not save the name"));
  });
});
