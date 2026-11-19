import * as React from "react";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

import { appDict } from "@/i18n/app";
import { assistantProfile } from "@/lib/assistant/defaults";
import { withModuleWords } from "@/lib/packs/module-words";

import { AssistantSettings } from "./AssistantSettings";

const raw = (modules: string[] | null) => withModuleWords(Object.fromEntries(Object.entries(appDict("en") as Record<string, string>).filter(([k]) => k.startsWith("asst.") || k.startsWith("jobs.set.b.") || k === "bv.speaking.in")), modules ? { modules } : null);
const langs = { te: "తెలుగు", hi: "हिन्दी", kn: "ಕನ್ನಡ", en: "English", ta: "தமிழ்", ml: "മലയാളം", mr: "मराठी (draft)" };
type Save = (i: unknown) => Promise<{ ok: true } | { ok: false; error: string }>;
const draw = (over: { simple?: boolean; modules?: string[] | null; canEdit?: boolean; saved?: boolean; name?: string; save?: Save } = {}) => {
  const modules = over.modules === undefined ? null : over.modules;
  const profile = assistantProfile(modules);
  const save = (over.save ?? vi.fn(async () => ({ ok: true as const }))) as ReturnType<typeof vi.fn> & Save;
  render(<AssistantSettings words={raw(modules)} initial={{ ...profile.defaults, name: over.name ?? "Priya" }} profile={profile} shop="Acme Silks" langs={langs} canEdit={over.canEdit ?? true} testMode saved={over.saved ?? true} actions={{ save }} simple={over.simple ?? true} />);
  return { save, profile };
};
afterEach(() => {
  cleanup();
  refresh.mockClear();
  window.history.replaceState(null, "", window.location.pathname);
});
const press = async (name: RegExp | string) => act(async () => fireEvent.click(screen.getByRole("button", { name })));

