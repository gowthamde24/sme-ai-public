import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { AddButton } from "./AddButton";

afterEach(cleanup);
const form = (
  <form aria-label="The form">
    <input type="hidden" name="id" value="x" />
    <input aria-label="Name" />
    <button type="submit">Save</button>
  </form>
);

describe("AddButton", () => {
  it("keeps the form out of the page until the button is pressed", () => {
    render(<AddButton label="Add a company">{form}</AddButton>);
    const button = screen.getByRole("button", { name: "Add a company" });
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("form", { name: "The form" })).toBeNull();
    fireEvent.click(button);
    expect(button).toHaveAttribute("aria-expanded", "true");
    expect(button).toHaveAttribute("aria-controls", screen.getByRole("form", { name: "The form" }).parentElement?.id);
  });
  it("puts the focus in the first field when it opens, and a second press closes it", () => {
    render(<AddButton label="Add a company">{form}</AddButton>);
    const button = screen.getByRole("button", { name: "Add a company" });
    fireEvent.click(button);
    expect(screen.getByRole("textbox", { name: "Name" })).toHaveFocus();
    fireEvent.click(button);
    expect(screen.queryByRole("form", { name: "The form" })).toBeNull();
  });
  it("Escape closes it and gives the focus back to the button; the Escape does not travel on to a menu around it", () => {
    let outer = 0;
    render(
      <div onKeyDown={() => (outer += 1)}>
        <AddButton label="Add a company">{form}</AddButton>
      </div>,
    );
    const button = screen.getByRole("button", { name: "Add a company" });
    fireEvent.click(button);
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Name" }), { key: "Escape" });
    expect(screen.queryByRole("form", { name: "The form" })).toBeNull();
    expect(button).toHaveFocus();
    expect(outer).toBe(0);
    fireEvent.keyDown(button, { key: "Escape" }); // closed: the next Escape belongs to whoever is around
    expect(outer).toBe(1);
  });
});
