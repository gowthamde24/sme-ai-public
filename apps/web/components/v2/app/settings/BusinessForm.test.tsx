import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { appDict, appT } from "@/i18n/app";
import { CALL_LANGS } from "@/lib/assistant/types";

import { BusinessForm } from "./BusinessForm";

const en = appT("en");
const WORDS = Object.fromEntries(Object.keys(appDict("en")).filter((k) => k.startsWith("settings.biz.")).map((k) => [k, en(k as "frame.notyet")]));
afterEach(cleanup);

describe("Settings > Business form", () => {
  it("is filled with the saved name, city and languages, every field can be changed, and it says where the name shows", () => {
    render(<BusinessForm action={vi.fn()} words={WORDS} name="Pavers Corner" town="Guntur" languages={["en", "te"]} choices={CALL_LANGS} />);
    expect(screen.getByLabelText("Business name")).toHaveValue("Pavers Corner");
    expect(screen.getByLabelText("Business name")).not.toBeDisabled();
    expect(screen.getByLabelText("City or area")).toHaveValue("Guntur");
    const boxes = screen.getAllByRole("checkbox");
    expect(boxes).toHaveLength(CALL_LANGS.length);
    expect(boxes.filter((b) => (b as HTMLInputElement).checked).map((b) => (b as HTMLInputElement).value).sort()).toEqual(["en", "te"]);
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
    const used = document.querySelector('[data-part="name-used"]') as HTMLElement;
    expect(within(used).getByText("Where this name shows")).toBeInTheDocument();
    expect(within(used).getAllByRole("listitem")).toHaveLength(3);
    expect(within(used).getByText("How Vijaya greets you and introduces your business")).toBeInTheDocument();
  });
});
