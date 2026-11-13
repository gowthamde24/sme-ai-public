import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { SettingsV6Data } from "@/app/app/tenants/[tenantId]/settings/settings-v6-data";
import { appDict } from "@/i18n/app";

import { SettingsV6, type SettingsV6Props } from "./SettingsV6";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: () => undefined, replace: () => undefined }), usePathname: () => "/", useSearchParams: () => new URLSearchParams() }));
afterEach(() => {
  cleanup();
  refresh.mockClear();
});

const DATA: SettingsV6Data = {
  business: { name: "Lakshmi Sarees", city: "Hyderabad", phone: null, languages: ["te", "en"], logoUrl: null },
  gstin: "36AABCU9603R1ZX",
  team: [
    { name: "Lakshmi", role: "owner", you: true },
    { name: "Ravi", role: "admin", you: false },
    { name: null, role: "sales", you: false },
  ],
  whatsapp: { state: "connected", phone: "+91 90000 00000" },
  sources: { active: 2 },
  phone: { state: "not_set_up", number: null },
};
const props = (over: Partial<SettingsV6Props> = {}): SettingsV6Props => ({
  words: appDict("en") as Record<string, string>,
  lang: "en",
  base: "/app/tenants/t1",
  title: "Settings",
  help: <button type="button">?</button>,
  admin: true,
  data: DATA,
  tenantName: "Lakshmi Sarees",
  theme: "system",
  langLabel: "Language",
  notificationsHref: "/app/tenants/t1/settings?section=notifications",
  save: async () => ({ ok: true }),
  ...over,
});
const card = (part: string) => document.querySelector(`[data-part="${part}"]`) as HTMLElement;

