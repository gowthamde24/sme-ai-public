import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { SettingsV6Data } from "@/app/app/tenants/[tenantId]/settings/settings-v6-data";
import { appDict } from "@/i18n/app";
import type { DevKey } from "@/lib/api/developer";

import { AssistantNameCard, type RenameFn } from "./AssistantNameCard";
import { DeveloperKeysCard, type DeveloperActions } from "./DeveloperKeysCard";
import { SettingsV6, type SettingsV6Props } from "./SettingsV6";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: () => undefined, replace: () => undefined }), usePathname: () => "/", useSearchParams: () => new URLSearchParams() }));
vi.mock("./LazyTabs", async () => await import("./LazyTabs.eager"));
vi.mock("./LazyDeveloperKeys", async () => await import("./DeveloperKeysCard"));
vi.mock("./LazyAssistantNameCard", async () => await import("./AssistantNameCard"));
afterEach(() => {
  cleanup();
  refresh.mockClear();
});
const words = appDict("en") as Record<string, string>;

describe("Settings > Your assistant (the name on the Settings home) under JOBS", () => {
  const show = (name: string | null, rename: RenameFn, simple = true) => render(<AssistantNameCard words={words} name={name} rename={rename} setupHref="/app/tenants/t/settings?section=assistant" simple={simple} />);
  it("the name is inside one sentence, one Save, the effect line follows the typing, and the way to the voice, language and what it may do", () => {
    show("Vani", vi.fn<RenameFn>(async (n) => ({ ok: true, name: n })));
    expect(screen.getByText(/Your assistant is called/)).toBeInTheDocument();
    expect(screen.getByLabelText("Assistant name")).toHaveValue("Vani");
    expect(screen.getByText("What it will do:").parentElement).toHaveTextContent("On calls and messages it will say “Vani, the AI assistant”.");
    fireEvent.change(screen.getByLabelText("Assistant name"), { target: { value: "" } });
    expect(screen.getByText("What it will do:").parentElement).toHaveTextContent("it will say “your assistant”");
    expect(screen.getByRole("link", { name: "Voice, language and what it may do" })).toHaveAttribute("href", "/app/tenants/t/settings?section=assistant");
    expect(screen.getAllByRole("button", { name: /Save name/ })).toHaveLength(1);
  });
  it("saves through the same rename call, Undo puts the earlier name back; JOBS off keeps the old field", async () => {
    const rename = vi.fn<RenameFn>(async (n) => ({ ok: true, name: n }));
    show("Meera", rename);
    fireEvent.change(screen.getByLabelText("Assistant name"), { target: { value: "  Vani " } });
    fireEvent.click(screen.getByRole("button", { name: "Save name" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Saved: Vani"));
    expect(rename).toHaveBeenLastCalledWith("Vani");
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(rename).toHaveBeenLastCalledWith("Meera"));
    cleanup();
    show("Meera", rename, false);
    expect(screen.queryByText("What it will do:")).toBeNull();
    expect(screen.queryByRole("link", { name: "Voice, language and what it may do" })).toBeNull();
  });
});

const DATA: SettingsV6Data = {
  business: { name: "Lakshmi Sarees", city: "Hyderabad", phone: "+91 98480 00000", addressLine: null, area: null, pincode: null, languages: ["te"], logoUrl: null },
  gstin: null,
  team: [],
  whatsapp: { state: "connected", phone: "+91 90000 00000" },
  templates: { approved: 6, review: 4 },
  sources: { active: 2 },
  phone: { state: "kyc_pending", number: "+91 80000 00000" },
  hours: null,
  developer: null,
};
const props = (over: Partial<SettingsV6Props> = {}): SettingsV6Props => ({ words, lang: "en", base: "/app/tenants/t1", title: "Settings", help: null, admin: true, data: DATA, tenantName: "Lakshmi Sarees", theme: "system", langLabel: "Language", notificationsHref: null, save: async () => ({ ok: true }), jobs: true, ...over });

describe("Settings > Connections under JOBS", () => {
  it("each connection is one sentence and one button, its state a solid chip; the rest is under More choices", () => {
    render(<SettingsV6 {...props()} />);
    const card = document.querySelector('[data-part="settings-connections"]') as HTMLElement;
    expect(card).toHaveAttribute("data-simple");
    const lines = within(card).getAllByText(/./, { selector: "li[data-part=connection] > div > p:first-child" }).map((p) => p.textContent);
    expect(lines).toEqual(["Customers can reach you on WhatsApp at +91 90000 00000.", "6 message templates are approved and 4 are under review.", "2 lead sources are connected.", "Your business number for calls is +91 80000 00000.", "Your business phone is +91 98480 00000.", "Decide in My assistant, under Rules, when a call is passed to you."]);
    expect(card.querySelectorAll('.jb-chip[data-tone="done"]')).toHaveLength(1);
    expect(card.querySelectorAll('.jb-chip[data-tone="wait"]')).toHaveLength(1);
    expect(within(card).getByRole("link", { name: "Manage: WhatsApp number" })).toHaveAttribute("href", "/app/tenants/t1/integrations/whatsapp");
    expect(within(card).getByRole("link", { name: "Open: Message templates" })).toHaveAttribute("href", "/app/tenants/t1/chats/templates");
    expect(within(card).getByRole("link", { name: "Open: Lead sources" })).toHaveAttribute("href", "/app/tenants/t1/lead-sources");
    expect(within(card).getByRole("link", { name: "Set up: Business number for calls" })).toHaveAttribute("href", "/app/tenants/t1/phone-number");
    const more = card.querySelector('[data-part="more-choices"]') as HTMLElement;
    expect(more).not.toHaveAttribute("open");
    expect(within(more).getByRole("link", { name: "Edit: Business phone" })).toHaveAttribute("href", "/app/tenants/t1/settings?section=business");
    expect(within(more).getByRole("link", { name: "Open: Calls put through to you" })).toHaveAttribute("href", "/app/tenants/t1/ai-team/training?section=rules");
    expect(card.querySelectorAll("a")).toHaveLength(6);
  });
  it("a connection that is not there says so and offers Connect; nothing is read for a person who is not an owner or admin", () => {
    render(<SettingsV6 {...props({ data: { ...DATA, whatsapp: { state: "not_connected", phone: null }, sources: { active: 0 }, phone: { state: "not_set_up", number: null }, templates: null } })} />);
    const card = document.querySelector('[data-part="settings-connections"]') as HTMLElement;
    expect(card).toHaveTextContent("WhatsApp is not connected yet.");
    expect(within(card).getByRole("link", { name: "Connect: WhatsApp number" })).toBeInTheDocument();
    expect(card).toHaveTextContent("No lead source is connected yet.");
    expect(card).toHaveTextContent("You have no business number for calls yet.");
    expect(card).toHaveTextContent("Message templates could not be read just now.");
    cleanup();
    render(<SettingsV6 {...props({ admin: false })} />);
    expect(document.querySelector('[data-part="settings-connections"]')).toHaveTextContent("Only the owner and admins see the connections.");
    expect(document.querySelector('[data-part="settings-connections"] a')).toBeNull();
  });
  it("JOBS off draws the Connections card of before (rows with Edit)", () => {
    render(<SettingsV6 {...props({ jobs: false })} />);
    const card = document.querySelector('[data-part="settings-connections"]') as HTMLElement;
    expect(card).not.toHaveAttribute("data-simple");
    expect(card.querySelectorAll('[data-part="settings-row"]').length).toBeGreaterThan(3);
  });
});

const K1: DevKey = { id: "22222222-2222-4222-8222-222222222222", name: "Website form", mode: "test", prefix: "sk_test_ab12", last4: "wxyz", scopes: ["leads:write", "usage:read"], createdAt: "2026-11-12T05:00:00Z", lastUsedAt: "2026-11-13T05:00:00Z", rotatedAt: null, revokedAt: null, ipAllow: [] };
const K2: DevKey = { ...K1, id: "33333333-3333-4333-8333-333333333333", name: "Old key", lastUsedAt: null, revokedAt: "2026-11-13T06:00:00Z" };
const SECRET = "sk_test_fake_aaaa_bbbb_cccc";
const actions = (over: Partial<DeveloperActions> = {}): DeveloperActions => ({
  create: vi.fn(async () => ({ ok: true as const, data: { key: K1, secret: SECRET } })),
  rotate: vi.fn(async () => ({ ok: true as const, data: { key: K1, secret: SECRET } })),
  revoke: vi.fn(async () => ({ ok: true as const, data: { key: { ...K1, revokedAt: "2026-11-13T07:00:00Z" }, secret: null } })),
  ...over,
});
const keys = (a = actions(), list: DevKey[] | null = [K1, K2], simple = true) => render(<DeveloperKeysCard words={words} lang="en" keys={list} usage={{ today: { requests: 3, leads: 1, callsSimulated: 1 }, month: { requests: 40, leads: 9, callsSimulated: 8 } }} mock={false} actions={a} simple={simple} />);

describe("Settings > Developer API keys under JOBS", () => {
  it("lists the keys with a solid chip for a revoked one, one primary button, the technical part hidden until it is wanted", () => {
    keys();
    const card = document.querySelector('[data-part="settings-developer"]') as HTMLElement;
    expect(card).toHaveAttribute("data-simple");
    expect(card.querySelector('.jb-chip[data-tone="info"]')).toHaveTextContent("Test mode only");
    expect(card.querySelector(`[data-key="${K2.id}"] .jb-chip[data-tone="fail"]`)).toHaveTextContent("Revoked");
    expect(card.querySelector(`[data-key="${K1.id}"]`)).toHaveTextContent("sk_test_ab12…wxyz");
    expect(card).toHaveTextContent("Test use: 3 requests today, 40 this month");
    expect(screen.getByRole("button", { name: "Create a test key" })).toBeInTheDocument();
    expect(screen.queryByLabelText("What this key may do")).toBeNull();
    expect(document.body.textContent).not.toContain(SECRET);
  });
  it("makes a key with the same payload as the old form: the name inside the sentence, the effect line, scopes and addresses under More choices; the secret is shown once", async () => {
    Object.assign(navigator, { clipboard: { writeText: vi.fn(async () => undefined) } });
    const a = actions();
    keys(a, []);
    expect(screen.getByText("No keys yet")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Create a test key" }));
    expect(screen.getByRole("button", { name: "Create key" })).toBeDisabled();
    fireEvent.change(screen.getByRole("textbox", { name: "Make a test key called …." }), { target: { value: "Website form" } });
    expect(screen.getByText("What it will do:").parentElement).toHaveTextContent("It will make a test key called “Website form” that may: Add leads. The secret is shown once.");
    const more = document.querySelector('[data-part="more-choices"]') as HTMLElement;
    expect(more).not.toHaveAttribute("open");
    fireEvent.click(within(more).getByRole("checkbox", { name: "Read leads" }));
    fireEvent.change(within(more).getByLabelText(/Allowed addresses/), { target: { value: "203.0.113.4\n\n198.51.100.0/24" } });
    expect(screen.getByText("What it will do:").parentElement).toHaveTextContent("Add leads, Read leads");
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Create key" })));
    await waitFor(() => expect(a.create).toHaveBeenCalledWith({ name: "Website form", scopes: ["leads:write", "leads:read"], ipAllow: ["203.0.113.4", "", "198.51.100.0/24"] }));
    const box = await screen.findByRole("alert");
    expect(within(box).getByText(SECRET)).toBeInTheDocument();
    fireEvent.click(within(box).getByRole("button", { name: "I have saved it" }));
    expect(document.body.textContent).not.toContain(SECRET);
  });
  it("Rotate and Revoke ask once more, with the same calls; a refusal is said in the screen's words", async () => {
    const a = actions({ create: vi.fn(async () => ({ ok: false as const, kind: "conflict" as const, error: "x", code: "too_many_keys" })) });
    keys(a, [K1]);
    fireEvent.click(screen.getByRole("button", { name: "Revoke: Website form" }));
    expect(screen.getByText(/A revoked key cannot be brought back/)).toBeInTheDocument();
    expect(a.revoke).not.toHaveBeenCalled();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Yes, revoke" })));
    expect(a.revoke).toHaveBeenCalledWith(K1.id);
    fireEvent.click(screen.getByRole("button", { name: "Rotate: Website form" }));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Yes, rotate" })));
    expect(a.rotate).toHaveBeenCalledWith(K1.id);
    expect(await screen.findByText(SECRET)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "I have saved it" }));
    fireEvent.click(screen.getByRole("button", { name: "Create a test key" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Make a test key called …." }), { target: { value: "n" } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Create key" })));
    expect(await screen.findByText("You already have 10 active keys. Revoke one first.")).toBeInTheDocument();
  });
  it("JOBS off draws the card of before", () => {
    keys(actions(), [K1], false);
    expect(document.querySelector("[data-simple]")).toBeNull();
    expect(screen.queryByText("What it will do:")).toBeNull();
  });
});
