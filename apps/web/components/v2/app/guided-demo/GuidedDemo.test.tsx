import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const push = vi.fn();
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh }) }));

import { appDict } from "@/i18n/app";
import { STEP_KEYS, type StepKey, type StepResult } from "@/lib/guided-demo/script";

import { GuidedDemo } from "./GuidedDemo";

const WORDS = Object.fromEntries(Object.entries(appDict("en") as Record<string, string>).filter(([k]) => k.startsWith("gd.")));
const routes = Object.fromEntries(STEP_KEYS.map((k) => [k, `/app/tenants/t/${k}`])) as Record<StepKey, string>;
const good = (over: Partial<Extract<StepResult, { ok: true }>> = {}): StepResult => ({ ok: true, lines: [], sound: null, leadId: null, note: null, ...over });
let run: ReturnType<typeof vi.fn>;
const draw = () => render(<GuidedDemo words={WORDS} routes={routes} actions={{ run: run as never }} />);
const flush = async (ms: number) => void (await act(async () => void (await vi.advanceTimersByTimeAsync(ms))));

beforeEach(() => {
  vi.useFakeTimers();
  push.mockClear();
  refresh.mockClear();
  run = vi.fn(async () => good());
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("the guided demo", () => {
  it("is a Start button; Start runs the first step, opens its real screen and says what it is", async () => {
    draw();
    expect(screen.queryByRole("region")).toBeNull();
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: "Start demo" })));
    expect(run).toHaveBeenCalledWith("lead", expect.stringMatching(/^[0-9a-f-]{36}$/), null);
    expect(push).toHaveBeenCalledWith("/app/tenants/t/lead");
    expect(screen.getByRole("heading", { name: "A new lead arrives" })).toBeInTheDocument();
    expect(screen.getByText("Step 1 of 6")).toBeInTheDocument();
    expect(screen.getByText(/Made-up people and numbers only/)).toBeInTheDocument();
  });
  it("goes on by itself after the caption has been read, and the lead id of one step is given to the next", async () => {
    run.mockResolvedValueOnce(good({ leadId: "33333333-3333-4333-8333-333333333333" }));
    draw();
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: "Start demo" })));
    await flush(7000);
    expect(run.mock.calls[1].slice(0, 1)).toEqual(["reach"]);
    expect(run.mock.calls[1][2]).toBe("33333333-3333-4333-8333-333333333333");
  });
  it("shows the transcript line by line", async () => {
    run.mockResolvedValue(good({ lines: [{ who: "lead", text: "Is it in stock?" }, { who: "assistant", text: "Yes, five pieces." }] }));
    draw();
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: "Start demo" })));
    await flush(10);
    expect(screen.getByText(/Is it in stock\?/)).toBeInTheDocument();
    expect(screen.queryByText(/Yes, five pieces\./)).toBeNull();
    await flush(2000);
    expect(screen.getByText(/Yes, five pieces\./)).toBeInTheDocument();
  });
  it("Pause stops the story where it is, Next and Back move by hand, a step that fails says so and can be skipped", async () => {
    draw();
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: "Start demo" })));
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: "Pause" })));
    await flush(20000);
    expect(run).toHaveBeenCalledTimes(1);
    run.mockResolvedValueOnce({ ok: false });
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: "Next" })));
    expect(screen.getByRole("alert")).toHaveTextContent("could not run just now");
    expect(screen.getByText("Step 2 of 6")).toBeInTheDocument();
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: "Back" })));
    expect(screen.getByText("Step 1 of 6")).toBeInTheDocument();
  });
  it("the last step ends with the closing line and Play again; Close puts the Start button back", async () => {
    draw();
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: "Start demo" })));
    for (let i = 0; i < 6; i++) await act(async () => void fireEvent.click(screen.getByRole("button", { name: "Next" })));
    expect(screen.getByText(/That is the whole story/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Play again" })).toBeInTheDocument();
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: "Close the demo" })));
    expect(screen.getByRole("button", { name: "Start demo" })).toBeInTheDocument();
  });
});
