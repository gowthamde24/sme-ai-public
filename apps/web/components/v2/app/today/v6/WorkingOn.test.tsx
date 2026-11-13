import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const doIt = vi.hoisted(() => ({ actions: null as null | Record<string, unknown> }));
vi.mock("../ask/ask-store", () => ({ useStoredAsk: () => ({ doIt: doIt.actions ? { actions: doIt.actions } : null }) }));

import { appDict } from "@/i18n/app";

import type { Working } from "./lower-data";
import WorkingOn from "./WorkingOn";

const WORDS = Object.fromEntries(Object.entries(appDict("en") as Record<string, string>).filter(([k]) => k.startsWith("tv6.")));
const WORKING: Working = { id: "t1", title: "Call back last week's 9 enquiries who didn't visit", status: "running", approvedAt: "2026-11-13T03:35:00Z", steps: [{ id: "picked", state: "done", n: 9, extra: 0, hoursTo: null }, { id: "called", state: "done", n: 5, extra: 2, hoursTo: null }, { id: "calling", state: "now", n: 4, extra: 0, hoursTo: "8 pm" }, { id: "report", state: "later", n: 0, extra: 0, hoursTo: null }] };

afterEach(() => {
  cleanup();
  doIt.actions = null;
});

describe("'Your assistant is working on' (the approved mock)", () => {
  it("shows the job, 'You approved · 9:05' and the steps with ticks (done, now, later)", () => {
    render(<WorkingOn working={WORKING} time="9:05" words={WORDS} />);
    expect(screen.getByRole("heading", { name: "Your assistant is working on" })).toBeInTheDocument();
    expect(screen.getByText("Call back last week's 9 enquiries who didn't visit")).toBeInTheDocument();
    expect(screen.getByText("You approved · 9:05")).toBeInTheDocument();
    const steps = [...document.querySelectorAll('[data-part="work-steps"] li')];
    expect(steps.map((s) => s.getAttribute("data-step-state"))).toEqual(["done", "done", "now", "later"]);
    expect(steps.map((s) => s.lastElementChild?.textContent)).toEqual(["Picked 9 people", "Called 5 · 2 interested", "Calling the other 4 (calling hours till 8 pm)", "Report to you when done"]);
    expect(steps[0].querySelector("svg")).not.toBeNull(); // the tick
  });

  it("Pause is the task's own move, and becomes Resume (and back)", async () => {
    const pause = vi.fn(async () => ({ ok: true, task: { status: "paused" } }));
    const resume = vi.fn(async () => ({ ok: true, task: { status: "running" } }));
    doIt.actions = { pause, resume };
    render(<WorkingOn working={WORKING} time="9:05" words={WORDS} />);
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Resume" })).toBeInTheDocument());
    expect(pause).toHaveBeenCalledWith("t1");
    expect(screen.getByText("Paused")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Resume" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Pause" })).toBeInTheDocument());
    expect(resume).toHaveBeenCalledWith("t1");
  });

  it("Pause is off where the conversation has no plan actions", () => {
    render(<WorkingOn working={WORKING} time={null} words={WORDS} />);
    expect(screen.getByRole("button", { name: "Pause" })).toBeDisabled();
    expect(screen.getByText("You approved")).toBeInTheDocument();
  });

  it("Undo last step is a preview on staging and says so", () => {
    render(<WorkingOn working={WORKING} time="9:05" words={WORDS} />);
    fireEvent.click(screen.getByRole("button", { name: "Undo last step" }));
    expect(screen.getByRole("status")).toHaveTextContent("Preview: undoing a step comes with the step log");
  });

  it("with no job running says so, with the next step", () => {
    const { container } = render(<WorkingOn working={null} time={null} words={WORDS} />);
    expect(within(container).getByText(/Nothing is running/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Pause" })).toBeNull();
  });
});
