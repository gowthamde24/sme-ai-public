import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { LeadResult } from "@/lib/site/lead";

import { ContactForm, type ContactWords } from "./ContactForm";
import { PaverCalculator, type CalcWords } from "./PaverCalculator";

const config = {
  default_wastage_bps: 500,
  truck_capacity_pieces: 2500,
  products: [
    { id: "p1", pieces_per_area_x1000: 4500, pieces_per_pallet: 500 },
    { id: "p2", pieces_per_area_x1000: 2250, pieces_per_pallet: 250 },
  ],
};
const names = { p1: "Paver one", p2: "Paver two" };
const words: CalcWords = {
  area: "Area", unit: "Unit", unitSqFt: "sq ft", unitSqM: "sq m", product: "Paver", wastage: "Wastage", price: "Price per {unit}", priceHelp: "Optional", result: "You need", pieces: "blocks", pallets: "Pallets", trips: "Truck trips", withWastage: "with wastage",
  material: "Material before GST", delivered: "Covers", bad: "Enter an area from 1 to 100,000", cta: "Get exact quote on WhatsApp", ctaHelp: "We reply on WhatsApp", leadName: "Your name", leadCity: "City", leadConsent: "I agree to be contacted on WhatsApp.", privacy: "Privacy",
  errConsent: "Please tick to agree", errName: "Please add your name", errRate: "Too many tries", errGeneric: "Something went wrong", unavailable: "Chat is not set up yet",
};
const contactWords: ContactWords = { name: "Name", type: "Business", other: "Something else", what: "Question", consent: "I agree to be contacted.", privacy: "Privacy", submit: "Continue on WhatsApp", nosave: "Nothing is saved here", errConsent: "tick", errName: "name", errRate: "rate", errGeneric: "generic", errCheck: "check", unavailable: "Chat is not set up yet" };

const assign = vi.fn();
beforeEach(() => {
  assign.mockClear();
  Object.defineProperty(window, "location", { value: { ...window.location, assign }, writable: true });
});
afterEach(cleanup);

const calc = (action: (i: unknown) => Promise<LeadResult>, chatAvailable = true) => render(<PaverCalculator lang="en" config={config} names={names} words={words} action={action} privacyHref="/privacy" chatAvailable={chatAvailable} />);

describe("PaverCalculator", () => {
  it("works out blocks, pallets and trips for the first paver as it opens (1,000 sq ft, 5% wastage: 4,725 blocks)", () => {
    calc(vi.fn());
    const result = screen.getByRole("status");
    expect(result.textContent).toContain("4,725");
    expect(result.textContent).toMatch(/Pallets\s*10/);
    expect(result.textContent).toMatch(/Truck trips\s*2/);
  });
  it("recomputes when the visitor changes the area, the paver or the unit, and shows a material amount only when a price is given", () => {
    calc(vi.fn());
    fireEvent.change(screen.getByLabelText("Area"), { target: { value: "2000" } });
    expect(screen.getByRole("status").textContent).toContain("9,450");
    fireEvent.change(screen.getByLabelText("Paver"), { target: { value: "p2" } });
    expect(screen.getByRole("status").textContent).toContain("4,725");
    expect(screen.getByRole("status").textContent).not.toContain("Material");
    fireEvent.change(screen.getByLabelText(/Price per/), { target: { value: "65" } });
    expect(screen.getByRole("status").textContent).toContain("Material before GST");
    fireEvent.change(screen.getByLabelText("Unit"), { target: { value: "sq_m" } });
    expect(screen.getByLabelText("Price per sq m")).toBeTruthy();
  });
  it("says the area is not usable instead of a number (empty, zero, too big, words)", () => {
    calc(vi.fn());
    for (const bad of ["", "0", "100001", "abc"]) {
      fireEvent.change(screen.getByLabelText("Area"), { target: { value: bad } });
      expect(screen.getByRole("status").textContent, bad).toContain("Enter an area");
    }
  });
  it("sends the inputs and the consent to the server, never a result, and opens the WhatsApp address it gets back", async () => {
    const action = vi.fn().mockResolvedValue({ ok: true, url: "https://wa.me/919876543210?text=hi" });
    calc(action);
    fireEvent.change(screen.getByLabelText("Your name"), { target: { value: "Ravi" } });
    fireEvent.change(screen.getByLabelText("City"), { target: { value: "Guntur" } });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: /Get exact quote/ }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith("https://wa.me/919876543210?text=hi"));
    expect(action).toHaveBeenCalledWith({ lang: "en", productId: "p1", area: 1000, unit: "sq_ft", name: "Ravi", city: "Guntur", consent: true });
  });
  it.each([
    ["consent", "Please tick to agree"],
    ["name", "Please add your name"],
    ["rate", "Too many tries"],
    ["unavailable", "Chat is not set up yet"],
    ["invalid", "Something went wrong"],
  ] as const)("shows the server's refusal '%s' in words and opens nothing", async (error, text) => {
    calc(vi.fn().mockResolvedValue({ ok: false, error }));
    fireEvent.click(screen.getByRole("button", { name: /Get exact quote/ }));
    expect((await screen.findByRole("alert")).textContent).toBe(text);
    expect(assign).not.toHaveBeenCalled();
  });
  it("says something went wrong when the call itself fails", async () => {
    calc(vi.fn().mockRejectedValue(new Error("network")));
    fireEvent.click(screen.getByRole("button", { name: /Get exact quote/ }));
    expect((await screen.findByRole("alert")).textContent).toBe("Something went wrong");
  });
  it("shows the result but no chat form when our number is not set up", () => {
    calc(vi.fn(), false);
    expect(screen.queryByRole("button", { name: /Get exact quote/ })).toBeNull();
    expect(screen.getByText("Chat is not set up yet")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain("4,725");
  });
});

describe("ContactForm", () => {
  const form = (action: (i: unknown) => Promise<LeadResult>, chatAvailable = true) => render(<ContactForm lang="te" types={[{ slug: "textiles", name: "Sarees" }]} words={contactWords} action={action} privacyHref="/privacy" chatAvailable={chatAvailable} />);
  it("sends the language, the name, the type, the question and the consent, and opens the address it gets back", async () => {
    const action = vi.fn().mockResolvedValue({ ok: true, url: "https://wa.me/919876543210?text=x" });
    form(action);
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Asha" } });
    fireEvent.change(screen.getByLabelText("Business"), { target: { value: "textiles" } });
    fireEvent.change(screen.getByLabelText("Question"), { target: { value: "Demo?" } });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: /Continue on WhatsApp/ }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith("https://wa.me/919876543210?text=x"));
    expect(action).toHaveBeenCalledWith({ lang: "te", name: "Asha", type: "textiles", question: "Demo?", consent: true, turnstileToken: null });
  });
  it("starts unticked (consent is never pre-ticked) and shows a refusal in words", async () => {
    form(vi.fn().mockResolvedValue({ ok: false, error: "consent" }));
    expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: /Continue on WhatsApp/ }));
    expect((await screen.findByRole("alert")).textContent).toBe("tick");
    expect(assign).not.toHaveBeenCalled();
  });
  it("holds no form at all when our number is not set up", () => {
    form(vi.fn(), false);
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText("Chat is not set up yet")).toBeTruthy();
  });
});
