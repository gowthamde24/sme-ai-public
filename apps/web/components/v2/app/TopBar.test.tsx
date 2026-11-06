import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ usePathname: () => "/app/tenants/11111111-1111-4111-8111-111111111111", useRouter: () => ({ refresh: () => undefined, push: () => undefined }), useSearchParams: () => new URLSearchParams() }));
vi.mock("./notify/NotificationBell", () => ({ NotificationBell: () => null }));
vi.mock("./help/HelpButton", () => ({ HelpButton: () => null }));

vi.mock("./LazyTopSearch", async () => ({ TopSearch: (await import("./TopSearch")).TopSearch }));
vi.mock("next/dynamic", () => ({ default: () => function Palette(p: Record<string, unknown>) { const [M, setM] = React.useState<React.ComponentType<Record<string, unknown>> | null>(null); React.useEffect(() => void import("./palette/CommandPalette").then((m) => setM(() => m.CommandPalette as unknown as React.ComponentType<Record<string, unknown>>)), []); return M ? <M {...p} /> : null; } }));

import * as React from "react";

import { paletteNames } from "./palette/names";
import { TopBar } from "./TopBar";
import { ASK_EVENT } from "./today/ask/ask-event";

const T = "11111111-1111-4111-8111-111111111111";
const memberships = [{ id: T, name: "Lakshmi Silks", slug: "lakshmi", role: "owner" as const }];
const PALETTE = paletteNames("en");
afterEach(cleanup);

describe("the top bar (sidebar v2)", () => {
  it("a workspace has 'Search or ask anything ⌘K', which opens the command palette (never the assistant on its own)", async () => {
    const heard = vi.fn();
    window.addEventListener(ASK_EVENT, heard);
    render(<TopBar memberships={memberships} labels={undefined} email="o@example.com" signOut={async () => undefined} mark={null} palette={PALETTE}>{null}</TopBar>);
    await waitFor(() => expect(document.querySelector('[data-top="search"]')).not.toBeNull());
    fireEvent.click(document.querySelector('[data-top="search"]')!);
    await waitFor(() => expect(screen.getByRole("combobox")).toHaveFocus());
    expect(heard).not.toHaveBeenCalled();
    fireEvent.keyDown(screen.getByRole("combobox"), { key: "Escape" });
    expect(screen.queryByRole("combobox")).toBeNull();
    window.removeEventListener(ASK_EVENT, heard);
  });
  it("Ctrl+K and Cmd+K open and close it anywhere", async () => {
    render(<TopBar memberships={memberships} labels={undefined} email="o@example.com" signOut={async () => undefined} mark={null} palette={PALETTE}>{null}</TopBar>);
    await waitFor(() => expect(document.querySelector('[data-top="search"]')).not.toBeNull());
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    expect(await screen.findByRole("combobox")).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "k", metaKey: true });
    await waitFor(() => expect(screen.queryByRole("combobox")).toBeNull());
  });
  it("without the palette's words (a frame drawn without them) there is no search button", () => {
    render(<TopBar memberships={memberships} labels={undefined} email={null} signOut={async () => undefined} mark={null}>{null}</TopBar>);
    expect(screen.queryByRole("button", { name: /Search or ask anything/ })).toBeNull();
  });
  it("is solid at the top of the page and frosted once the page scrolls under it", async () => {
    render(<TopBar memberships={memberships} labels={undefined} email={null} signOut={async () => undefined} mark={null} palette={PALETTE}>{null}</TopBar>);
    await waitFor(() => expect(document.querySelector('[data-top="search"]')).not.toBeNull());
    const bar = screen.getByRole("banner");
    expect(bar).toHaveAttribute("data-scrolled", "false");
    expect(bar.className).not.toContain("v2-glass");
    act(() => {
      Object.defineProperty(window, "scrollY", { value: 120, configurable: true });
      window.dispatchEvent(new Event("scroll"));
    });
    expect(bar).toHaveAttribute("data-scrolled", "true");
    expect(bar.className).toContain("v2-glass");
    Object.defineProperty(window, "scrollY", { value: 0, configurable: true });
  });
});
