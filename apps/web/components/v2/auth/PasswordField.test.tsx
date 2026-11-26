import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PasswordField } from "./PasswordField";

afterEach(cleanup);

const draw = (props: Partial<React.ComponentProps<typeof PasswordField>> = {}, onSubmit = vi.fn()) =>
  render(
    <form onSubmit={onSubmit}>
      <label htmlFor="pw">Password</label>
      <PasswordField id="pw" name="password" autoComplete="current-password" required maxLength={72} className="field" {...props} />
      <button type="submit">Go</button>
      <button type="button">Elsewhere</button>
    </form>,
  );

describe("the show-password eye (owner, 26 Nov 2026)", () => {
  it("starts hidden; the eye shows and hides it, says which, and tells assistive technology its state", () => {
    draw();
    const input = screen.getByLabelText("Password") as HTMLInputElement;
    const eye = screen.getByRole("button", { name: "Show password" });
    expect(input.type).toBe("password");
    expect(eye).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(eye);
    expect(input.type).toBe("text");
    const hide = screen.getByRole("button", { name: "Hide password" });
    expect(hide).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(hide);
    expect(input.type).toBe("password");
  });
  it("is the same input (id, name, autocomplete, required, length, the typed text) so autofill and password managers keep working", () => {
    draw();
    const input = screen.getByLabelText("Password") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "correct horse battery" } });
    fireEvent.click(screen.getByRole("button", { name: "Show password" }));
    expect(screen.getByLabelText("Password")).toBe(input); // not replaced
    expect(input).toHaveValue("correct horse battery");
    expect(input).toHaveAttribute("name", "password");
    expect(input).toHaveAttribute("autocomplete", "current-password");
    expect(input).toBeRequired();
    expect(input).toHaveAttribute("maxlength", "72");
    expect([input.getAttribute("autocapitalize"), input.getAttribute("autocorrect"), input.getAttribute("spellcheck")]).toEqual(["off", "off", "false"]);
  });
  it("is a button that never submits the form, is reachable by Tab (right after the field), is 48 px square, and its icon is hidden from screen readers", () => {
    const submit = vi.fn((e: React.FormEvent) => e.preventDefault());
    draw({}, submit);
    const eye = screen.getByRole("button", { name: "Show password" });
    expect(eye).toHaveAttribute("type", "button");
    expect(eye).not.toHaveAttribute("tabindex", "-1");
    fireEvent.click(eye);
    expect(submit).not.toHaveBeenCalled();
    expect(eye).toHaveClass("size-12"); // 48 px: at least a 44 px touch target
    expect(eye.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    const order = [...document.querySelectorAll("input,button")];
    expect(order.indexOf(eye)).toBe(order.indexOf(screen.getByLabelText("Password")) + 1);
  });
  it("goes back to hidden when focus leaves the field and its eye, not when it moves between them", () => {
    draw();
    const input = screen.getByLabelText("Password") as HTMLInputElement;
    fireEvent.click(screen.getByRole("button", { name: "Show password" }));
    const hide = screen.getByRole("button", { name: "Hide password" });
    fireEvent.blur(input, { relatedTarget: hide }); // to the eye: stays shown
    expect(input.type).toBe("text");
    fireEvent.blur(hide, { relatedTarget: screen.getByRole("button", { name: "Elsewhere" }) });
    expect(input.type).toBe("password");
  });
  it("takes the words of the person's language, and colours that follow the theme (no fixed colour)", () => {
    draw({ showLabel: "పాస్‌వర్డ్ చూపించండి", hideLabel: "పాస్‌వర్డ్ దాచండి" });
    const eye = screen.getByRole("button", { name: "పాస్‌వర్డ్ చూపించండి" });
    fireEvent.click(eye);
    expect(screen.getByRole("button", { name: "పాస్‌వర్డ్ దాచండి" })).toBeInTheDocument();
    expect(eye.className).not.toMatch(/#[0-9a-f]{3,6}|text-white|text-black/i); // theme tokens only: light and dark both follow
  });
});
