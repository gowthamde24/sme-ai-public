import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { NotificationsSettings } from "./NotificationsSettings";

const words = { "nset.title": "Notifications", "nset.calls": "Tell me when a call starts", "nset.calls.help": "help", "nset.on": "On", "nset.off": "Off", "nset.note": "note", "nset.state.default": "ask once", "nset.state.granted": "allowed", "nset.state.denied": "blocked", "nset.state.unsupported": "cannot" };
const N = Object.assign(vi.fn(), { permission: "default" as NotificationPermission, requestPermission: vi.fn() });
beforeEach(() => {
  localStorage.clear();
  N.permission = "default";
  N.requestPermission.mockReset().mockImplementation(async () => {
    N.permission = "granted";
    return "granted";
  });
  vi.stubGlobal("Notification", N);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
const tick = () => act(async () => void (await new Promise((r) => setTimeout(r, 0))));

describe("Settings > Notifications", () => {
  it("is off and says the browser will ask once; turning it on asks the browser and remembers", async () => {
    render(<NotificationsSettings words={words} />);
    const sw = screen.getByRole("switch", { name: "Tell me when a call starts" });
    expect(sw).toHaveAttribute("aria-checked", "false");
    expect(screen.getByRole("status")).toHaveTextContent("ask once");
    expect(N.requestPermission).not.toHaveBeenCalled();
    fireEvent.click(sw);
    await tick();
    expect(N.requestPermission).toHaveBeenCalledTimes(1);
    expect(sw).toHaveAttribute("aria-checked", "true");
    expect(localStorage.getItem("sme-notify-calls")).toBe("on");
    expect(screen.getByRole("status")).toHaveTextContent("allowed");
  });
  it("turning it off needs no browser at all", async () => {
    N.permission = "granted";
    localStorage.setItem("sme-notify-calls", "on");
    render(<NotificationsSettings words={words} />);
    await tick();
    const sw = screen.getByRole("switch");
    expect(sw).toHaveAttribute("aria-checked", "true");
    fireEvent.click(sw);
    await tick();
    expect(sw).toHaveAttribute("aria-checked", "false");
    expect(localStorage.getItem("sme-notify-calls")).toBe("off");
    expect(N.requestPermission).not.toHaveBeenCalled();
  });
  it("blocked in the browser: the switch cannot be turned on and the page says what to do", async () => {
    N.permission = "denied";
    render(<NotificationsSettings words={words} />);
    await tick();
    expect(screen.getByRole("switch")).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent("blocked");
  });
  it("a browser with no notifications says so", async () => {
    vi.unstubAllGlobals();
    // @ts-expect-error the test removes the browser's own Notification
    delete globalThis.Notification;
    render(<NotificationsSettings words={words} />);
    await tick();
    expect(screen.getByRole("switch")).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent("cannot");
  });
});

describe("Settings > Notifications: the feel switch (app v4 part 9)", () => {
  it("is hidden where the browser cannot vibrate; where it can, it is on by default, turns off and on, and remembers", async () => {
    render(<NotificationsSettings words={{ ...words, "nset.feel": "Vibrate and play a soft sound", "nset.feel.help": "help" }} />);
    await tick();
    expect(screen.queryByRole("switch", { name: "Vibrate and play a soft sound" })).toBeNull();
    cleanup();
    vi.stubGlobal("navigator", Object.assign(Object.create(navigator), { vibrate: vi.fn(() => true) }));
    render(<NotificationsSettings words={{ ...words, "nset.feel": "Vibrate and play a soft sound", "nset.feel.help": "help" }} />);
    await tick();
    const sw = screen.getByRole("switch", { name: "Vibrate and play a soft sound" });
    expect(sw).toHaveAttribute("aria-checked", "true");
    fireEvent.click(sw);
    await tick();
    expect(sw).toHaveAttribute("aria-checked", "false");
    expect(localStorage.getItem("sme-feel")).toBe("off");
    fireEvent.click(sw);
    await tick();
    expect(sw).toHaveAttribute("aria-checked", "true");
    expect(localStorage.getItem("sme-feel")).toBe("on");
  });
});
