import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { appDict } from "@/i18n/app";
import { parseEndpoint, type Endpoint, type EventKind } from "@/lib/api/webhooks-out";

import { ActivityTab } from "./ActivityTab";
import { WebhooksTab, type HookActions } from "./WebhooksTab";

afterEach(cleanup);
const words = Object.fromEntries(Object.entries(appDict("en") as Record<string, string>).filter(([k]) => k.startsWith("dvh.") || k.startsWith("apierr.")));
const EVENTS: EventKind[] = [{ event: "call.completed", description: "A call ended" }, { event: "lead.created", description: "A lead arrived" }, { event: "test.ping", description: "Test" }];
const raw = (over: Record<string, unknown> = {}) => ({ id: "11111111-1111-4111-8111-111111111111", url: "https://example.com/hook", events: ["call.completed"], send_transcript: false, active: true, secret_last4: "k3Fq", secret_version: 1, created_at: "2026-11-25T10:00:00Z", created_by: "x", rotated_at: null, health: { status: "ok", failing_since: null, dead_letters_7d: 0, last_delivered_at: null }, ...over });
const HOOK: Endpoint = parseEndpoint(raw());
const actions = (over: Partial<HookActions> = {}): HookActions => ({ create: vi.fn(), change: vi.fn(), rotate: vi.fn(), remove: vi.fn(), test: vi.fn(async () => ({ ok: true as const })), log: vi.fn(), ...over });

describe("Webhooks tab", () => {
  it("a failing address is the neutral notice with the address in it", () => {
    render(<WebhooksTab words={words} endpoints={[parseEndpoint(raw({ health: { status: "failing", failing_since: "2026-11-25T09:00:00Z", dead_letters_7d: 3, last_delivered_at: null } }))]} events={EVENTS} owner actions={actions()} />);
    expect(screen.getByRole("status")).toHaveTextContent("Some events could not be delivered to https://example.com/hook after every retry.");
  });
  it("adds an address, shows the secret once and hides it after 'I have saved it'", async () => {
    const created = { webhook: parseEndpoint(raw({ id: "22222222-2222-4222-8222-222222222222", url: "https://new.example.com/x" })), secret: "whsec_abcdefghijklmnopqrstuvwxyz012345" };
    const create = vi.fn(async () => ({ ok: true as const, created }));
    render(<WebhooksTab words={words} endpoints={[]} events={EVENTS} owner actions={actions({ create })} />);
    expect(screen.getByText("No address yet. Add one to start getting events.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Add an address" }));
    fireEvent.change(screen.getByLabelText("Your address (https)"), { target: { value: "https://new.example.com/x" } });
    expect(screen.queryByText("test.ping")).toBeNull(); // the test event is not a thing to subscribe to
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(create).toHaveBeenCalledWith({ url: "https://new.example.com/x", events: ["call.completed", "lead.created"], sendTranscript: false }));
    expect(await screen.findByText("whsec_abcdefghijklmnopqrstuvwxyz012345")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "I have saved it" }));
    expect(screen.queryByText("whsec_abcdefghijklmnopqrstuvwxyz012345")).toBeNull();
    expect(screen.getByText("https://new.example.com/x")).toBeInTheDocument();
  });
  it("a refused address says why in one plain sentence", async () => {
    const create = vi.fn(async () => ({ ok: false as const, error: "url" as const, reason: "private" }));
    render(<WebhooksTab words={words} endpoints={[]} events={EVENTS} owner actions={actions({ create })} />);
    fireEvent.click(screen.getByRole("button", { name: "Add an address" }));
    fireEvent.change(screen.getByLabelText("Your address (https)"), { target: { value: "https://10.0.0.1/hook" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("That address points inside a private network. Use a public one.");
  });
  it("only the Owner sees the transcript choice", () => {
    const { rerender } = render(<WebhooksTab words={words} endpoints={[]} events={EVENTS} owner={false} actions={actions()} />);
    fireEvent.click(screen.getByRole("button", { name: "Add an address" }));
    expect(screen.queryByLabelText(/Include the call transcript/)).toBeNull();
    rerender(<WebhooksTab words={words} endpoints={[]} events={EVENTS} owner actions={actions()} />);
    expect(screen.getByLabelText(/Include the call transcript/)).toBeInTheDocument();
  });
  it("sends a test, reads the log with plain words and deletes after a confirmation", async () => {
    const test = vi.fn(async () => ({ ok: true as const }));
    const log = vi.fn(async () => ({ ok: true as const, log: { items: [{ id: "33333333-3333-4333-8333-333333333333", event: "lead.created", status: "dead" as const, attempts: 6, code: 503, error: "status" as const, nextAt: null, createdAt: "2026-11-25T10:00:00Z", deliveredAt: null }], nextBefore: null } }));
    const remove = vi.fn(async () => ({ ok: true as const }));
    render(<WebhooksTab words={words} endpoints={[HOOK]} events={EVENTS} owner actions={actions({ test, log, remove })} />);
    fireEvent.click(screen.getByRole("button", { name: "Send a test" }));
    expect(await screen.findByText("A test event will be sent within a minute.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Delivery log" }));
    const part = await screen.findByText("lead.created");
    expect(part.closest("li")).toHaveTextContent("Gave up · 6 tries · 503 · Your server answered with an error");
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(remove).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Yes, delete" }));
    await waitFor(() => expect(remove).toHaveBeenCalledWith(HOOK.id));
    await waitFor(() => expect(screen.queryByText("https://example.com/hook")).toBeNull());
  });
});

describe("Activity tab", () => {
  const usage = { today: { requests: 12, leads: 3, calls: 1, campaigns: 0, errors: 2 }, month: { requests: 1500, leads: 40, calls: 9, campaigns: 1, errors: 7 }, limits: { requestsPerMinute: 60, callsPerMinute: 10, campaignsPerMinute: 5, concurrentCalls: 10 } };
  const row = (id: string, status = 200) => ({ id, keyName: "Website", method: "POST", route: "/api/v1/leads", status, latencyMs: 120, at: "2026-11-25T10:00:00Z" });
  it("shows the counts, the limits and the requests, and reads earlier ones on request", async () => {
    const load = vi.fn(async () => ({ ok: true as const, activity: { items: [row("c", 201)], nextBefore: null } }));
    render(<ActivityTab words={words} usage={usage} first={{ items: [row("a"), row("b", 422)], nextBefore: "n1" }} load={load} />);
    const table = screen.getByRole("table");
    expect(within(table).getByText("1,500")).toBeInTheDocument();
    expect(screen.getByText("Limits for each key: 60 requests a minute, 10 calls a minute, 10 calls at once.")).toBeInTheDocument();
    expect(screen.getAllByText("POST /api/v1/leads")).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "Show earlier" }));
    await waitFor(() => expect(screen.getAllByText("POST /api/v1/leads")).toHaveLength(3));
    expect(load).toHaveBeenCalledWith("n1");
  });
});