describe("Settings > Your assistant under JOBS: sentences with the choice inside", () => {
  it("Basics: the name and the language are two sentences, one tick, the effect line follows, the rare tick is under More choices", () => {
    draw();
    const card = document.querySelector('[data-part="asst-simple-basics"]') as HTMLElement;
    expect(card).toHaveTextContent("Your assistant is called");
    expect(screen.getByLabelText("Assistant name")).toHaveValue("Priya");
    expect(screen.getByRole("combobox", { name: "It starts every call in …." })).toHaveValue("te");
    expect(within(card).getByText("What it will do:").parentElement).toHaveTextContent("Customers hear “Priya, the AI assistant of Acme Silks” and the call starts in తెలుగు. If a customer answers in another language, it switches to theirs.");
    // one tick in view (switch language), the other under More choices
    const more = card.querySelector('[data-part="more-choices"]') as HTMLElement;
    expect(more).not.toHaveAttribute("open");
    expect(within(more).getByRole("checkbox", { name: /Allow mixing English words/ })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Switch to the customer's language automatically" })).toBeChecked();
    // no square tick list, no switch buttons in the form
    expect(document.querySelectorAll('[data-part="basics-form"] [role="switch"]')).toHaveLength(0);
    fireEvent.click(screen.getByRole("checkbox", { name: "Switch to the customer's language automatically" }));
    expect(card).not.toHaveTextContent("it switches to theirs");
  });
  it("Basics: a change saves with the SAME payload as the old form (the whole settings, only the Basics fields changed)", async () => {
    const { save, profile } = draw();
    fireEvent.change(screen.getByLabelText("Assistant name"), { target: { value: "Ravi" } });
    fireEvent.change(screen.getByRole("combobox", { name: "It starts every call in …." }), { target: { value: "en" } });
    fireEvent.click(screen.getByRole("checkbox", { name: /Allow mixing English words/ }));
    await press("Save");
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith({ ...profile.defaults, name: "Ravi", lang: "en", mixEnglish: false });
    expect(await screen.findByText("Saved.")).toBeInTheDocument();
    expect(refresh).toHaveBeenCalled();
  });
  it("Basics: an unnamed assistant says it is the AI assistant of the business; a bad name cannot be saved", async () => {
    const { save } = draw({ name: "your assistant" });
    expect(document.querySelector('[data-part="asst-simple-basics"]')).toHaveTextContent("Customers hear that it is the AI assistant of Acme Silks");
    fireEvent.change(screen.getByLabelText("Assistant name"), { target: { value: "Ravi!" } });
    expect(screen.getByRole("alert")).toHaveTextContent("Use letters and numbers, up to 24 characters.");
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    expect(save).not.toHaveBeenCalled();
  });
  it("Behaviour: at most four things in view (three ticks and the discount), dues, the order limit and the hours under More choices, each effect line follows", async () => {
    const { save, profile } = draw();
    fireEvent.click(screen.getByRole("tab", { name: "Behaviour" }));
    const may = document.querySelector('[data-part="asst-simple-may"]') as HTMLElement;
    const visible = [...may.querySelectorAll("input")].filter((i) => !i.closest("details"));
    expect(visible).toHaveLength(4); // prices, visits, whatsapp, the discount
    expect(within(may).getByText("What it will do:").parentElement).toHaveTextContent("It can answer price questions, book visits, send photos, samples and quotes on WhatsApp when asked. It will not offer a discount.");
    fireEvent.change(screen.getByRole("spinbutton", { name: "It may offer a discount of up to … %." }), { target: { value: "12" } });
    expect(may).toHaveTextContent("It will not offer more than 12% off; a bigger discount waits for you.");
    fireEvent.click(within(may).getByRole("checkbox", { name: "Book shop visits" }));
    expect(may).not.toHaveTextContent("book visits");
    const hand = document.querySelector('[data-part="asst-simple-hand"]') as HTMLElement;
    expect(hand).toHaveTextContent("It passes the call to your phone if the customer asks for you. It passes the call to your phone if the customer sounds upset.");
    fireEvent.click(within(hand).getByRole("checkbox", { name: "Customer sounds upset" }));
    fireEvent.change(screen.getByRole("spinbutton", { name: "Pass an order to you when it is above ₹ …." }), { target: { value: "5000" } });
    expect(hand).toHaveTextContent("if an order is above ₹5000");
    fireEvent.change(screen.getByRole("combobox", { name: "It takes calls from … to …. (1)" }), { target: { value: "10:00" } });
    fireEvent.click(screen.getByRole("button", { name: "Sat" }));
    await press("Save");
    expect(save).toHaveBeenCalledWith({
      ...profile.defaults,
      name: "Priya",
      may: { ...profile.defaults.may, visits: false },
      maxDiscount: 12,
      handover: { owner: true, upset: false, orderAbove: 5000 },
      hours: { from: "10:00", to: "19:00", days: ["mon", "tue", "wed", "thu", "fri"] },
    });
  });
  it("Behaviour: the hours keep their rule (the end after the start, a day on) and the save stays off", () => {
    draw();
    fireEvent.click(screen.getByRole("tab", { name: "Behaviour" }));
    fireEvent.change(screen.getByRole("combobox", { name: "It takes calls from … to …. (2)" }), { target: { value: "09:00" } });
    expect(screen.getAllByRole("alert").some((a) => /The end must be after the start/.test(a.textContent ?? ""))).toBe(true);
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });
  it("only the Owner can change it: every choice is off for anyone else", () => {
    draw({ canEdit: false });
    expect(screen.getByLabelText("Assistant name")).toBeDisabled();
    expect(screen.getByRole("combobox", { name: "It starts every call in …." })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    expect(screen.getByText("Only the Owner can change the assistant.")).toBeInTheDocument();
  });
  it("a refusal for the two-step code says so and keeps what was typed", async () => {
    const { save } = draw({ save: vi.fn(async () => ({ ok: false as const, error: "mfa" })) });
    fireEvent.change(screen.getByLabelText("Assistant name"), { target: { value: "Ravi" } });
    await press("Save");
    expect(save).toHaveBeenCalled();
    expect(await screen.findByRole("alert")).toHaveTextContent("This needs your two-step code first.");
    expect(screen.getByLabelText("Assistant name")).toHaveValue("Ravi");
  });
  it("a school's assistant has no discount and no order limit, and says 'fee questions'", () => {
    draw({ modules: ["programmes"] });
    fireEvent.click(screen.getByRole("tab", { name: "Behaviour" }));
    expect(screen.queryByRole("spinbutton", { name: /discount/ })).toBeNull();
    expect(screen.queryByRole("spinbutton", { name: /order/ })).toBeNull();
    expect(document.querySelector('[data-part="asst-simple-may"]')).toHaveTextContent("answer fee questions");
  });
  it("JOBS off draws the old form: no sentences, the switches and the number box of before", () => {
    draw({ simple: false });
    expect(document.querySelector("[data-simple]")).toBeNull();
    expect(screen.queryByText("What it will do:")).toBeNull();
    expect(screen.getAllByRole("switch").length).toBeGreaterThan(0);
    expect(document.querySelector("#asst-name")).toHaveClass("min-h-12");
  });
});