describe("Settings (design system v6)", () => {
  it("shows the seven cards in the owner's order, under the page header with the '?'", () => {
    render(<SettingsV6 {...props()} />);
    expect(screen.getByRole("heading", { level: 1, name: "Settings" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "?" })).toBeInTheDocument();
    const order = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    expect(order).toEqual(["Business", "Team", "Connections", "Notifications", "Language and theme", "Privacy and data", "Developer API keys"]);
  });

  it("Business shows the real values, says 'Not set yet' for what has no reader, and sends each Edit to the screen that already does it", () => {
    render(<SettingsV6 {...props()} />);
    const biz = card("settings-business");
    expect(within(biz).getByText("Lakshmi Sarees")).toBeInTheDocument();
    expect(within(biz).getByText("Hyderabad")).toBeInTheDocument();
    expect(within(biz).getByText("36AABCU9603R1ZX")).toBeInTheDocument();
    const timings = within(biz).getByText("Shop timings").closest('[data-part="settings-row"]') as HTMLElement;
    expect(within(timings).getByText("Not set yet")).toBeInTheDocument();
    expect(within(timings).getByRole("link", { name: "Edit Shop timings" })).toHaveAttribute("href", "/app/tenants/t1/my-assistant?tab=knowledge");
    expect(within(biz).getByRole("link", { name: "Edit GST number" })).toHaveAttribute("href", "/app/tenants/t1/settings?section=business");
    const logo = within(biz).getByText("Logo").closest('[data-part="settings-row"]') as HTMLElement;
    expect(within(logo).getByText("Not set yet")).toBeInTheDocument();
  });

  it("Business Edit opens name and city in place with ONE Publish that sends the languages unchanged; success closes the form with a line", async () => {
    const save = vi.fn(async (_p: unknown, _f: FormData) => ({ ok: true }) as const);
    render(<SettingsV6 {...props({ save })} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit Business" }));
    fireEvent.change(screen.getByLabelText("Business name"), { target: { value: "Lakshmi Silks" } });
    fireEvent.click(screen.getByRole("button", { name: "Publish" }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    const fd = save.mock.calls[0][1];
    expect(fd.get("name")).toBe("Lakshmi Silks");
    expect(fd.get("town")).toBe("Hyderabad");
    expect(fd.getAll("languages")).toEqual(["te", "en"]);
    expect(await screen.findByRole("status")).toHaveTextContent("Published. Your new details show everywhere now.");
    expect(screen.queryByLabelText("Business name")).toBeNull();
  });

  it("a refusal shows Settings > Business's own sentence and keeps the form open; Cancel closes it", async () => {
    render(<SettingsV6 {...props({ save: async () => ({ ok: false, error: "role" }) })} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit Business" }));
    fireEvent.click(screen.getByRole("button", { name: "Publish" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Only the Owner or an Admin can change this.");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("a member who does not run the business cannot edit the Business card and does not see the connections or the developer card", () => {
    render(<SettingsV6 {...props({ admin: false })} />);
    expect(screen.queryByRole("button", { name: "Edit Business" })).toBeNull();
    expect(within(card("settings-connections")).getByText("Only the owner and admins see the connections.")).toBeInTheDocument();
    expect(card("settings-developer")).toBeNull();
    expect(screen.queryByRole("link", { name: /Edit GST/ })).toBeNull();
  });

  it("Team lists the people with their role words, an unnamed one gets a plain word, and the owner and admins are named as the quote rule-setters", () => {
    render(<SettingsV6 {...props()} />);
    const team = card("settings-team");
    expect(within(team).getByText("3 people")).toBeInTheDocument();
    expect(within(team).getByText("a team member")).toBeInTheDocument();
    expect(within(team).getByText("Owner and admins: Lakshmi, Ravi")).toBeInTheDocument();
    expect(within(team).getByRole("link", { name: "Edit Who can approve quotes" })).toHaveAttribute("href", "/app/tenants/t1/quote-policy");
    expect(within(team).getByRole("link", { name: "Edit Team" })).toHaveAttribute("href", "/app/tenants/t1/team");
  });

  it("Connections shows the WhatsApp number with its state, the live sources and the business number in the status colours; a business number not set says so", () => {
    render(<SettingsV6 {...props()} />);
    const con = card("settings-connections");
    expect(within(con).getByText("+91 90000 00000")).toBeInTheDocument();
    expect(con.querySelector('[data-status="completed"]')).toHaveTextContent("Connected");
    expect(within(con).getByText("2 connected")).toBeInTheDocument();
    expect(con.querySelector('[data-status="no_answer"]')).toHaveTextContent("Not set up yet");
    expect(within(con).getByRole("link", { name: "Edit WhatsApp number" })).toHaveAttribute("href", "/app/tenants/t1/integrations/whatsapp");
    expect(within(con).getByRole("link", { name: "Edit Lead sources" })).toHaveAttribute("href", "/app/tenants/t1/lead-sources");
    expect(within(con).getByRole("link", { name: "Edit Business number for calls" })).toHaveAttribute("href", "/app/tenants/t1/phone-number");
    expect(within(con).getByRole("link", { name: "Edit Calls put through to you" })).toHaveAttribute("href", "/app/tenants/t1/my-assistant?tab=rules");
  });

  it("a part that could not be read says 'Not set yet' instead of a made-up value", () => {
    render(<SettingsV6 {...props({ data: { business: null, gstin: undefined, team: null, whatsapp: null, sources: null, phone: null } })} />);
    expect(within(card("settings-business")).getByText("Lakshmi Sarees")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit Business" })).toBeNull();
    expect(within(card("settings-team")).getAllByText("Not set yet").length).toBeGreaterThan(0);
    expect(within(card("settings-connections")).getAllByText("Not set yet").length).toBe(5);
  });

  it("Notifications links to its screen where that is on, Language and theme has the real switches and names the languages the assistant speaks", () => {
    const { rerender } = render(<SettingsV6 {...props()} />);
    expect(within(card("settings-notifications")).getByRole("link", { name: "Edit Notifications" })).toHaveAttribute("href", "/app/tenants/t1/settings?section=notifications");
    rerender(<SettingsV6 {...props({ notificationsHref: null })} />);
    expect(within(card("settings-notifications")).queryByRole("link")).toBeNull();
    const lang = card("settings-language");
    expect(within(lang).getByRole("combobox", { name: "Language" })).toBeInTheDocument();
    expect(within(lang).getByRole("button", { name: "Dark" })).toBeInTheDocument();
    expect(lang).toHaveTextContent("Your assistant speaks: తెలుగు, English");
  });

  it("Privacy and data is a draft that only links to the existing Privacy screen: no delete or export button here", () => {
    render(<SettingsV6 {...props()} />);
    const priv = card("settings-privacy");
    expect(within(priv).getByRole("note")).toHaveTextContent("Draft wording");
    expect(within(priv).getByRole("link", { name: "Open Privacy" })).toHaveAttribute("href", "/app/tenants/t1/settings?section=privacy");
    expect(within(priv).queryAllByRole("button")).toHaveLength(0);
    for (const k of ["export", "delete", "consent"]) expect(priv.querySelector(`[data-part="privacy-${k}"]`)).not.toBeNull();
  });

  it("Developer API keys are test mode only: no key is shown and the create button is disabled", () => {
    render(<SettingsV6 {...props()} />);
    const dev = card("settings-developer");
    expect(dev).toHaveTextContent("Test mode only");
    expect(within(dev).getByText("No keys yet")).toBeInTheDocument();
    expect(within(dev).getByRole("button", { name: "Create a test key (coming soon)" })).toBeDisabled();
    expect(dev.textContent).not.toMatch(/sk_|pk_/);
  });

  it("says nothing about a provider, a cost or an assistant's name", () => {
    render(<SettingsV6 {...props()} />);
    expect(document.body.textContent).not.toMatch(/Sarvam|Exotel|Plivo|Twilio|Razorpay|Gemini|OpenAI|Anthropic|Claude|AI team/i);
  });
});
