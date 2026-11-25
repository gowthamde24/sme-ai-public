import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));

import { appDict } from "@/i18n/app";

import { BusinessTypeCard } from "./BusinessTypeCard";

afterEach(() => {
  cleanup();
  refresh.mockReset();
});
const WORDS = Object.fromEntries(Object.entries(appDict("en") as Record<string, string>).filter(([k]) => k.startsWith("bt.") || k.startsWith("start.type.")));
const choices = [
  { id: "textiles", name: "Textiles", line: "Sarees", keywords: "saree silk" },
  { id: "clinic", name: "Clinic", line: "Doctors", keywords: "dental hospital" },
  { id: "bakery", name: "Bakery", line: "Cakes", keywords: "bread cakes" },
];

describe("Settings > Business type (Owner only)", () => {
  it("shows the current type; Change opens the search box; picking only highlights and asks first, nothing is saved yet", async () => {
    const save = vi.fn(async () => ({ ok: true as const }));
    render(<BusinessTypeCard words={WORDS} current={{ id: "textiles", name: "Textiles" }} choices={choices} save={save} />);
    expect(document.querySelector('[data-part="bt-current"]')).toHaveTextContent("Textiles");
    fireEvent.click(screen.getByRole("button", { name: "Change business type" }));
    fireEvent.change(screen.getByRole("searchbox", { name: "Search your business" }), { target: { value: "dental" } });
    fireEvent.click(screen.getByRole("radio", { name: /Clinic/ }));
    expect(save).not.toHaveBeenCalled();
    expect(screen.getByText("Change to Clinic? Your existing things stay; the questions and fields for the new type are added.")).toBeInTheDocument();
    expect(screen.queryByRole("radio", { name: /Textiles/ })).toBeNull(); // the current type is not offered again
  });
  it("'Change to Clinic' saves through the existing action, says Saved and refreshes; 'Not now' saves nothing", async () => {
    const save = vi.fn(async () => ({ ok: true as const }));
    render(<BusinessTypeCard words={WORDS} current={{ id: "textiles", name: "Textiles" }} choices={choices} save={save} />);
    fireEvent.click(screen.getByRole("button", { name: "Change business type" }));
    fireEvent.click(screen.getByRole("radio", { name: /Bakery/ }));
    fireEvent.click(screen.getByRole("button", { name: "Not now" }));
    expect(save).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("radio", { name: /Clinic/ }));
    fireEvent.click(screen.getByRole("button", { name: "Change to Clinic" }));
    await waitFor(() => expect(save).toHaveBeenCalledWith("clinic"));
    expect(await screen.findByText("Saved: Clinic. The questions and fields for it are added.")).toBeInTheDocument();
    expect(document.querySelector('[data-part="bt-current"]')).toHaveTextContent("Clinic");
    expect(refresh).toHaveBeenCalled();
  });
  it("a refusal is said in words and the type stays as it was", async () => {
    const save = vi.fn(async () => ({ ok: false as const, error: "step_up" as const }));
    render(<BusinessTypeCard words={WORDS} current={{ id: "textiles", name: "Textiles" }} choices={choices} save={save} />);
    fireEvent.click(screen.getByRole("button", { name: "Change business type" }));
    fireEvent.click(screen.getByRole("radio", { name: /Clinic/ }));
    fireEvent.click(screen.getByRole("button", { name: "Change to Clinic" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Confirm with your two-step code first, then choose again.");
    expect(document.querySelector('[data-part="bt-current"]')).toHaveTextContent("Textiles");
  });
});
