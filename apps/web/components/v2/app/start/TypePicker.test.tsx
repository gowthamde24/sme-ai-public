import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));

import { TypePicker } from "./TypePicker";

afterEach(() => {
  cleanup();
  refresh.mockReset();
});
const choices = [
  { id: "clinic", name: "Clinic", line: "Doctors and appointments" },
  { id: "textiles", name: "Cloth and sarees", line: "A shop with stock" },
  { id: "general_business", name: "Something else", line: "" },
];
const words = { "start.type.title": "What kind of business is this?", "start.type.sub": "Pick one.", "start.type.err": "Could not save that. Try again.", "start.type.err.role": "Only the owner can choose this.", "start.type.err.step_up": "Confirm with your code first." };

describe("What kind of business? (asked once, for a workspace made without a type)", () => {
  it("is a plain list of rows (name, a grey line, a round radio); choosing one saves its code and refreshes the page", async () => {
    const save = vi.fn(async () => ({ ok: true as const }));
    render(<TypePicker choices={choices} words={words} save={save} />);
    expect(screen.getByRole("radiogroup", { name: "What kind of business is this?" })).toBeInTheDocument();
    expect(screen.getAllByRole("radio")).toHaveLength(3);
    expect(screen.queryByText(/saree/i, { selector: "legend, p" })).toBeNull();
    fireEvent.click(screen.getByRole("radio", { name: /Clinic/ }));
    await waitFor(() => expect(save).toHaveBeenCalledWith("clinic"));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });
  it("says why it did not save (not the owner, the two-step code is needed, or a plain failure) and leaves nothing chosen", async () => {
    const save = vi.fn(async () => ({ ok: false as const, error: "step_up" as const }));
    render(<TypePicker choices={choices} words={words} save={save} />);
    fireEvent.click(screen.getByRole("radio", { name: /Something else/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Confirm with your code first.");
    expect(refresh).not.toHaveBeenCalled();
    for (const r of screen.getAllByRole("radio")) expect(r).not.toBeChecked();
  });
});
