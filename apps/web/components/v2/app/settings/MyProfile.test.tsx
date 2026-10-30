import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { appDict, appT } from "@/i18n/app";
import { CALL_LANGS } from "@/lib/assistant/types";

import { Avatar } from "../Avatar";
import { lettersOf } from "../letters";
import { MyProfile } from "./MyProfile";

const en = appT("en");
const WORDS = Object.fromEntries(Object.keys(appDict("en")).filter((k) => k.startsWith("settings.me.")).map((k) => [k, en(k as "frame.notyet")]));
afterEach(cleanup);

describe("Settings > My profile", () => {
  it("shows the saved name and language, the picture, and Remove only for a picture of their own", () => {
    const { rerender } = render(<MyProfile words={WORDS} name="Ravi Kumar" language="te" choices={CALL_LANGS} pictureUrl="https://lh3.googleusercontent.com/a" own={false} email="r@example.com" save={vi.fn()} picture={vi.fn()} />);
    expect(screen.getByLabelText("Your name")).toHaveValue("Ravi Kumar");
    expect(screen.getByRole("radio", { checked: true })).toHaveAttribute("value", "te");
    expect(document.querySelector("img")).toHaveAttribute("src", "https://lh3.googleusercontent.com/a");
    expect(screen.queryByRole("button", { name: "Remove picture" })).toBeNull();
    expect(screen.getByLabelText("Choose a picture")).toHaveAttribute("accept", "image/jpeg,image/png,image/webp");
    rerender(<MyProfile words={WORDS} name="Ravi Kumar" language="te" choices={CALL_LANGS} pictureUrl="https://x/own.jpg" own email="r@example.com" save={vi.fn()} picture={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Remove picture" })).toBeInTheDocument();
  });
  it("draws \"How should I address you?\" only when the API has the field", () => {
    const { rerender } = render(<MyProfile words={WORDS} name="Ravi" language="te" choices={CALL_LANGS} pictureUrl={null} own={false} email={null} save={vi.fn()} picture={vi.fn()} />);
    expect(document.querySelector("#me-address")).toBeNull();
    rerender(<MyProfile words={WORDS} name="Ravi" addressAs="Ravi garu" language="te" choices={CALL_LANGS} pictureUrl={null} own={false} email={null} save={vi.fn()} picture={vi.fn()} />);
    expect((document.querySelector("#me-address") as HTMLInputElement).value).toBe("Ravi garu");
    expect((document.querySelector("#me-address") as HTMLInputElement).maxLength).toBe(30);
  });
  it("draws the letters when there is no picture", () => {
    render(<MyProfile words={WORDS} name="Ravi Kumar" language="en" choices={CALL_LANGS} pictureUrl={null} own={false} email={null} save={vi.fn()} picture={vi.fn()} />);
    expect(document.querySelector("img")).toBeNull();
    expect(screen.getByText("RK")).toBeInTheDocument();
  });
});

describe("the round mark of a person", () => {
  it("always has the letters, with the picture over them when there is one (no text of its own)", () => {
    render(<Avatar url="https://x/me.jpg" letters="RK" className="x" />);
    expect(screen.getByText("RK")).toBeInTheDocument();
    expect(document.querySelector("img")).toHaveAttribute("alt", "");
    cleanup();
    render(<Avatar url={null} letters="RK" className="x" />);
    expect(document.querySelector("img")).toBeNull();
  });
  it("makes letters from a name, else from the e-mail address", () => {
    expect(lettersOf("Ravi Kumar", null)).toBe("RK");
    expect(lettersOf("ravi", null)).toBe("RA");
    expect(lettersOf(null, "sita.devi@example.com")).toBe("SI");
    expect(lettersOf(null, null)).toBe("·");
  });
});
