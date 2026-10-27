import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { appDict } from "@/i18n/app";
import type { LiveSource, SourceWithSecret } from "@/lib/lead-desk/sources/types";

import { LeadSources, type LeadSourcesActions } from "./LeadSources";

const words = Object.fromEntries(Object.entries(appDict("en") as Record<string, string>).filter(([k]) => k.startsWith("lsrc.") || k.startsWith("li.")));
const ID = "11111111-1111-4111-8111-111111111111";
const src = (over: Partial<LiveSource> = {}): LiveSource => ({ id: ID, kind: "website_form", tag: "website_form", label: "Website form", status: "active", created_at: "2026-10-26T04:30:00Z", last_received_at: "2026-10-26T05:00:00Z", received_count: 12, token_hint: "a1b2", cost_per_lead_paise: 1500, consent_confirmed: false, available: true, ...over });
const withSecret = (s: LiveSource, secret: SourceWithSecret["secret"]): SourceWithSecret => ({ ...s, secret });
const SECRET = { shown_once: true as const, url: "https://api.example.test/v1/lead-intake/SECRETTOKEN", email_address: null, snippet_html: '<form method="post" action="https://api.example.test/v1/lead-intake/SECRETTOKEN"></form>', meta_callback_url: null, meta_verify_token: null };
const actions = (over: Partial<LeadSourcesActions> = {}) => ({
  create: vi.fn(async () => ({ ok: true as const, data: withSecret(src(), SECRET) })),
  rotate: vi.fn(async () => ({ ok: true as const, data: withSecret(src({ token_hint: "zz99" }), { ...SECRET, url: "https://api.example.test/v1/lead-intake/NEWTOKEN" }) })),
  status: vi.fn(async () => ({ ok: true as const, data: src({ status: "paused" }) })),
  pull: vi.fn(async () => ({ ok: true as const, data: { fetched: 5, created: 3, merged: 1, invalid: 0, existing: 1, window_start: "2026-10-25T10:00:00Z", window_end: "2026-10-26T10:00:00Z" } })),
  discard: vi.fn(async () => ({ ok: true as const, data: null })),
  ...over,
});
const draw = (a: LeadSourcesActions, sources: LiveSource[] = [], unparsed: { id: string; source_id: string; received_at: string; subject: string | null; preview: string }[] = []) =>
  render(<LeadSources words={words} base="/app/tenants/T" test={false} sources={sources} unparsed={unparsed} actions={a} />);

const writeText = vi.fn(async () => undefined);
beforeEach(() => {
  vi.stubGlobal("crypto", { randomUUID: () => ID });
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  writeText.mockClear();
});

