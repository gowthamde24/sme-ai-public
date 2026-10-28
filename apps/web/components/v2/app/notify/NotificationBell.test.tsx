import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const nav = { pathname: "/app/tenants/22222222-2222-2222-2222-222222222222" };
const push = vi.fn();
vi.mock("next/navigation", () => ({ usePathname: () => nav.pathname, useRouter: () => ({ push }) }));

import { NotificationBell } from "./NotificationBell";
import { seenKey } from "./device";

const T = "22222222-2222-2222-2222-222222222222";
const BASE = `/app/tenants/${T}`;
const NOW = Date.parse("2026-10-12T10:00:00Z");
const item = (id: string, code: string, who = "Asha", href = `${BASE}#needs-you`) => ({ id, code, who, at: "2026-10-12T09:30:00Z", href });

let answer: () => Promise<Response>;
const fetchMock = vi.fn();
function json(items: unknown[], status = 200) {
  return () => Promise.resolve(new Response(JSON.stringify({ items }), { status }));
}
function setHidden(hidden: boolean) {
  Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => (hidden ? "hidden" : "visible") });
  document.dispatchEvent(new Event("visibilitychange"));
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ["setTimeout", "clearTimeout", "Date"] });
  vi.setSystemTime(NOW);
  window.localStorage.clear();
  fetchMock.mockReset().mockImplementation(() => answer());
  vi.stubGlobal("fetch", fetchMock);
  setHidden(false);
  answer = json([item("a", "outbox_approval"), item("b", "visit_here", "Ravi", `${BASE}/visits?visit=b`)]);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const bell = () => document.querySelector<HTMLButtonElement>('[data-notify="bell"]')!;
async function ready() {
  render(
    <div data-ui="v2">
      <NotificationBell tenantId={T} />
    </div>,
  );
  await waitFor(() => expect(fetchMock).toHaveBeenCalled());
  await act(async () => {
    await Promise.resolve();
  });
}

