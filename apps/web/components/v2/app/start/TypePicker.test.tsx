import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));

import { appDict } from "@/i18n/app";

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
const FULL = Object.fromEntries(Object.entries(appDict("en") as Record<string, string>).filter(([k]) => k.startsWith("start.type.")));
const words = { ...FULL, "start.type.title": "What kind of business is this?", "start.type.sub": "Pick one.", "start.type.err": "Could not save that. Try again.", "start.type.err.role": "Only the owner can choose this.", "start.type.err.step_up": "Confirm with your code first." };

describe("What kind of business? (asked once, for a workspace made without a type)", () => {
  it("is a plain list of rows (name, a grey line, a round radio); choosing one saves its code and refreshes the page", async () => {
    const save = vi.fn(async () => ({ ok: true as const }));
    render(<TypePicker choices={choices} words={words} save={save} />);
    expect(screen.getByRole("radiogroup", { name: "What kind of business is this?" })).toBeInTheDocument();
    expect(screen.getAllByRole("radio")).toHaveLength(3);
    expect(screen.queryByText(/saree/i, { selector: "legend, p" })).toBeNull();
    // a pick is only a pick: the black border is followed by a plain line and a Continue button that was off before
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
    fireEvent.click(screen.getByRole("radio", { name: /Clinic/ }));
    expect(save).not.toHaveBeenCalled();
    expect(screen.getByText(/You chose Clinic\. Press Continue/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Continue with Clinic" }));
    await waitFor(() => expect(save).toHaveBeenCalledWith("clinic"));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(await screen.findByText("Saved: Clinic. Opening your first steps…")).toBeInTheDocument();
  });
  it("says why it did not save (not the owner, the two-step code is needed, or a plain failure) and leaves nothing chosen", async () => {
    const save = vi.fn(async () => ({ ok: false as const, error: "step_up" as const }));
    render(<TypePicker choices={choices} words={words} save={save} />);
    fireEvent.click(screen.getByRole("radio", { name: /Something else/ }));
    fireEvent.click(screen.getByRole("button", { name: "Continue with Something else" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Confirm with your code first.");
    expect(refresh).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Continue with Something else" })).toBeEnabled(); // the choice stays, to try again
  });
  it("a single radio change (a stray tap, an arrow key) saves nothing: only Continue with <type> saves", async () => {
    const save = vi.fn(async () => ({ ok: true as const }));
    render(<TypePicker choices={choices} words={words} save={save} />);
    const radio = screen.getByRole("radio", { name: /Cloth and sarees/ });
    fireEvent.click(radio);
    fireEvent.keyDown(radio, { key: "ArrowRight" });
    fireEvent.change(screen.getByRole("radio", { name: /Something else/ }), { target: { checked: true } });
    await new Promise((r) => setTimeout(r, 30));
    expect(save).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("radio", { name: /Cloth and sarees/ }));
    expect(screen.getByRole("button", { name: "Continue with Cloth and sarees" })).toBeEnabled();
  });
  it("if the picker is still there a moment after saving (a cached page), the page is asked again", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const save = vi.fn(async () => ({ ok: true as const }));
    render(<TypePicker choices={choices} words={words} save={save} />);
    fireEvent.click(screen.getByRole("radio", { name: /Clinic/ }));
    fireEvent.click(screen.getByRole("button", { name: "Continue with Clinic" }));
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    await act(async () => void vi.advanceTimersByTime(1600));
    expect(refresh).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });
});
