import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { Sheet } from "./Sheet";

function show(over: Partial<React.ComponentProps<typeof Sheet>> = {}) {
  const onClose = vi.fn();
  render(
    <div>
      <button>opener</button>
      <Sheet open onClose={onClose} title="Approve" id="t" closeLabel="Cancel" {...over}>
        <button>first</button>
        <button>last</button>
      </Sheet>
    </div>,
  );
  return onClose;
}

describe("the confirmation sheet", () => {
  it("is a modal dialog named by its title", () => {
    show();
    expect(screen.getByRole("dialog", { name: "Approve" })).toHaveAttribute("aria-modal", "true");
  });
  it("draws nothing when closed", () => {
    render(<Sheet open={false} onClose={() => {}} title="x" id="t" closeLabel="c">hidden</Sheet>);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
  it("closes on Escape and on the close button, and on a tap on the dim area", () => {
    const onClose = show();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.mouseDown(document.querySelector("[data-sheet]") as HTMLElement);
    expect(onClose).toHaveBeenCalledTimes(3);
  });
  it("does not close while work is being done", () => {
    const onClose = show({ busy: true });
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    fireEvent.mouseDown(document.querySelector("[data-sheet]") as HTMLElement);
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
  });
  it("keeps Tab inside and moves focus in when it opens", () => {
    show();
    const dialog = screen.getByRole("dialog");
    expect(dialog.contains(document.activeElement)).toBe(true);
    const last = screen.getByRole("button", { name: "last" });
    last.focus();
    fireEvent.keyDown(dialog, { key: "Tab" });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.keyDown(dialog, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(last);
  });
});
