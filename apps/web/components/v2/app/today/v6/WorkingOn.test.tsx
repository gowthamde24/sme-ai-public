import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const doIt = vi.hoisted(() => ({ actions: null as null | Record<string, unknown> }));
vi.mock("../ask/ask-store", () => ({ useStoredAsk: () => ({ doIt: doIt.actions ? { actions: doIt.actions } : null }) }));

import { appDict } from "@/i18n/app";

import type { Working } from "./lower-data";
import WorkingOn from "./WorkingOn";

const WORDS = Object.fromEntries(Object.entries(appDict("en") as Record<string, string>).filter(([k]) => k.startsWith("tv6.")));
const WORKING: Working = { id: "t1", title: "Call back last week's 9 enquiries", status: "running", approvedAt: "2026-11-13T03:35:00Z", total: 9, done: 5, positive: 2, waiting: 4, toMinute: 1200 };

afterEach(() => {
  cleanup();
  doIt.actions = null;
});

describe("'Your assistant is working on' (the final design)", () => {
  it("shows the job, a progress bar and one line: 5 of 9 called · 2 interested · calling hours till 8 pm", () => {
    render(<WorkingOn working={WORKING} words={WORDS} />);
    expect(screen.getByRole("heading", { name: "Your assistant is working on" })).toBeInTheDocument();
    expect(screen.getByText("Call back last week's 9 enquiries")).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "56");
    expect(document.querySelector('[data-part="work-line"]')).toHaveTextContent("5 of 9 called · 2 interested · calling hours till 8 pm");
  });
  it("leaves out the hours when nobody is left to call and the interested when there are none", () => {
    render(<WorkingOn working={{ ...WORKING, done: 9, waiting: 0, positive: 0 }} words={WORDS} />);
    expect(document.querySelector('[data-part="work-line"]')).toHaveTextContent(/^9 of 9 called$/);
  });

  it("Pause is the task's own move, and becomes Resume (and back)", async () => {
    const pause = vi.fn(async () => ({ ok: true, task: { status: "paused" } }));
    const resume = vi.fn(async () => ({ ok: true, task: { status: "running" } }));
    doIt.actions = { pause, resume };
    render(<WorkingOn working={WORKING} words={WORDS} />);
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Resume" })).toBeInTheDocument());
    expect(pause).toHaveBeenCalledWith("t1");
    expect(document.querySelector('[data-part="work-line"]')).toHaveTextContent(/^Paused · /);
    fireEvent.click(screen.getByRole("button", { name: "Resume" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Pause" })).toBeInTheDocument());
    expect(resume).toHaveBeenCalledWith("t1");
  });

  it("Pause is off where the conversation has no plan actions", () => {
    render(<WorkingOn working={WORKING} words={WORDS} />);
    expect(screen.getByRole("button", { name: "Pause" })).toBeDisabled();
  });

  it("Undo last step is a preview on staging and says so", () => {
    render(<WorkingOn working={WORKING} words={WORDS} />);
    fireEvent.click(screen.getByRole("button", { name: "Undo last step" }));
    expect(screen.getByRole("status")).toHaveTextContent("Preview: undoing a step comes with the step log");
  });

  it("with no job running says so, with the next step", () => {
    const { container } = render(<WorkingOn working={null} words={WORDS} />);
    expect(within(container).getByText(/Nothing is running/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Pause" })).toBeNull();
  });
});
