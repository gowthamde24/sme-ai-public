import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const nav = { pathname: "/app/tenants/22222222-2222-2222-2222-222222222222/leads" };
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ usePathname: () => nav.pathname, useSearchParams: () => new URLSearchParams(), useRouter: () => ({ refresh }) }));

import { appT } from "@/i18n/app";

import { AskCard } from "./AskCard";
import { AskProvider } from "./AskProvider";
import { ASK_WORD_KEYS } from "./ask-words";
import type { TurnOn } from "./ask-turn-on";

const BASE = "/app/tenants/22222222-2222-2222-2222-222222222222";
const en = appT("en");
const WORDS = Object.fromEntries(ASK_WORD_KEYS.map((k) => [k, en(k as "frame.notyet")]));

const harness = (turnOn: TurnOn | null, availability: "switched_off" | "not_available" = "switched_off") => (
  <AskProvider lang="en" base={BASE} words={WORDS} availability={availability} turnOn={turnOn}>
    {nav.pathname === BASE ? <AskCard lang="en" base={BASE} availability={availability} words={WORDS} chips={[]} onMood={() => undefined} /> : null}
  </AskProvider>
);

beforeEach(() => {
  vi.clearAllMocks();
  nav.pathname = BASE;
});
afterEach(cleanup);

describe("the assistant is switched off (first run): the line is where it will be, with the reason and one button", () => {
  it("Today's card draws the line, the microphone and Send (not pressable), says why, and the Owner or an Admin can turn it on", async () => {
    const turnOn = vi.fn<TurnOn>(async () => ({ ok: true, live: true }));
    render(harness(turnOn));
    const off = document.querySelector('[data-ask="off"]') as HTMLElement;
    expect(off).toHaveAttribute("data-ask-where", "card");
    expect(within(off).getByText("Your assistant is switched off for your workspace. Turn it on and you can type or speak here.")).toBeInTheDocument();
    expect(off.querySelector("input, textarea")).toBeNull(); // nothing to type into until it is on: no field that takes words and loses them
    expect(within(off).queryByRole("alert")).toBeNull();
    fireEvent.click(within(off).getByRole("button", { name: "Turn on your assistant" }));
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    expect(turnOn).toHaveBeenCalledTimes(1);
  });
  it("says so when the workspace's switch is on but the system's is off, and when it could not be turned on; nothing is refreshed", async () => {
    render(harness(async () => ({ ok: true, live: false })));
    fireEvent.click(screen.getByRole("button", { name: "Turn on your assistant" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("switched off for the whole system right now");
    cleanup();
    render(harness(async () => ({ ok: false })));
    fireEvent.click(screen.getByRole("button", { name: "Turn on your assistant" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not turn it on. Try again.");
    expect(refresh).not.toHaveBeenCalled();
  });
  it("someone who may not turn it on is told whom to ask and has no button", () => {
    render(harness(null));
    expect(screen.queryByRole("button", { name: "Turn on your assistant" })).toBeNull();
    expect(screen.getByText("Only the Owner or an Admin can turn your assistant on. Ask them to do it.")).toBeInTheDocument();
  });
  it("a screen other than Today has the orb, which opens a dialog with the same line and button; Esc returns to the orb", async () => {
    nav.pathname = `${BASE}/leads`;
    const turnOn = vi.fn<TurnOn>(async () => ({ ok: true, live: true }));
    render(harness(turnOn));
    const orb = await screen.findByRole("button", { name: "Ask your assistant" }); // the orb is a chunk of its own
    expect(orb).toHaveAttribute("data-ask-off", "true");
    fireEvent.click(orb);
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText(/Your assistant is switched off for your workspace/)).toBeInTheDocument();
    await act(async () => void fireEvent.click(within(dialog).getByRole("button", { name: "Turn on your assistant" })));
    expect(turnOn).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(dialog.parentElement!, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });
  it("a system that has no assistant at all (not available) draws neither the line nor the orb", () => {
    nav.pathname = `${BASE}/leads`;
    render(harness(null, "not_available"));
    expect(screen.queryByRole("button", { name: "Ask your assistant" })).toBeNull();
    nav.pathname = BASE;
    cleanup();
    render(harness(null, "not_available"));
    expect(document.querySelector('[data-ask="off"]')).toBeNull();
    expect(screen.getByText("Not available yet")).toBeInTheDocument();
  });
});
