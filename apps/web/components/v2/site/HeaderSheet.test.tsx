import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { HeaderSheet } from "./HeaderSheet";

const items = [
  { href: "#how", label: "How it works", icon: <i data-i="how" /> },
  { href: "#finder", label: "Lead Finder", icon: <i data-i="finder" /> },
  { href: "#plans", label: "Plans", icon: <i data-i="plans" /> },
];
const mount = () =>
  render(
    <div data-ui="v2">
      <header>
        <HeaderSheet label="Menu" closeLabel="Close the menu" items={items} login={{ href: "/login", label: "Log in" }} cta={{ href: "#demo", label: "Get free early access" }} icons={{ menu: <i />, close: <i />, login: <i /> }}>
          <button type="button">Language</button>
        </HeaderSheet>
      </header>
    </div>,
  );

describe("the phone menu sheet", () => {
  afterEach(cleanup);
  it("is closed at first and opens as a dialog with the sections, icons, sign-in, the controls and a full-width call to action", async () => {
    mount();
    expect(screen.queryByRole("dialog")).toBeNull();
    const button = screen.getByRole("button", { name: "Menu" });
    expect(button.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(button);
    const dialog = await screen.findByRole("dialog");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    for (const x of ["How it works", "Lead Finder", "Plans", "Log in", "Language", "Get free early access"]) expect(dialog.textContent, x).toContain(x);
    expect(dialog.querySelectorAll("li i").length).toBe(4); // an icon on every line (3 sections + the sign-in; drawn by the server and passed in)
    expect(dialog.querySelector(".h3-btn-block")).not.toBeNull();
  });
  it("moves the focus into the sheet, keeps it there (Tab and Shift+Tab loop), closes on Escape and gives the focus back to the menu button", async () => {
    mount();
    const button = screen.getByRole("button", { name: "Menu" });
    fireEvent.click(button);
    const dialog = await screen.findByRole("dialog");
    expect(dialog.contains(document.activeElement)).toBe(true);
    const focusables = [...dialog.querySelectorAll<HTMLElement>("a[href],button")];
    focusables[focusables.length - 1].focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(document.activeElement).toBe(focusables[0]);
    focusables[0].focus();
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(focusables[focusables.length - 1]);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(button);
  });
});
