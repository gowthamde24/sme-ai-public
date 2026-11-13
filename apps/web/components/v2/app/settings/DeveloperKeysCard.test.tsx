import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { appDict } from "@/i18n/app";
import type { DevKey } from "@/lib/api/developer";

import { DeveloperKeysCard, type DeveloperActions } from "./DeveloperKeysCard";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: () => undefined }), usePathname: () => "/", useSearchParams: () => new URLSearchParams() }));
afterEach(() => {
  cleanup();
  refresh.mockClear();
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
const show = (a = actions(), keys: DevKey[] | null = [K1, K2], mock = false) => render(<DeveloperKeysCard words={appDict("en") as Record<string, string>} lang="en" keys={keys} usage={{ today: { requests: 3, leads: 1, callsSimulated: 1 }, month: { requests: 40, leads: 9, callsSimulated: 8 } }} mock={mock} actions={a} />);

describe("Developer API keys card (test mode)", () => {
  it("lists the keys by prefix and last four with what each may do and when it was used, never a secret; a revoked key is greyed with no buttons", () => {
    show();
    const live = document.querySelector(`[data-key="${K1.id}"]`) as HTMLElement;
    expect(live).toHaveTextContent("Website form");
    expect(live).toHaveTextContent("sk_test_ab12…wxyz");
    expect(live).toHaveTextContent("Add leads, See usage");
    expect(live).toHaveTextContent("Last used Nov 13");
    const dead = document.querySelector(`[data-key="${K2.id}"]`) as HTMLElement;
    expect(dead).toHaveAttribute("data-revoked", "true");
    expect(dead).toHaveTextContent("Revoked");
    expect(dead).toHaveTextContent("Never used");
    expect(within(dead).queryAllByRole("button")).toHaveLength(0);
    expect(screen.getByText("Test use: 3 requests today, 40 this month")).toBeInTheDocument();
    expect(document.body.textContent).not.toContain(SECRET);
  });

  it("puts the revoked keys after the active ones under their own heading, even when the API lists them first", () => {
    show(actions(), [K2, K1]);
    const keys = [...document.querySelectorAll("[data-key]")].map((e) => e.getAttribute("data-key"));
    expect(keys).toEqual([K1.id, K2.id]);
    expect(screen.getByText("Revoked keys")).toBeInTheDocument();
  });

  it("makes a key: sends the name, the scopes and the addresses (test only), then shows the secret ONCE with the warning and a copy button; 'I have saved it' removes it", async () => {
    const writeText = vi.fn(async () => undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    const a = actions();
    show(a, []);
    expect(screen.getByText("No keys yet")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Create a test key" }));
    fireEvent.change(screen.getByLabelText("Key name"), { target: { value: "Website form" } });
    fireEvent.click(screen.getByLabelText("Read leads"));
    fireEvent.change(screen.getByLabelText(/Allowed addresses/), { target: { value: "203.0.113.4\n\n198.51.100.0/24" } });
    fireEvent.click(screen.getByRole("button", { name: "Create key" }));
    await waitFor(() => expect(a.create).toHaveBeenCalledWith({ name: "Website form", scopes: ["leads:write", "leads:read"], ipAllow: ["203.0.113.4", "", "198.51.100.0/24"] }));
    const box = await screen.findByRole("alert");
    expect(within(box).getByText(SECRET)).toBeInTheDocument();
    expect(box).toHaveTextContent("This is the only time this key is shown.");
    expect(refresh).toHaveBeenCalled();
    fireEvent.click(within(box).getByRole("button", { name: "Copy" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(SECRET));
    expect(await within(box).findByRole("button", { name: "Copied" })).toBeInTheDocument();
    fireEvent.click(within(box).getByRole("button", { name: "I have saved it" }));
    expect(document.body.textContent).not.toContain(SECRET);
  });

  it("says a refusal in the screen's words (ten keys already) and shows no secret", async () => {
    const a = actions({ create: vi.fn(async () => ({ ok: false as const, kind: "conflict" as const, error: "x", code: "too_many_keys" })) });
    show(a, [K1]);
    fireEvent.click(screen.getByRole("button", { name: "Create a test key" }));
    fireEvent.change(screen.getByLabelText("Key name"), { target: { value: "n" } });
    fireEvent.click(screen.getByRole("button", { name: "Create key" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("You already have 10 active keys. Revoke one first.");
    expect(document.querySelector('[data-part="key-secret"]')).toBeNull();
  });

  it("Rotate asks once more, then shows the new secret once; Revoke asks once more and shows no secret", async () => {
    const a = actions();
    show(a);
    fireEvent.click(screen.getByRole("button", { name: "Rotate: Website form" }));
    expect(screen.getByText("The old key stops working at once. Rotate it?")).toBeInTheDocument();
    expect(a.rotate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Yes, rotate" }));
    await waitFor(() => expect(a.rotate).toHaveBeenCalledWith(K1.id));
    expect(await screen.findByText(SECRET)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "I have saved it" }));
    fireEvent.click(screen.getByRole("button", { name: "Revoke: Website form" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(a.revoke).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Revoke: Website form" }));
    fireEvent.click(screen.getByRole("button", { name: "Yes, revoke" }));
    await waitFor(() => expect(a.revoke).toHaveBeenCalledWith(K1.id));
    expect(document.querySelector('[data-part="key-secret"]')).toBeNull();
  });

  it("marks test data of the browser, and says 'Not set yet' where the keys could not be read", () => {
    const { unmount } = show(actions(), [], true);
    expect(screen.getByRole("note")).toHaveTextContent("Test data kept in this browser. These keys open nothing.");
    unmount();
    show(actions(), null);
    expect(screen.getByText("Not set yet")).toBeInTheDocument();
  });
});