describe("NotificationBell", () => {
  it("shows how many are new on this device, as a name for screen readers and a number for the eye", async () => {
    await ready();
    await waitFor(() => expect(bell()).toHaveAccessibleName("Notifications, 2 new"));
    expect(bell().querySelector('[data-notify="count"]')).toHaveTextContent("2");
    expect(fetchMock).toHaveBeenCalledWith(`${BASE}/notifications`, expect.objectContaining({ cache: "no-store" }));
  });
  it("opens a panel of links to the pages that decide each thing, marks them New, and counts them seen", async () => {
    await ready();
    await waitFor(() => expect(bell()).toHaveAccessibleName("Notifications, 2 new"));
    fireEvent.click(bell());
    const panel = screen.getByRole("region", { name: "Notifications" });
    expect(bell()).toHaveAttribute("aria-expanded", "true");
    expect(panel.closest('[data-ui="v2"]')).not.toBeNull(); // inside the v2 theme, not a fixed child of the blurred bar
    const links = within(panel).getAllByRole("link");
    expect(links.map((l) => l.getAttribute("href"))).toEqual([`${BASE}#needs-you`, `${BASE}/visits?visit=b`]);
    expect(within(panel).getAllByText("New")).toHaveLength(2);
    await waitFor(() => expect(bell()).toHaveAccessibleName("Notifications"));
    expect(JSON.parse(window.localStorage.getItem(seenKey(T))!)).toEqual(["a", "b"]);
  });
  it("unread is per device: what this device has shown is not new again, and another workspace's list is separate", async () => {
    window.localStorage.setItem(seenKey(T), JSON.stringify(["a"]));
    await ready();
    await waitFor(() => expect(bell()).toHaveAccessibleName("Notifications, 1 new"));
    expect(window.localStorage.getItem(seenKey("someone-else"))).toBeNull();
  });
  it("Escape closes the panel and gives the focus back to the bell; so does a tap outside", async () => {
    await ready();
    fireEvent.click(bell());
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("region", { name: "Notifications" })).toBeNull();
    expect(bell()).toHaveFocus();
    fireEvent.click(bell());
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("region", { name: "Notifications" })).toBeNull();
  });
  it("says so when there is nothing, and when it could not check", async () => {
    answer = json([]);
    await ready();
    fireEvent.click(bell());
    expect(await screen.findByText("Nothing needs you right now.")).toBeInTheDocument();
    cleanup();
    answer = json([], 500);
    await ready();
    fireEvent.click(bell());
    expect(await screen.findByText(/Could not check just now/)).toBeInTheDocument();
  });
  it("a rejected session stops the asking and says to sign in again", async () => {
    answer = json([], 401);
    await ready();
    fireEvent.click(bell());
    expect(await screen.findByText(/Your session has ended/)).toBeInTheDocument();
    const calls = fetchMock.mock.calls.length;
    await act(async () => {
      vi.advanceTimersByTime(10 * 60_000);
    });
    expect(fetchMock.mock.calls.length).toBe(calls);
  });
  it("asks again every minute while the tab is in front, and not at all while it is hidden", async () => {
    await ready();
    const first = fetchMock.mock.calls.length;
    await act(async () => {
      vi.advanceTimersByTime(70_000);
    });
    await waitFor(() => expect(fetchMock.mock.calls.length).toBe(first + 1));
    act(() => setHidden(true));
    const hiddenAt = fetchMock.mock.calls.length;
    await act(async () => {
      vi.advanceTimersByTime(30 * 60_000);
    });
    expect(fetchMock.mock.calls.length).toBe(hiddenAt);
    // back in front after a long while: it asks at once
    await act(async () => {
      setHidden(false);
    });
    await waitFor(() => expect(fetchMock.mock.calls.length).toBe(hiddenAt + 1));
  });
  it("backs off after a failure instead of asking every minute", async () => {
    answer = () => Promise.reject(new Error("offline"));
    await ready();
    const first = fetchMock.mock.calls.length;
    await act(async () => {
      vi.advanceTimersByTime(70_000);
    });
    expect(fetchMock.mock.calls.length).toBe(first); // the wait after one failure is two minutes
    await act(async () => {
      vi.advanceTimersByTime(70_000);
    });
    await waitFor(() => expect(fetchMock.mock.calls.length).toBe(first + 1));
  });
  it("browser notifications are off until asked: the switch is off, and nothing pops up", async () => {
    const Ctor = vi.fn();
    vi.stubGlobal("Notification", Object.assign(Ctor, { permission: "default", requestPermission: vi.fn().mockResolvedValue("default") }));
    await ready();
    fireEvent.click(bell());
    const sw = screen.getByRole("switch");
    expect(sw).toHaveAttribute("aria-checked", "false");
    expect(Ctor).not.toHaveBeenCalled();
  });
  it("turning them on asks the browser, remembers on this device, and does not announce what is already waiting", async () => {
    const Ctor = vi.fn();
    vi.stubGlobal("Notification", Object.assign(Ctor, { permission: "default", requestPermission: vi.fn().mockImplementation(async () => { (Notification as unknown as { permission: string }).permission = "granted"; return "granted"; }) }));
    await ready();
    fireEvent.click(bell());
    await act(async () => {
      fireEvent.click(screen.getByRole("switch"));
    });
    expect(window.localStorage.getItem("sme-notify-browser")).toBe("on");
    expect(JSON.parse(window.localStorage.getItem(`sme-notify-announced:${T}`)!)).toEqual(["a"]);
    expect(Ctor).not.toHaveBeenCalled();
  });
  it("when they are on and the tab is hidden, a NEW 'needs you' pops up as a count only, never a name", async () => {
    const Ctor = vi.fn();
    vi.stubGlobal("Notification", Object.assign(Ctor, { permission: "granted", requestPermission: vi.fn() }));
    window.localStorage.setItem("sme-notify-browser", "on");
    window.localStorage.setItem(`sme-notify-announced:${T}`, JSON.stringify(["a"]));
    answer = json([item("a", "outbox_approval", "Asha"), item("c", "quote_approval", "Secret Name"), item("d", "visit_here", "Ravi")]);
    setHidden(true); // opted in: the first look still happens while hidden
    await ready();
    await waitFor(() => expect(Ctor).toHaveBeenCalledTimes(1));
    expect(Ctor).toHaveBeenCalledWith("Your assistant", expect.objectContaining({ body: "1 thing needs you." }));
    expect(JSON.stringify(Ctor.mock.calls)).not.toMatch(/Secret Name|Asha|Ravi/);
    const popup = Ctor.mock.instances[0] as { onclick: () => void; close: () => void };
    popup.close = vi.fn();
    popup.onclick();
    expect(push).toHaveBeenCalledWith(`${BASE}#needs-you`);
  });
  it("a browser that has blocked them, or cannot show them, says so instead of a switch", async () => {
    vi.stubGlobal("Notification", Object.assign(vi.fn(), { permission: "denied", requestPermission: vi.fn() }));
    await ready();
    fireEvent.click(bell());
    expect(screen.queryByRole("switch")).toBeNull();
    expect(screen.getByText(/blocked in this browser/)).toBeInTheDocument();
  });
  it("works with storage blocked: everything is new, nothing throws", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    await ready();
    await waitFor(() => expect(bell()).toHaveAccessibleName("Notifications, 2 new"));
    fireEvent.click(bell());
    expect(screen.getAllByRole("link")).toHaveLength(2);
  });
  it("a new page closes the panel", async () => {
    const { rerender } = render(
      <div data-ui="v2">
        <NotificationBell tenantId={T} />
      </div>,
    );
    await act(async () => {
      await Promise.resolve();
    });
    fireEvent.click(document.querySelector('[data-notify="bell"]')!);
    expect(screen.getByRole("region", { name: "Notifications" })).toBeInTheDocument();
    nav.pathname = `${BASE}/orders`;
    rerender(
      <div data-ui="v2">
        <NotificationBell tenantId={T} />
      </div>,
    );
    expect(screen.queryByRole("region", { name: "Notifications" })).toBeNull();
  });
});
