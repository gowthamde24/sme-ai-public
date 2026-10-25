import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const nav = { pathname: "/app/tenants/t-1/orders" };
vi.mock("next/navigation", () => ({ usePathname: () => nav.pathname, useRouter: () => ({ push: () => undefined, refresh: () => undefined }) }));

import { ASK_WORD_KEYS } from "./ask-words";
import { AskDock, dockScreen } from "./AskDock";

const BASE = "/app/tenants/t-1";
const words = Object.fromEntries(ASK_WORD_KEYS.map((k) => [k, k === "ask.placeholder.hero" ? "Ask Vijaya anything" : k === "ask.label" ? "Your question" : `[${k}]`]));

beforeEach(() => {
  nav.pathname = `${BASE}/orders`;
  vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());

describe("which screens get the dock", () => {
  it("the list screens of the menu, one level under the workspace", () => {
    for (const s of ["quotes", "orders", "outbox", "visits", "report", "customers", "campaigns", "office"]) expect(dockScreen(`${BASE}/${s}`, BASE), s).toBe(true);
  });
  it("not Today (its own card has the line), not settings or help, not a form or a single record, not the live call, not another workspace", () => {
    for (const p of [BASE, `${BASE}/`, `${BASE}/settings`, `${BASE}/help`, `${BASE}/plans`, `${BASE}/quotes/new`, `${BASE}/orders/abc`, `${BASE}/office/live`, `${BASE}x/orders`, "/app/tenants/t-2/orders", "/login"]) expect(dockScreen(p, BASE), p).toBe(false);
    expect(dockScreen(null, BASE)).toBe(false);
  });
});

describe("the Ask dock", () => {
  it("draws the bar at once, with nothing to press, and the real question line (the component of Today) when the page is idle", async () => {
    render(<AskDock lang="en" base={BASE} words={words} />);
    const waiting = document.querySelector("[data-dock='waiting']");
    expect(waiting).not.toBeNull();
    expect(waiting).toHaveAttribute("aria-hidden", "true");
    expect(waiting!.querySelector("button, input")).toBeNull();
    expect(waiting).toHaveTextContent("Ask Vijaya anything");
    await act(async () => void vi.advanceTimersByTime(1500));
    vi.useRealTimers();
    expect(await screen.findByLabelText("Your question")).toBeInTheDocument();
    expect(document.querySelector("[data-dock='waiting']")).toBeNull();
    expect(screen.queryByText(/ask\.can\.button/)).toBeNull(); // no "What can it do?" card under the line
  });

  it("keeps room under the last row of the page, and draws nothing on Today", () => {
    const { container, rerender } = render(<AskDock lang="en" base={BASE} words={words} />);
    expect(container.querySelector("[data-dock='room']")).not.toBeNull();
    nav.pathname = BASE;
    rerender(<AskDock lang="en" base={BASE} words={words} />);
    expect(container).toBeEmptyDOMElement();
  });
});