describe("the lead sources page (night 4, item 4)", () => {
  it("has a card for each place leads come from", () => {
    draw(actions());
    for (const title of ["Meta Lead Ads (Facebook and Instagram)", "IndiaMART", "JustDial and other portals", "Your website form", "Google Sheets", "Zapier, n8n or Make"]) expect(screen.getByRole("heading", { name: title })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Set up a sheet in Add leads" })).toHaveAttribute("href", "/app/tenants/T/import");
  });

  it("shows status, last lead, how many came, cost per lead and the end of the address", () => {
    draw(actions(), [src()]);
    const card = screen.getByRole("region", { hidden: false, name: "Your website form" });
    expect(within(card).getByText("Website form")).toBeInTheDocument();
    expect(within(card).getByText("Active")).toBeInTheDocument();
    expect(within(card).getByText("Last lead: 2026-10-26 10:30")).toBeInTheDocument();
    expect(within(card).getByText(/12 received · Cost per lead: ₹15/)).toBeInTheDocument();
    expect(within(card).getByText("Its address ends in a1b2")).toBeInTheDocument();
  });

  it("a source that is not switched on says so", () => {
    draw(actions(), [src({ id: "11111111-1111-4111-8111-111111111119", kind: "meta_lead_ads", tag: "meta_lead_ads", label: "Meta", available: false, last_received_at: null, received_count: 0 })]);
    expect(screen.getByText("Not switched on yet")).toBeInTheDocument();
    expect(screen.getByText(/it receives nothing until our team turns it on/)).toBeInTheDocument();
    expect(screen.getByText("No lead yet")).toBeInTheDocument();
  });

  it("making a source shows its secret ONCE with a copy button, and 'I have copied it' removes it", async () => {
    const a = actions();
    draw(a);
    const card = screen.getByRole("region", { name: "Your website form" });
    fireEvent.click(within(card).getByRole("button", { name: "Set it up" }));
    fireEvent.change(within(card).getByLabelText("A name for this source"), { target: { value: "Landing page" } });
    await act(async () => fireEvent.click(within(card).getByRole("button", { name: "Add this source" })));
    expect(a.create).toHaveBeenCalledWith({ source_id: ID, kind: "website_form", label: "Landing page", portal: null, consent: null, cost_per_lead_paise: null });
    const secret = screen.getByRole("region", { name: "Copy it now: it is not shown again" });
    expect(within(secret).getByLabelText("Address")).toHaveValue("https://api.example.test/v1/lead-intake/SECRETTOKEN");
    expect(within(secret).getByLabelText("Form to paste into your page")).toHaveAttribute("readonly");
    await act(async () => fireEvent.click(within(secret).getAllByRole("button", { name: "Copy" })[0]));
    expect(writeText).toHaveBeenCalledWith("https://api.example.test/v1/lead-intake/SECRETTOKEN");
    expect(within(secret).getByRole("button", { name: "Copied" })).toBeInTheDocument();
    fireEvent.click(within(secret).getByRole("button", { name: "I have copied it" }));
    expect(screen.queryByText(/SECRETTOKEN/)).toBeNull();
    expect(document.body.innerHTML).not.toContain("SECRETTOKEN");
    expect(JSON.stringify(Object.entries(localStorage))).not.toContain("SECRETTOKEN");
  });

  it("a forwarding address asks which portal, and shows the e-mail address with a copy button", async () => {
    const a = actions({ create: vi.fn(async () => ({ ok: true as const, data: withSecret(src({ kind: "email_forward", tag: "justdial", label: "JustDial" }), { ...SECRET, url: "https://api.example.test/x", snippet_html: null, email_address: "leads+TOK@inbound.example.test" }) })) });
    draw(a);
    const card = screen.getByRole("region", { name: "JustDial and other portals" });
    fireEvent.click(within(card).getByRole("button", { name: "Set it up" }));
    expect(within(card).getAllByRole("option").map((o) => o.textContent)).toEqual(["IndiaMART (IndiaMART)".replace(" (IndiaMART)", ""), "JustDial", "99acres", "MagicBricks", "Housing.com", "Any other (the same address works for all)"]);
    fireEvent.change(within(card).getByLabelText("Which portal?"), { target: { value: "99acres" } });
    await act(async () => fireEvent.click(within(card).getByRole("button", { name: "Add this source" })));
    expect(a.create).toHaveBeenCalledWith(expect.objectContaining({ kind: "email_forward", portal: "99acres" }));
    expect(screen.getByLabelText("E-mail address to forward to")).toHaveValue("leads+TOK@inbound.example.test");
  });

  it("the consent confirmation can be given when a source is made (the four facts), and is incomplete until all four are there", async () => {
    const a = actions();
    draw(a);
    const card = screen.getByRole("region", { name: "Zapier, n8n or Make" });
    fireEvent.click(within(card).getByRole("button", { name: "Set it up" }));
    fireEvent.click(within(card).getByLabelText("I confirm these people may be contacted for the reason below."));
    expect(within(card).getByRole("button", { name: "Add this source" })).toBeDisabled();
    fireEvent.change(within(card).getByLabelText("Name of this list"), { target: { value: "Leads" } });
    fireEvent.change(within(card).getByLabelText("What you will contact them about"), { target: { value: "Flats" } });
    fireEvent.change(within(card).getByLabelText("How you got these numbers"), { target: { value: "Zapier" } });
    fireEvent.change(within(card).getByLabelText("Cost per lead in rupees (optional)"), { target: { value: "40" } });
    await act(async () => fireEvent.click(within(card).getByRole("button", { name: "Add this source" })));
    expect(a.create).toHaveBeenCalledWith(expect.objectContaining({ kind: "webhook", cost_per_lead_paise: 4000, consent: { confirmed: true, list_name: "Leads", purpose: "Flats", basis: "explicit_consent", how_collected: "Zapier" } }));
  });

  it("a new address asks first, then the old one is replaced and the new secret is shown once", async () => {
    const a = actions();
    draw(a, [src()]);
    fireEvent.click(screen.getByRole("button", { name: "Make a new address" }));
    expect(screen.getByRole("alertdialog")).toHaveTextContent("The old one stops working at once.");
    fireEvent.click(screen.getByRole("button", { name: "No, keep it" }));
    expect(a.rotate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Make a new address" }));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Yes, make a new one" })));
    expect(a.rotate).toHaveBeenCalledWith(ID);
    expect(screen.getByLabelText("Address")).toHaveValue("https://api.example.test/v1/lead-intake/NEWTOKEN");
    expect(screen.getByText("Its address ends in zz99")).toBeInTheDocument();
  });

  it("pause and resume", async () => {
    const a = actions();
    draw(a, [src()]);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Pause" })));
    expect(a.status).toHaveBeenCalledWith(ID, "pause");
    expect(screen.getByText("Paused")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Resume" })).toBeInTheDocument();
  });

  it("IndiaMART can be pulled now, and a refusal is said in words", async () => {
    const mart = src({ kind: "indiamart", tag: "indiamart", label: "IndiaMART", token_hint: null });
    const a = actions();
    draw(a, [mart]);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Pull now" })));
    expect(screen.getByRole("status")).toHaveTextContent("Fetched 5: 3 new, 1 merged, 0 invalid, 1 already had.");
    cleanup();
    draw(actions({ pull: vi.fn(async () => ({ ok: false as const, error: "connector_not_available" as const })) }), [mart]);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Pull now" })));
    expect(screen.getByRole("alert")).toHaveTextContent("This is not switched on yet. Ask our team to turn it on.");
  });

  it("the mails nobody could read can be discarded", async () => {
    const a = actions();
    draw(a, [], [{ id: ID, source_id: ID, received_at: "2026-10-26T05:00:00Z", subject: "Fwd: enquiry", preview: "Hello, price please" }]);
    expect(screen.getByText("Fwd: enquiry")).toBeInTheDocument();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Discard" })));
    expect(a.discard).toHaveBeenCalledWith(ID);
    expect(screen.getByText("No unread mails.")).toBeInTheDocument();
  });
});
