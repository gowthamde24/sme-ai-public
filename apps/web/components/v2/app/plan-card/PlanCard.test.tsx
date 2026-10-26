import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { appDict } from "@/i18n/app";

import { PlanCard, type ApproveResult, type PlanCardProps } from "./PlanCard";

const words = Object.fromEntries(Object.entries(appDict("en") as Record<string, string>).filter(([k]) => k.startsWith("pc.")));
const sample = [{ id: "a", name: "Ravi K." }, { id: "b", name: "Anitha R." }, { id: "c", name: "Kiran P." }];
const draw = (over: Partial<PlanCardProps> = {}) => {
  const onApprove = vi.fn(async (): Promise<ApproveResult> => ({ ok: true }));
  const onExclude = vi.fn();
  render(
    <PlanCard words={words} title="Call 12 new leads" who={{ count: 12, sample, excluded: new Set() }} goal="Book a site visit" questions={["What is your budget?", "Which area?"]} channel="Phone calls" when="Today, 10:00 to 19:00" estimate={{ minutes: 24, messages: 12, costPaise: 3600 }} limits={{ callsPerDay: 50, capPaise: 4320 }} state="planned" canApprove onExclude={onExclude} onApprove={onApprove} securityHref="/app/security" {...over} />,
  );
  return { onApprove, onExclude };
};
afterEach(cleanup);

describe("the plan card (night 4: approve once)", () => {
  it("shows who, the goal, what is asked, when, the estimate and the limits, and one button for everybody", () => {
    draw();
    expect(screen.getByText("12 people")).toBeInTheDocument();
    expect(screen.getByText("and 9 more")).toBeInTheDocument();
    expect(screen.getByText("Book a site visit")).toBeInTheDocument();
    expect(screen.getByText("What is your budget?")).toBeInTheDocument();
    expect(document.querySelector("[data-part=estimate]")).toHaveTextContent("24 minutes of calls · 12 messages · about ₹36");
    expect(document.querySelector("[data-part=limits]")).toHaveTextContent("Up to 50 calls a day · It stops when it has spent ₹43.20");
    expect(screen.getAllByRole("button")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Approve all (12)" })).toBeEnabled();
  });
  it("a tick leaves one person out and the button counts the rest", () => {
    const { onExclude } = draw({ who: { count: 12, sample, excluded: new Set(["b"]) } });
    expect(screen.getByRole("button", { name: "Approve all (11)" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox", { name: "Ravi K." }));
    expect(onExclude).toHaveBeenCalledWith("a", true);
    fireEvent.click(screen.getByRole("checkbox", { name: "Anitha R." }));
    expect(onExclude).toHaveBeenLastCalledWith("b", false);
  });
  it("approves once and says it started", async () => {
    const { onApprove } = draw();
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: "Approve all (12)" })));
    expect(onApprove).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("status")).toHaveTextContent("Approved. It starts now.");
    expect(screen.getByRole("button", { name: "Approve all (12)" })).toBeDisabled();
  });
  it("names why an approval did not happen: second factor (with the way to set it up), a changed plan, a read-only workspace, nobody", async () => {
    for (const [error, text] of [["mfa", "second sign-in step"], ["changed", "The plan changed"], ["read_only", "read-only"], ["nobody", "Nobody to contact"], ["down", "Nothing was approved"]] as const) {
      const { onApprove } = draw({ onApprove: vi.fn(async (): Promise<ApproveResult> => ({ ok: false, error })) });
      void onApprove;
      await act(async () => void fireEvent.click(screen.getByRole("button", { name: /Approve all/ })));
      expect(screen.getByRole("alert")).toHaveTextContent(text);
      if (error === "mfa") expect(screen.getByRole("link", { name: "Set it up" })).toHaveAttribute("href", "/app/security");
      cleanup();
    }
  });
  it("an approval that throws is 'nothing was approved', never a success", async () => {
    draw({ onApprove: vi.fn(async () => Promise.reject(new Error("net"))) });
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: /Approve all/ })));
    expect(screen.getByRole("alert")).toHaveTextContent("Nothing was approved");
  });
  it("only the Owner approves; others see why. A plan that is not waiting has no button and no ticks that work", () => {
    draw({ canApprove: false });
    expect(screen.getByRole("button", { name: /Approve all/ })).toBeDisabled();
    expect(screen.getByText(/Only the Owner can approve/)).toBeInTheDocument();
    cleanup();
    draw({ state: "running" });
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByRole("checkbox", { name: "Ravi K." })).toBeDisabled();
    expect(document.querySelector("[data-state=running]")).not.toBeNull();
  });
  it("nobody to contact cannot be approved, and test mode and notes are said plainly", () => {
    draw({ who: { count: 0, sample: [], excluded: new Set() }, simulated: true, notes: ["Nobody in your contacts fits this yet."] });
    expect(screen.getByRole("button", { name: "Approve all (0)" })).toBeDisabled();
    expect(screen.getByText(/the calls are simulated/)).toBeInTheDocument();
    expect(document.querySelector("[data-part=notes]")).toHaveTextContent("Nobody in your contacts fits this yet.");
  });
});
