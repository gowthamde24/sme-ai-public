import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const nav = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: nav.push, refresh: () => undefined }), usePathname: () => "/app", useSearchParams: () => new URLSearchParams() }));

import { CommandPalette } from "./CommandPalette";
import { paletteNames } from "./names";

const T = "11111111-1111-4111-8111-111111111111";
const B = `/app/tenants/${T}`;
const ID = "55555555-5555-4555-8555-555555555555";
const KEY = `sme_recent:o@example.com:${T}`;
const { names, words } = paletteNames("en");
const onClose = vi.fn();
const draw = (role: "owner" | "sales" = "owner") => render(<CommandPalette tenantId={T} role={role} pack={null} labels={undefined} names={names} words={words} recentKey={KEY} onClose={onClose} />);
const items = () => [...document.querySelectorAll("[data-palette-item]")].map((e) => e.getAttribute("data-palette-item"));
const type = (text: string) => fireEvent.change(screen.getByRole("combobox"), { target: { value: text } });

beforeEach(() => {
  nav.push.mockReset();
  onClose.mockReset();
  window.localStorage.clear();
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ items: [] }), { status: 200 })));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("the command palette (owner, 6 Nov 2026)", () => {
  it("opens with the cursor in the box, Go to (every menu page) and Recent (this person's, this workspace's)", () => {
    window.localStorage.setItem(KEY, JSON.stringify([{ href: `${B}/quotes`, label: "Quotes" }, { href: "/app/tenants/other/x", label: "Other workspace" }]));
    draw();
    expect(screen.getByRole("combobox")).toHaveFocus();
    expect(screen.getByText("Go to")).toBeInTheDocument();
    expect(items()).toContain("settings");
    expect(items()).toContain("recent:0");
    expect(screen.queryByText("Other workspace")).toBeNull();
    expect(items().some((i) => i?.startsWith("action:"))).toBe(false);
  });
  it('"settings" + Enter opens Settings; Esc closes', () => {
    draw();
    type("settings");
    expect(items()[0]).toBe("settings");
    expect(items()[items().length - 1]).toBe("ask");
    fireEvent.keyDown(screen.getByRole("combobox"), { key: "Enter" });
    expect(nav.push).toHaveBeenCalledWith(`${B}/settings`);
    expect(onClose).toHaveBeenCalled();
    onClose.mockReset();
    fireEvent.keyDown(screen.getByRole("combobox"), { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
  it("↑ and ↓ move the choice (wrapping), and the box says which one is chosen", () => {
    draw();
    type("settings");
    const box = screen.getByRole("combobox");
    expect(box).toHaveAttribute("aria-activedescendant", "palette-opt-0");
    fireEvent.keyDown(box, { key: "ArrowDown" });
    expect(box).toHaveAttribute("aria-activedescendant", "palette-opt-1");
    expect(document.getElementById("palette-opt-1")).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(box, { key: "ArrowUp" });
    fireEvent.keyDown(box, { key: "ArrowUp" });
    expect(box).toHaveAttribute("aria-activedescendant", `palette-opt-${items().length - 1}`);
    fireEvent.keyDown(box, { key: "Enter" });
    expect(nav.push).toHaveBeenCalledWith(`${B}/talk?ask=settings`);
  });
  it("records come from the search a moment after the typing stops, and open by kind and id", async () => {
    vi.useFakeTimers();
    const f = vi.fn(async () => new Response(JSON.stringify({ items: [{ kind: "lead", id: ID, title: "Anjali Boutique", sub: "Hyderabad" }, { kind: "lead", id: "bad", title: "Bad" }] }), { status: 200 }));
    vi.stubGlobal("fetch", f);
    draw();
    type("an");
    type("anjali");
    expect(f).not.toHaveBeenCalled();
    await act(async () => {
      vi.advanceTimersByTime(250);
    });
    vi.useRealTimers();
    await waitFor(() => expect(items()).toContain(`record:lead:${ID}`));
    expect(f).toHaveBeenCalledTimes(1);
    expect(String((f.mock.calls[0] as unknown as [string])[0])).toBe(`${B}/search?q=anjali`);
    expect(items()).not.toContain("record:lead:bad");
    fireEvent.click(screen.getByText("Anjali Boutique"));
    expect(nav.push).toHaveBeenCalledWith(`${B}/leads/${ID}`);
  });
  it('"Ask the assistant: <text>" is always last, the only item that goes to the assistant', () => {
    draw();
    type("what needs me today");
    expect(items()[items().length - 1]).toBe("ask");
    expect(screen.getByText(/Ask the assistant/)).toHaveTextContent("what needs me today");
    fireEvent.click(screen.getByText(/Ask the assistant/));
    expect(nav.push).toHaveBeenCalledWith(`${B}/talk?ask=what+needs+me+today`);
  });
  it("actions only where the person may do them: Top up for owners and admins", () => {
    draw("owner");
    type("top up");
    expect(items()).toContain("action:topup");
    cleanup();
    draw("sales");
    type("top up");
    expect(items()).not.toContain("action:topup");
  });
});
