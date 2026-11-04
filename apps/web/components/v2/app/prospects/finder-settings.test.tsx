import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { appDict } from "@/i18n/app";
import type { FinderSettings } from "@/lib/lead-finder/types";
import type { Reply } from "../cc/kit";

import { FinderSettingsForm } from "./FinderSettingsForm";

const words = Object.fromEntries(Object.entries(appDict("en") as Record<string, string>).filter(([k]) => /^(lf|apierr)\./.test(k)));
const STORED: FinderSettings = { fitBar: 70, dailyCallCap: 20, callFromHour: 10, callToHour: 19, searchesPerDay: 5, resultsPerSearch: 20, updatedAt: null };
type Save = (c: Partial<Record<string, number>>) => Promise<Reply<FinderSettings>>;
const form = (save = vi.fn<Save>(async (c) => ({ ok: true, data: { ...STORED, ...c } }))) => {
  render(<FinderSettingsForm words={words} initial={STORED} save={save} />);
  return save;
};
const set = (name: string, value: string) => fireEvent.change(screen.getByRole("spinbutton", { name }), { target: { value } });
const press = () => fireEvent.click(screen.getByRole("button", { name: "Save" }));

describe("Settings > Lead Finder: the form", () => {
  it("sends only what changed and says it is saved", async () => {
    const save = form();
    set("Fit bar (50 to 100)", "75");
    set("Call until (hour, 10 to 21)", "18");
    press();
    expect(save).toHaveBeenCalledWith({ fitBar: 75, callToHour: 18 });
    expect(await screen.findByText("Saved.")).toBeInTheDocument();
  });
  it("nothing changed: nothing is sent", () => {
    const save = form();
    press();
    expect(screen.getByText("Nothing changed.")).toBeInTheDocument();
    expect(save).not.toHaveBeenCalled();
  });
  it.each([
    ["Fit bar (50 to 100)", "40", "Use a whole number from 50 to 100."],
    ["Calls a day (0 to 500)", "900", "Use a whole number from 0 to 500."],
    ["Searches a day (1 to 20)", "0", "Use a whole number from 1 to 20."],
    ["Results per search (1 to 20)", "2.5", "Use a whole number from 1 to 20."],
    ["Call from (hour, 9 to 20)", "8", "Use a whole number from 9 to 20."],
  ])("%s = %s is refused next to the field, before anything is sent", (name, value, text) => {
    const save = form();
    set(name, value);
    press();
    expect(screen.getByRole("alert")).toHaveTextContent(text);
    expect(screen.getByRole("spinbutton", { name })).toHaveAttribute("aria-invalid", "true");
    expect(save).not.toHaveBeenCalled();
  });
  it("calling must start before it ends", () => {
    const save = form();
    set("Call from (hour, 9 to 20)", "19");
    press();
    expect(screen.getByRole("alert")).toHaveTextContent("Calling must start before it ends.");
    expect(save).not.toHaveBeenCalled();
  });
  it("a refusal from the API is said in words and what was typed stays", async () => {
    form(vi.fn<Save>(async () => ({ ok: false, kind: "forbidden", error: "Your role cannot do this here." })));
    set("Fit bar (50 to 100)", "80");
    press();
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Your role cannot do this here."));
    expect(screen.getByRole("spinbutton", { name: "Fit bar (50 to 100)" })).toHaveValue(80);
  });
});
