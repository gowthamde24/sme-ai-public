import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const live = vi.hoisted(() => ({ state: { calls: [] as unknown[], at: 0, status: "ok" } }));
vi.mock("./live-calls-store", () => ({ useLiveCalls: () => live.state }));

import type { LiveCall } from "@/lib/live-calls/model";

import { LiveBar, LiveIsland, LivePing } from "./LiveCallBar";

const T = "11111111-1111-4111-8111-111111111111";
const call = (n: number, o: Partial<LiveCall> = {}): LiveCall => ({ id: `33333333-3333-4333-8333-33333333333${n}`, who: "Lakshmi", named: true, elapsedS: 4, answered: true, source: "indiamart", canTakeOver: true, ...o });
const set = (calls: LiveCall[]) => (live.state = { calls, at: Date.now(), status: "ok" });
const labels = { "frame.live.bar.one": "Priya is on a call with {who}" };

beforeEach(() => {
  vi.useFakeTimers();
  set([]);
  localStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("the desktop live bar", () => {
  it("draws nothing while no call is live", () => {
    const { container } = render(<LiveBar tenantId={T} enabled />);
    expect(container).toBeEmptyDOMElement();
  });
  it("one call: who, where from, a clock that counts on, Read along and Take over; the words open the call", () => {
    set([call(1)]);
    render(<LiveBar tenantId={T} labels={labels} enabled />);
    const bar = screen.getByRole("status");
    expect(bar).toHaveTextContent("Priya is on a call with Lakshmi · IndiaMART");
    expect(bar).toHaveTextContent("00:04");
    expect(screen.getByRole("link", { name: "Read along" })).toHaveAttribute("href", `/app/tenants/${T}/calls/${call(1).id}`);
    expect(screen.getByRole("link", { name: "Take over" })).toBeInTheDocument();
    act(() => void vi.advanceTimersByTime(3000));
    expect(bar).toHaveTextContent("00:07");
  });
  it("no Take over unless the API supports it for that call: only Read along", () => {
    set([call(1, { canTakeOver: false, source: null })]);
    render(<LiveBar tenantId={T} labels={labels} enabled />);
    expect(screen.queryByRole("link", { name: "Take over" })).toBeNull();
    expect(screen.getByRole("link", { name: "Read along" })).toBeInTheDocument();
    expect(screen.getByRole("status")).not.toHaveTextContent("·");
  });
  it("a caller with no name is shown as the API says it: Caller ending 998", () => {
    set([call(1, { who: "Caller ending 998", named: false, source: null })]);
    render(<LiveBar tenantId={T} labels={labels} enabled />);
    expect(screen.getByRole("status")).toHaveTextContent("Priya is on a call with Caller ending 998");
  });
  it("two or more calls: '2 calls live', and it opens the Calls list", () => {
    set([call(1), call(2)]);
    render(<LiveBar tenantId={T} enabled />);
    expect(screen.getByRole("status")).toHaveTextContent("2 calls live");
    expect(screen.getByRole("link", { name: "Open calls" })).toHaveAttribute("href", `/app/tenants/${T}/calls`);
    expect(screen.queryByRole("link", { name: "Take over" })).toBeNull();
  });
  it("the sentence is the language's own words, with the source word of that language", () => {
    set([call(1)]);
    render(<LiveBar tenantId={T} labels={{ "frame.live.bar.one": "{who} తో కాల్‌లో ఉంది", "frame.live.src.indiamart": "ఇండియామార్ట్" }} enabled />);
    expect(screen.getByRole("status")).toHaveTextContent("Lakshmi తో కాల్‌లో ఉంది · ఇండియామార్ట్");
  });
});

describe("the phone's pill", () => {
  it("On a call · name, the clock and a headphones button; the whole pill opens the call", () => {
    set([call(1)]);
    render(<LiveIsland tenantId={T} enabled />);
    const pill = screen.getByRole("status");
    expect(pill).toHaveTextContent("On a call · Lakshmi");
    expect(pill).toHaveTextContent("00:04");
    expect(pill).toHaveAttribute("href", `/app/tenants/${T}/calls/${call(1).id}`);
    expect(pill).toHaveTextContent("Read along");
  });
  it("two calls: the pill says so and opens the list", () => {
    set([call(1), call(2)]);
    render(<LiveIsland tenantId={T} enabled />);
    expect(screen.getByRole("status")).toHaveAttribute("href", `/app/tenants/${T}/calls`);
    expect(screen.getByRole("status")).toHaveTextContent("2 calls live");
  });
  it("draws nothing while no call is live", () => {
    const { container } = render(<LiveIsland tenantId={T} enabled />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("the notification", () => {
  const shown = vi.fn();
  const NotificationMock = Object.assign(vi.fn(), { permission: "granted" as NotificationPermission, requestPermission: vi.fn(async () => "granted" as NotificationPermission) });
  beforeEach(() => {
    shown.mockReset();
    NotificationMock.permission = "granted";
    NotificationMock.requestPermission.mockClear();
    vi.stubGlobal("Notification", NotificationMock);
    vi.stubGlobal("navigator", { ...navigator, serviceWorker: { getRegistration: async () => ({ showNotification: shown }) } });
  });
  const flush = () => act(async () => void (await vi.advanceTimersByTimeAsync(5)));

  it("a new call is said once, with the name, the source and two buttons, and no phone number", async () => {
    localStorage.setItem("sme-notify-calls", "on");
    set([]);
    const { rerender } = render(<LivePing tenantId={T} labels={labels} enabled />);
    live.state = { calls: [call(1, { elapsedS: 2 })], at: Date.now(), status: "ok" };
    rerender(<LivePing tenantId={T} labels={labels} enabled />);
    await flush();
    rerender(<LivePing tenantId={T} labels={labels} enabled />);
    await flush();
    expect(shown).toHaveBeenCalledTimes(1);
    const [title, options] = shown.mock.calls[0] as [string, { body: string; actions: { action: string }[]; data: { url: string } }];
    expect(title).toBe("Live call");
    expect(options.body).toBe("Priya is on a call with Lakshmi (IndiaMART)");
    expect(options.actions.map((a) => a.action)).toEqual(["read", "takeover"]);
    expect(options.data.url).toBe(`/app/tenants/${T}/calls/${call(1).id}`);
    expect(options.body).not.toMatch(/\d{5,}/);
  });
  it("a caller with no name is 'a new caller' in the notification: never the number or the ending", async () => {
    localStorage.setItem("sme-notify-calls", "on");
    set([call(1, { who: "Caller ending 998", named: false, elapsedS: 1 })]);
    render(<LivePing tenantId={T} enabled />);
    await flush();
    expect(shown).toHaveBeenCalledTimes(1);
    expect((shown.mock.calls[0][1] as { body: string }).body).toBe("{assistant} is on a call with a new caller (IndiaMART)".replace("{assistant}", "your assistant"));
  });
  it("Sales is offered only Read along", async () => {
    localStorage.setItem("sme-notify-calls", "on");
    set([call(1, { canTakeOver: false, elapsedS: 1 })]);
    render(<LivePing tenantId={T} enabled />);
    await flush();
    expect((shown.mock.calls[0][1] as { actions: { action: string }[] }).actions.map((a) => a.action)).toEqual(["read"]);
  });
  it("a call already running when the page opened is not announced, and neither is anything while the switch is off", async () => {
    localStorage.setItem("sme-notify-calls", "on");
    set([call(1, { elapsedS: 300 })]);
    render(<LivePing tenantId={T} enabled />);
    await flush();
    expect(shown).not.toHaveBeenCalled();
    cleanup();
    localStorage.setItem("sme-notify-calls", "off");
    set([call(2, { elapsedS: 1 })]);
    render(<LivePing tenantId={T} enabled />);
    await flush();
    expect(shown).not.toHaveBeenCalled();
  });
  it("another tab that already said it keeps this one quiet", async () => {
    localStorage.setItem("sme-notify-calls", "on");
    localStorage.setItem("sme-notify-calls-seen", JSON.stringify([call(1).id]));
    set([call(1, { elapsedS: 1 })]);
    render(<LivePing tenantId={T} enabled />);
    await flush();
    expect(shown).not.toHaveBeenCalled();
  });
  it("the first question is a friendly card, shown only while a call is live and the browser has not been asked; Yes asks the browser, Not now turns it off", async () => {
    NotificationMock.permission = "default";
    NotificationMock.requestPermission.mockImplementation(async () => {
      NotificationMock.permission = "granted";
      return "granted";
    });
    set([call(1)]);
    render(<LivePing tenantId={T} enabled />);
    await flush();
    expect(screen.getByRole("dialog")).toHaveTextContent("Get a notification when a call starts?");
    expect(screen.getByRole("dialog")).toHaveTextContent("Never a phone number");
    expect(NotificationMock.requestPermission).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Yes, tell me" }));
    await flush();
    expect(NotificationMock.requestPermission).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem("sme-notify-calls")).toBe("on");
    expect(screen.queryByRole("dialog")).toBeNull();
  });
  it("Not now remembers the answer", async () => {
    NotificationMock.permission = "default";
    set([call(1)]);
    render(<LivePing tenantId={T} enabled />);
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "Not now" }));
    await flush();
    expect(localStorage.getItem("sme-notify-calls")).toBe("off");
    expect(screen.queryByRole("dialog")).toBeNull();
  });
  it("no question without a live call, and none where the browser cannot or will not", async () => {
    NotificationMock.permission = "default";
    set([]);
    const { rerender } = render(<LivePing tenantId={T} enabled />);
    await flush();
    expect(screen.queryByRole("dialog")).toBeNull();
    NotificationMock.permission = "denied";
    set([call(1)]);
    rerender(<LivePing tenantId={T} enabled />);
    await flush();
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
