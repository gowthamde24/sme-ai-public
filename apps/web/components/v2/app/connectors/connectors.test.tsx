import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { appDict } from "@/i18n/app";
import { parseCard, parseConnection, parseDeliveries, parsePage, failOf } from "@/lib/api/crm-push";
import { ApiRequestError } from "@/lib/api/client";
import { SAMPLE_PAGE } from "@/lib/crm-push/sample";

import type { ConnectorActions } from "./actions";
import { ConnectorsView, CHIPS } from "./ConnectorsView";

afterEach(cleanup);
const words = Object.fromEntries(Object.entries(appDict("en") as Record<string, string>).filter(([k]) => k.startsWith("crm.")));
const KEY = "sekret-key-0123456789";
const actions = (over: Partial<ConnectorActions> = {}): ConnectorActions => ({ connect: vi.fn(), change: vi.fn(), disconnect: vi.fn(), test: vi.fn(), log: vi.fn(), retry: vi.fn(), ...over });
const view = (a: ConnectorActions, page = SAMPLE_PAGE, extra: Partial<{ readOnly: boolean; webhooks: { count: number } | null }> = {}) =>
  render(<ConnectorsView words={words} ui="en" page={page} actions={a} readOnly={extra.readOnly ?? false} webhooks={extra.webhooks === undefined ? { count: 2 } : extra.webhooks} developersHref="/app/tenants/T/developers" />);
const card = (type: string) => document.querySelector(`[data-part="connector"][data-type="${type}"]`) as HTMLElement;
const connected = parseConnection({ id: "00000000-0000-4000-8000-0000000000a1", config: {}, mapping: { name: "firstname" }, events: ["call.completed"], active: true, health: { status: "ok" }, last_test: null });

