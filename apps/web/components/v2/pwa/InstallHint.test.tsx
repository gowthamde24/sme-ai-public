import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SHORT_NAME } from "@/design/brand";
import { HINT_KEY, NEW_VISIT_AFTER_MS, SNOOZE_MS } from "@/lib/pwa/install-hint";

import { InstallHint } from "./InstallHint";

function env({ phone = true, standalone = false, ua = "Mozilla/5.0 (Linux; Android 14) Chrome/130 Mobile" } = {}) {
  vi.stubGlobal(
    "matchMedia",
    (q: string) => ({ matches: q.includes("max-width") ? phone : q.includes("pointer: coarse") ? phone : q.includes("display-mode") ? standalone : false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }),
  );
  Object.defineProperty(window.navigator, "userAgent", { value: ua, configurable: true });
}
const seed = (visits: number, extra: object = {}) => window.localStorage.setItem(HINT_KEY, JSON.stringify({ visits, last: Date.now() - 2 * NEW_VISIT_AFTER_MS, closedAt: null, installed: false, ...extra }));

beforeEach(() => {
  window.localStorage.clear();
  env();
});
afterEach(() => vi.unstubAllGlobals());

describe("InstallHint", () => {
  it("is quiet on the first two visits and shows from the third", () => {
    seed(0);
    const first = render(<InstallHint />);
    expect(screen.queryByRole("region")).toBeNull();
    first.unmount();
    seed(2); // this page view is the third visit
    render(<InstallHint />);
    expect(screen.getByRole("region", { name: "Add to home screen" })).toBeInTheDocument();
    expect(screen.getByText(`Add ${SHORT_NAME} to your home screen`)).toBeInTheDocument();
  });
  it("is not shown on a desktop or in the installed app", () => {
    seed(5);
    env({ phone: false });
    const a = render(<InstallHint />);
    expect(screen.queryByRole("region")).toBeNull();
    a.unmount();
    env({ standalone: true });
    render(<InstallHint />);
    expect(screen.queryByRole("region")).toBeNull();
  });
  it("'Not now' hides it and keeps it away for 30 days", () => {
    seed(4);
    const { unmount } = render(<InstallHint />);
    fireEvent.click(screen.getAllByRole("button", { name: "Not now" })[0]);
    expect(screen.queryByRole("region")).toBeNull();
    const stored = JSON.parse(window.localStorage.getItem(HINT_KEY)!);
    expect(stored.closedAt).toBeGreaterThan(Date.now() - 5000);
    unmount();
    const again = render(<InstallHint />);
    expect(screen.queryByRole("region")).toBeNull();
    again.unmount();
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + SNOOZE_MS + 1000);
    window.localStorage.setItem(HINT_KEY, JSON.stringify({ ...stored, last: 0 }));
    render(<InstallHint />);
    expect(screen.getByRole("region")).toBeInTheDocument();
    vi.useRealTimers();
  });
  it("on Safari for iPhone it says Share, then Add to Home Screen; it has no Add button", () => {
    seed(3);
    env({ ua: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit Safari/604.1" });
    render(<InstallHint />);
    expect(screen.getByText(/Tap Share, then Add to Home Screen/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add" })).toBeNull();
  });
  it("where the browser offers its install sheet, 'Add' opens it", async () => {
    seed(3);
    render(<InstallHint />);
    const prompt = vi.fn().mockResolvedValue(undefined);
    const event = Object.assign(new Event("beforeinstallprompt", { cancelable: true }), { prompt, userChoice: Promise.resolve({ outcome: "accepted" }) });
    act(() => {
      window.dispatchEvent(event);
    });
    expect(event.defaultPrevented).toBe(true);
    await act(async () => {
      fireEvent.click(await screen.findByRole("button", { name: "Add" }));
    });
    expect(prompt).toHaveBeenCalled();
    expect(JSON.parse(window.localStorage.getItem(HINT_KEY)!).installed).toBe(true);
    expect(screen.queryByRole("region")).toBeNull();
  });
  it("still works when browser storage is blocked", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(() => render(<InstallHint />)).not.toThrow();
    vi.restoreAllMocks();
  });
});
