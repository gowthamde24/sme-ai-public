import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LANGS } from "@/i18n/lang";
import { siteT } from "@/i18n/site";
import { SITE_PACKS, textIn } from "@/lib/site/packs";
import { WAITLIST_LANGS, WAITLIST_LANG_NAMES } from "@/lib/waitlist/types";

import { WaitlistForm } from "./WaitlistForm";
import { waitlistWords } from "./WaitlistSection";

afterEach(cleanup);
const draw = (lang: (typeof LANGS)[number], action = vi.fn(async () => ({ ok: true }) as const)) => {
  const t = siteT(lang);
  render(<WaitlistForm lang={lang} types={SITE_PACKS.map((p) => ({ slug: p.slug, name: textIn(p.names, lang) })).concat([{ slug: "other", name: t("contact.type.other") }])} langs={WAITLIST_LANGS.map((code) => ({ code, name: WAITLIST_LANG_NAMES[code] }))} words={waitlistWords(t)} action={action} privacyHref="/privacy" />);
  return { t, action };
};
const fill = (t: ReturnType<typeof siteT>) => {
  fireEvent.change(screen.getByLabelText(t("contact.name")), { target: { value: "Lakshmi" } });
  fireEvent.change(screen.getByLabelText(t("demo.city")), { target: { value: "Guntur" } });
  fireEvent.change(screen.getByLabelText(t("demo.contact")), { target: { value: "9876543210" } });
};

describe("Book a demo / join the waitlist (job DQ)", () => {
  it("has the fields the API needs, and the marketing box is NOT ticked", () => {
    const { t } = draw("en");
    for (const k of ["contact.name", "contact.type", "demo.city", "demo.contact", "demo.lang"] as const) expect(screen.getByLabelText(t(k))).toBeInTheDocument();
    const box = screen.getByRole("checkbox");
    expect(box).not.toBeChecked();
    expect(screen.getByText(t("demo.marketing"))).toBeInTheDocument();
    expect(screen.getByRole("link", { name: t("contact.privacy") })).toHaveAttribute("href", "/privacy");
    expect(screen.getAllByRole("checkbox")).toHaveLength(1); // the consent for the service is the notice line, not a box: the one box is the optional marketing one
  });

  it("offers the three business types and 'something else', and six languages in their own script", () => {
    draw("en");
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual(expect.arrayContaining(["Something else", "English", "తెలుగు", "हिन्दी", "ಕನ್ನಡ", "தமிழ்", "മലയാളം"]));
    expect(screen.getAllByRole("option")).toHaveLength(SITE_PACKS.length + 1 + 6);
  });

  it("sends marketing as false when the box is left alone, and true only when the visitor ticks it", async () => {
    const { t, action } = draw("en");
    fill(t);
    fireEvent.click(screen.getByRole("button", { name: t("demo.submit") }));
    await waitFor(() => expect(action).toHaveBeenCalledTimes(1));
    expect(action).toHaveBeenLastCalledWith({ name: "Lakshmi", businessType: SITE_PACKS[0].slug, city: "Guntur", contact: "9876543210", language: "en", marketingOptIn: false, website: "", turnstileToken: null });
    cleanup();
    const second = draw("en");
    fill(second.t);
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: second.t("demo.submit") }));
    await waitFor(() => expect(second.action).toHaveBeenCalledTimes(1));
    expect(second.action).toHaveBeenLastCalledWith(expect.objectContaining({ marketingOptIn: true }));
  });

  it("the page's language is the language preselected", async () => {
    const { t, action } = draw("kn");
    fill(t);
    fireEvent.click(screen.getByRole("button", { name: t("demo.submit") }));
    await waitFor(() => expect(action).toHaveBeenCalled());
    expect(action).toHaveBeenLastCalledWith(expect.objectContaining({ language: "kn" }));
  });

  it.each(LANGS)("%s: after a good answer the form is replaced by the thank-you in that language", async (lang) => {
    const { t } = draw(lang);
    fill(t);
    fireEvent.click(screen.getByRole("button", { name: t("demo.submit") }));
    expect(await screen.findByText(t("demo.thanks.t"))).toBeInTheDocument();
    expect(screen.getByText(t("demo.thanks.d"))).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: t("demo.submit") })).toBeNull();
  });

  it.each([
    ["name", "contact.err.name"],
    ["contact", "demo.err.contact"],
    ["rate", "contact.err.rate"],
    ["down", "demo.err.down"],
  ] as const)("a refusal '%s' is said in the page's language and the form stays", async (error, key) => {
    const { t } = draw("hi", vi.fn(async () => ({ ok: false, error }) as never));
    fill(t);
    fireEvent.click(screen.getByRole("button", { name: t("demo.submit") }));
    expect(await screen.findByRole("alert")).toHaveTextContent(t(key));
    await waitFor(() => expect(screen.getByRole("button", { name: t("demo.submit") })).toBeEnabled());
  });

  it("a script that fills the hidden field is passed on so the server can drop it; a person never sees the field", () => {
    draw("en");
    const trap = document.querySelector('input[name="website"]') as HTMLInputElement;
    expect(trap.closest("[aria-hidden='true']")).not.toBeNull();
    expect(trap).toHaveAttribute("tabindex", "-1");
  });
});
