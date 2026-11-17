import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));

import { appDict } from "@/i18n/app";

import { MarketingConsentList } from "./MarketingConsentList";

const words = Object.fromEntries(Object.entries(appDict("en") as Record<string, string>).filter(([k]) => k.startsWith("mc.")));
const row = (over: Record<string, unknown>) => ({ contact_id: "ca000000-0000-4000-8000-0000000000c1", name: "Ramesh K.", phone: null, state: "unknown", at: null, via: null, by: null, note: null, stopped: false, ...over });
const list = (items: unknown[], next: string | null = null) => ({ items, counts: { granted: 1, unknown: 317, withdrawn: 1 }, next_cursor: next }) as never;
const ok = { ok: true } as const;

const show = (items: unknown[], actions = { yes: vi.fn(async () => ok), no: vi.fn(async () => ok) }, over: Record<string, unknown> = {}) => {
  render(<MarketingConsentList words={words} lang="en" base="/app/tenants/t/marketing-consent" q="" state={null} list={list(items, over.next as string | null)} after={null} actions={actions as never} />);
  return actions;
};
beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

describe("Who wants offers", () => {
  it("shows the counts of the whole book, yes first", () => {
    show([row({})]);
    const counts = within(document.querySelector('[data-part="mc-counts"]') as HTMLElement).getAllByRole("listitem").map((li) => li.textContent);
    expect(counts).toEqual(["1said yes", "317not asked", "1said no"]);
  });
  it("records a yes only with a note of 2 to 160 characters, then refreshes", async () => {
    const a = show([row({})]);
    fireEvent.click(screen.getByRole("button", { name: "Record a yes" }));
    const save = screen.getByRole("button", { name: "Save" });
    expect(save).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/How did they say yes/), { target: { value: "  said yes   in shop " } });
    expect(save).toBeEnabled();
    fireEvent.click(save);
    await waitFor(() => expect(a.yes).toHaveBeenCalledWith("ca000000-0000-4000-8000-0000000000c1", "  said yes   in shop "));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });
  it("says why when the customer asked us to stop, and offers no yes button", () => {
    show([row({ state: "withdrawn", stopped: true })]);
    expect(screen.getByText("Asked us to stop")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Record a yes" })).toBeNull();
    expect(screen.queryByRole("button", { name: "No longer wants offers" })).toBeNull();
  });
  it("says how and when a yes was given, and who wrote it down", () => {
    show([row({ state: "granted", at: "2026-11-16T09:30:00Z", via: "owner_recorded", by: "Meena", note: "said yes in shop" })]);
    expect(screen.getByText("Recorded by your team · 16 Nov · Meena · said yes in shop")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Record a yes" })).toBeNull();
  });
  it("records a no in one press, and shows the API's refusal in words when the customer said STOP", async () => {
    const a = show([row({})], { yes: vi.fn(async () => ok), no: vi.fn(async () => ({ ok: false, error: "stopped" }) as never) });
    fireEvent.click(screen.getByRole("button", { name: "No longer wants offers" }));
    await waitFor(() => expect(a.no).toHaveBeenCalledWith("ca000000-0000-4000-8000-0000000000c1"));
    expect(await screen.findByRole("alert")).toHaveTextContent("This customer asked us to stop, so a yes cannot be recorded.");
    expect(refresh).not.toHaveBeenCalled();
  });
  it("says so when nobody matches, and links to the next page when there is one", () => {
    cleanup();
    show([]);
    expect(screen.getByText("Nobody matches.")).toBeInTheDocument();
    cleanup();
    show([row({})], undefined, { next: "abc" });
    expect(screen.getByRole("link", { name: "Show more" })).toHaveAttribute("href", "/app/tenants/t/marketing-consent?after=abc");
  });
});
