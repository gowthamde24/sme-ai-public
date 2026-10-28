import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { appDict, appT } from "@/i18n/app";
import { CALL_LANGS } from "@/lib/assistant/types";

import type { TypeGroup, TypeWords } from "@/components/v2/auth/TypeCombobox";

import { BusinessForm, BusinessLogo } from "./BusinessForm";

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

const TYPE_WORDS: TypeWords = { label: "Kind of business", placeholder: "Search", none: "Nothing", otherAsk: "What is your business?", otherHint: "2 to 60 letters", };
const GROUPS: TypeGroup[] = [
  { key: "leads", label: "Lead Desk", options: [{ id: "salon", name: "Salon", tagline: "" }] },
  { key: "other", label: "Other", options: [{ id: "other", name: "Other", tagline: "" }] },
];
const OWNER = { groups: GROUPS, typeWords: TYPE_WORDS, otherId: "other", type: "salon", typeLabel: "", phone: "+91 98765 43210" };

describe("Settings > Business form, the Owner's part", () => {
  it("shows the kind of business (with the note), the phone, and the API's list of where the name shows", () => {
    render(<BusinessForm action={vi.fn()} words={WORDS} name="Glow" town="Guntur" languages={["en"]} choices={CALL_LANGS} owner={OWNER} usedIn={["menu_header", "call_opening", "whatsapp_opening", "voice_preview"]} />);
    expect(screen.getByRole("combobox")).toHaveAttribute("placeholder", "Salon");
    expect((document.querySelector('input[name="type"]') as HTMLInputElement).value).toBe("salon");
    expect(screen.getByText(/Changing the kind of business changes/)).toBeInTheDocument();
    expect(screen.getByLabelText("Business phone")).toHaveValue("+91 98765 43210");
    const used = document.querySelector('[data-part="name-used"]') as HTMLElement;
    expect(within(used).getAllByRole("listitem")).toHaveLength(3); // the menu, messages and calls (once), the voice preview
    expect(within(used).getByText("The voice preview you hear in Settings")).toBeInTheDocument();
  });
  it("an Admin sees neither the kind nor the phone", () => {
    render(<BusinessForm action={vi.fn()} words={WORDS} name="Glow" town="" languages={["en"]} choices={CALL_LANGS} />);
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.queryByLabelText("Business phone")).toBeNull();
  });
  it('"Other" already saved shows what it is in the text field', () => {
    render(<BusinessForm action={vi.fn()} words={WORDS} name="Paws" town="" languages={["en"]} choices={CALL_LANGS} owner={{ ...OWNER, type: "other", typeLabel: "Pet grooming" }} />);
    expect(screen.getByLabelText("What is your business?")).toHaveValue("Pet grooming");
  });
});

describe("Settings > Business logo", () => {
  const LOGO_WORDS = Object.fromEntries(Object.keys(appDict("en")).filter((k) => k.startsWith("settings.biz.logo.")).map((k) => [k, en(k as "frame.notyet")]));
  it("shows the first letter with no logo, the picture and a remove button with one", () => {
    const { rerender } = render(<BusinessLogo action={vi.fn()} words={LOGO_WORDS} logoUrl={null} initial="G" />);
    expect(screen.getByText("G")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Remove logo" })).toBeNull();
    expect(screen.getByLabelText("Choose a picture")).toHaveAttribute("accept", "image/jpeg,image/png,image/webp");
    rerender(<BusinessLogo action={vi.fn()} words={LOGO_WORDS} logoUrl="https://img.example/logo.jpg" initial="G" />);
    expect(document.querySelector("img")).toHaveAttribute("src", "https://img.example/logo.jpg");
    expect(screen.getByRole("button", { name: "Remove logo" })).toBeInTheDocument();
  });
});
