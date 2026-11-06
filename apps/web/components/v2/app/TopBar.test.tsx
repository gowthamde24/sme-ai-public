import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ usePathname: () => "/app/tenants/11111111-1111-4111-8111-111111111111", useRouter: () => ({ refresh: () => undefined, push: () => undefined }), useSearchParams: () => new URLSearchParams() }));
vi.mock("./notify/NotificationBell", () => ({ NotificationBell: () => null }));
vi.mock("./help/HelpButton", () => ({ HelpButton: () => null }));

vi.mock("./LazyTopSearch", async () => ({ TopSearch: (await import("./TopSearch")).TopSearch }));

import { TopBar } from "./TopBar";
import { ASK_EVENT } from "./today/ask/ask-event";

const T = "11111111-1111-4111-8111-111111111111";
const memberships = [{ id: T, name: "Lakshmi Silks", slug: "lakshmi", role: "owner" as const }];
afterEach(cleanup);

describe("the top bar (sidebar v2)", () => {
  it("a workspace has 'Search or ask anything ⌘K', which asks the floating Ask like the keys do", () => {
    const heard = vi.fn();
    window.addEventListener(ASK_EVENT, heard);
    render(<TopBar memberships={memberships} labels={undefined} email={null} signOut={async () => undefined} mark={null}>{null}</TopBar>);
    fireEvent.click(screen.getByRole("button", { name: /Search or ask anything/ }));
    expect(heard).toHaveBeenCalledTimes(1);
    window.removeEventListener(ASK_EVENT, heard);
  });
  it("is solid at the top of the page and frosted once the page scrolls under it", () => {
    render(<TopBar memberships={memberships} labels={undefined} email={null} signOut={async () => undefined} mark={null}>{null}</TopBar>);
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
