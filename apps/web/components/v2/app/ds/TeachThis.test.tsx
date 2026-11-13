import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { appDict } from "@/i18n/app";

import { TeachThis, type TeachActions } from "./TeachThis";

const dict = appDict("en") as Record<string, string>;
const WORDS = Object.fromEntries(Object.entries(dict).filter(([k]) => k.startsWith("dst.teach")));
const ID = "11111111-aaaa-4aaa-8aaa-000000000001";
const acts = (over: Partial<TeachActions> = {}): TeachActions => ({ save: vi.fn(async () => ({ ok: true as const, id: ID })), undo: vi.fn(async () => ({ ok: true as const })), ...over });
const draw = (actions: TeachActions | null) => render(<TeachThis words={WORDS} source="call" sourceId="c1" lineIndex={3} line="We open at 9." actions={actions} />);
afterEach(cleanup);

describe("Teach this", () => {
  it("is not drawn for someone who may not teach (no actions)", () => {
    draw(null);
    expect(document.querySelector('[data-part="teach"]')).toBeNull();
  });

  it("opens with the line itself, saves the corrected answer for THIS line of THIS call, and says it went to Knowledge", async () => {
    const a = acts();
    draw(a);
    fireEvent.click(screen.getByRole("button", { name: /Teach this/ }));
    const box = screen.getByLabelText("What should it have said?");
    expect(box).toHaveValue("We open at 9.");
    fireEvent.change(box, { target: { value: "  We open at 10 am on Sundays.  " } });
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: "Save to Knowledge" })));
    expect(a.save).toHaveBeenCalledWith({ source: "call", sourceId: "c1", lineIndex: 3, answer: "We open at 10 am on Sundays." });
    expect(screen.getByRole("status")).toHaveTextContent("Saved to Knowledge.");
  });

  it("Undo takes it back and returns to the button", async () => {
    const a = acts();
    draw(a);
    fireEvent.click(screen.getByRole("button", { name: /Teach this/ }));
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: "Save to Knowledge" })));
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: "Undo" })));
    expect(a.undo).toHaveBeenCalledWith(ID);
    expect(screen.getByRole("button", { name: /Teach this/ })).toBeInTheDocument();
  });

  it("an empty or markup answer cannot be saved; a refusal is shown in our words and nothing is marked saved", async () => {
    const a = acts({ save: vi.fn(async () => ({ ok: false as const, error: "Could not save this. Try again in a minute." })) });
    draw(a);
    fireEvent.click(screen.getByRole("button", { name: /Teach this/ }));
    const box = screen.getByLabelText("What should it have said?");
    fireEvent.change(box, { target: { value: "x" } });
    expect(screen.getByRole("button", { name: "Save to Knowledge" })).toBeDisabled();
    fireEvent.change(box, { target: { value: "<b>open</b>" } });
    expect(screen.getByRole("button", { name: "Save to Knowledge" })).toBeDisabled();
    fireEvent.change(box, { target: { value: "We open at 10." } });
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: "Save to Knowledge" })));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Could not save this"));
    expect(screen.queryByRole("status")).toBeNull();
  });
});