describe("Connectors page", () => {
  it("shows a card for each tool with Connected, Not connected or Needs setup by us, the chips and the rules line", () => {
    view(actions());
    expect(within(card("hubspot")).getByText("Connected")).toBeInTheDocument();
    expect(within(card("leadsquared")).getByText("Not connected")).toBeInTheDocument();
    expect(within(card("zoho_crm")).getByText("Needs setup by us")).toBeInTheDocument();
    expect(screen.getByText("Works with anything that can send a web request")).toBeInTheDocument();
    const chips = document.querySelector('[data-part="connector-chips"]') as HTMLElement;
    for (const c of CHIPS) expect(within(chips).getByText(c)).toBeInTheDocument();
    expect(screen.getByText(/Calling hours, consent and do-not-call stay as they are/)).toBeInTheDocument();
    expect(within(card("web_address")).getByRole("link", { name: "Open webhooks" })).toHaveAttribute("href", "/app/tenants/T/developers?tab=hooks");
  });
  it("a tool that needs setup by us says so and has no connect form", () => {
    view(actions());
    fireEvent.click(within(card("zoho_crm")).getByRole("button", { name: "Open" }));
    expect(within(card("zoho_crm")).getByText(/We still need to register Stack19 with Zoho/)).toBeInTheDocument();
    expect(within(card("zoho_crm")).queryByRole("button", { name: "Save and connect" })).toBeNull();
  });
  it("the connect form has a labelled field for each key and setting, hides the key, sends it once and clears it", async () => {
    const connect = vi.fn(async () => ({ ok: true as const, connection: connected }));
    view(actions({ connect }));
    fireEvent.click(within(card("leadsquared")).getByRole("button", { name: "Open" }));
    const panel = card("leadsquared");
    expect(within(panel).getByText("Before you connect")).toBeInTheDocument();
    const save = within(panel).getByRole("button", { name: "Save and connect" });
    expect(save).toBeDisabled();
    const access = within(panel).getByLabelText("Access key") as HTMLInputElement;
    expect(access.type).toBe("password");
    fireEvent.change(access, { target: { value: KEY } });
    fireEvent.change(within(panel).getByLabelText("Second key"), { target: { value: "other-secret-0123456789" } });
    fireEvent.change(within(panel).getByLabelText("API host"), { target: { value: "api-in21.leadsquared.com" } });
    fireEvent.click(save);
    await waitFor(() => expect(connect).toHaveBeenCalledWith("leadsquared", { credentials: { access_key: KEY, second_key: "other-secret-0123456789" }, settings: { host: "api-in21.leadsquared.com" } }));
    await waitFor(() => expect(within(panel).getByText("Connected")).toBeInTheDocument());
    expect(document.body.textContent).not.toContain(KEY);
    expect(document.body.innerHTML).not.toContain(KEY);
  });
  it("a refused form says why in one plain sentence", async () => {
    const connect = vi.fn(async () => ({ ok: false as const, error: "settings" as const }));
    view(actions({ connect }));
    fireEvent.click(within(card("leadsquared")).getByRole("button", { name: "Open" }));
    const panel = card("leadsquared");
    for (const [label, value] of [["Access key", "a1234567"], ["Second key", "b1234567"], ["API host", "nope.example.com"]]) fireEvent.change(within(panel).getByLabelText(label), { target: { value } });
    fireEvent.click(within(panel).getByRole("button", { name: "Save and connect" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Check the details you typed");
  });
  it("a connected card shows when to send, the field table, Test connection with a plain result, Pause and the log", async () => {
    const test = vi.fn(async () => ({ ok: true as const, result: { ok: false, reason: "auth" as const } }));
    const log = vi.fn(async () => ({ ok: true as const, log: parseDeliveries({ items: [{ id: "11111111-1111-4111-8111-111111111111", event: "call.completed", status: "delivered", attempts: 1, result: "noted", last_status_code: 201, last_error: null, created_at: "2026-11-25T10:00:00Z" }], next_before: null }) }));
    const change = vi.fn(async () => ({ ok: true as const, connection: { ...parseConnection({ id: "00000000-0000-4000-8000-0000000000a1", config: {}, mapping: {}, events: ["call.completed", "lead.created"], active: false, health: { status: "ok" } }) } }));
    view(actions({ test, log, change }));
    fireEvent.click(within(card("hubspot")).getByRole("button", { name: "Open" }));
    const panel = card("hubspot");
    expect(within(panel).getByText("When to send")).toBeInTheDocument();
    expect(within(panel).getByText("Which field goes where")).toBeInTheDocument();
    expect(within(panel).getByLabelText("Phone number")).toBeInTheDocument();
    fireEvent.click(within(panel).getByRole("button", { name: "Test connection" }));
    expect(await within(panel).findByText(/Not working yet\. The other tool did not accept the key/)).toBeInTheDocument();
    fireEvent.click(within(panel).getByRole("button", { name: "Delivery log" }));
    expect(await within(panel).findByText(/Sent · Note added · 1 tries · 201/)).toBeInTheDocument();
    fireEvent.click(within(panel).getByRole("button", { name: "Pause" }));
    await waitFor(() => expect(change).toHaveBeenCalledWith("hubspot", { active: false }));
    expect(await within(panel).findByText("Paused. Nothing is sent until you resume.")).toBeInTheDocument();
  });
  it("saves the field table with the field the person picked, and a typed-in field name", async () => {
    const change = vi.fn(async () => ({ ok: true as const, connection: connected }));
    view(actions({ change }));
    fireEvent.click(within(card("hubspot")).getByRole("button", { name: "Open" }));
    const panel = card("hubspot");
    fireEvent.change(within(panel).getByLabelText("Where the lead came from"), { target: { value: "__other" } });
    fireEvent.change(within(panel).getByLabelText("Field name in the other tool"), { target: { value: "lead_source_custom" } });
    fireEvent.click(within(panel).getByRole("button", { name: "Save fields" }));
    await waitFor(() => expect(change).toHaveBeenCalled());
    const sent = (change.mock.calls[0] as unknown[])[1] as { mapping: Record<string, string> };
    expect(sent.mapping.source).toBe("lead_source_custom");
    expect(sent.mapping.name).toBe("firstname");
  });
  it("a failing connection is the neutral notice with a way to try again, and disconnecting asks first", async () => {
    const failing = { ...SAMPLE_PAGE, items: SAMPLE_PAGE.items.map((c) => (c.type === "hubspot" && c.connection ? { ...c, connection: { ...c.connection, failing: true } } : c)) };
    const retry = vi.fn(async () => ({ ok: true as const, requeued: 3 }));
    const disconnect = vi.fn(async () => ({ ok: true as const }));
    view(actions({ retry, disconnect }), failing);
    expect(within(card("hubspot")).getByText("Connected, some results could not be sent")).toBeInTheDocument();
    fireEvent.click(within(card("hubspot")).getByRole("button", { name: "Open" }));
    const panel = card("hubspot");
    expect(within(panel).getAllByRole("status")[0]).toHaveTextContent("Some results could not be sent to HubSpot");
    fireEvent.click(within(panel).getByRole("button", { name: "Try the failed ones again" }));
    expect(await within(panel).findByText("Queued again: 3.")).toBeInTheDocument();
    fireEvent.click(within(panel).getByRole("button", { name: "Disconnect" }));
    expect(within(panel).getByText(/removes the connection, its log and the saved key/)).toBeInTheDocument();
    expect(disconnect).not.toHaveBeenCalled();
    fireEvent.click(within(panel).getByRole("button", { name: "Yes, disconnect" }));
    await waitFor(() => expect(disconnect).toHaveBeenCalledWith("hubspot"));
    await waitFor(() => expect(within(card("hubspot")).getByText("Not connected")).toBeInTheDocument());
  });
  it("the review sample says nothing is sent and switches every button off", () => {
    view(actions(), SAMPLE_PAGE, { readOnly: true });
    expect(screen.getByText(/sample cards for review/)).toBeInTheDocument();
    fireEvent.click(within(card("leadsquared")).getByRole("button", { name: "Open" }));
    expect(within(card("leadsquared")).getByRole("button", { name: "Save and connect" })).toBeDisabled();
  });
  it("the web address card says so when webhooks are not open", () => {
    view(actions(), SAMPLE_PAGE, { webhooks: null });
    expect(within(card("web_address")).getByText("Web addresses are not open for your workspace yet.")).toBeInTheDocument();
    expect(within(card("web_address")).queryByRole("link")).toBeNull();
  });
});

describe("Connectors API shapes", () => {
  it("parses a page and never reads a key from it", () => {
    const page = parsePage({ items: [{ type: "hubspot", label: "HubSpot", state: "connected", needs_setup: null, credentials: [{ key: "token", label: "Token", help: "", example: "" }], settings: [], targets: [], our_fields: [{ key: "name", label: "Name" }], default_mapping: { name: "firstname" }, uses_notes: true, note_value: "@note", setup_steps: [], connection: { id: "00000000-0000-4000-8000-0000000000a1", type: "hubspot", config: {}, mapping: {}, events: ["lead.created"], active: true, secret_version: 1, health: { status: "failing", dead_letters_7d: 2, last_delivered_at: null }, last_test: { at: "2026-11-25T10:00:00Z", ok: false, reason: "tls" } } }], events: [{ event: "lead.created", description: "x" }], available: true });
    expect(page.items[0].connection).toMatchObject({ failing: true, deadLetters7d: 2, lastTest: { ok: false, reason: "tls" } });
    expect(JSON.stringify(page)).not.toMatch(/secret_version|token":"/);
  });
  it("rejects a card with an unknown state and a delivery with an unknown status", () => {
    expect(() => parseCard({ type: "x", label: "X", state: "weird" })).toThrow();
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(parseDeliveries({ items: [{ id: "11111111-1111-4111-8111-111111111111", event: "e", status: "weird", attempts: 0, created_at: "2026-11-25T10:00:00Z" }], next_before: null }).items).toEqual([]); // a row that is not the contract's shape is left out, never shown
    spy.mockRestore();
  });
  it("maps the API's refusals to closed kinds", () => {
    expect(failOf(new ApiRequestError(409, "needs_setup_by_us", "x")).error).toBe("needs_setup");
    expect(failOf(new ApiRequestError(422, "settings_invalid", "x", "config"))).toEqual({ ok: false, error: "settings", reason: "config" });
    expect(failOf(new ApiRequestError(403, "mfa_required", "x")).error).toBe("mfa");
    expect(failOf(new ApiRequestError(503, "crm_push_unavailable", "x")).error).toBe("unavailable");
    expect(failOf(new ApiRequestError(500, "boom", "x")).error).toBe("other");
  });
});
