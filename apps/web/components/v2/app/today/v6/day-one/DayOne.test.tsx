import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

beforeAll(async () => {
  await import("../LiveBar");
});
vi.mock("next/dynamic", () => ({
  default: (load: () => Promise<unknown>) => {
    let part: React.ComponentType<Record<string, unknown>> | null = null;
    void load().then((m) => {
      const mod = m as { default?: React.ComponentType<Record<string, unknown>> } & React.ComponentType<Record<string, unknown>>;
      part = mod.default ?? mod;
    });
    return function Lazy(props: Record<string, unknown>) {
      const Part = part;
      return Part ? <Part {...props} /> : null;
    };
  },
}));

import { appDict } from "@/i18n/app";

import DayOne, { ProgressRing, type DayOneActions } from "./DayOne";
import { FinishChip } from "./FinishChip";
import { stepViews } from "./steps";

const dict = appDict("en") as Record<string, string>;
const WORDS = Object.fromEntries(Object.entries(dict).filter(([k]) => k.startsWith("tv6.") || k.startsWith("dst.")));
const BASE = "/app/tenants/22222222-2222-2222-2222-222222222222";

const actions = (over: Partial<DayOneActions> = {}): DayOneActions => ({ skip: vi.fn(async () => undefined), goLive: vi.fn(async () => ({ ok: true, missing: [] })), testNumber: null, ...over });
const view = (done: Parameters<typeof stepViews>[0], over: Partial<React.ComponentProps<typeof DayOne>> = {}) => (
  <DayOne name="Gowtham" steps={stepViews(done, BASE)} canGoLive={false} missing={["phone_number"]} actions={actions()} words={WORDS} language="English" helpHref="/app/support/whatsapp?page=today" testCallHref={`${BASE}/calls`} {...over} />
);

afterEach(cleanup);

describe("day one: the setup checklist", () => {
  it("welcomes the person by name with the time it takes", () => {
    render(view({}));
    expect(screen.getByRole("heading", { name: "Welcome, Gowtham. Let's get your assistant ready." })).toBeInTheDocument();
    expect(screen.getByText(/About 15 minutes\./)).toBeInTheDocument();
  });

  it("lists the seven steps with minutes; steps 3 to 5 say 'Optional · defaults are set'", () => {
    render(view({}));
    const steps = [...document.querySelectorAll("[data-step]")];
    expect(steps.map((s) => s.getAttribute("data-step"))).toEqual(["shop", "catalogue", "speaks", "rules", "practise", "phone", "sources"]);
    expect(steps.map((s) => /Optional/.test(s.textContent ?? ""))).toEqual([false, false, true, true, true, false, false]);
    expect(within(steps[1] as HTMLElement).getByText("4 min")).toBeInTheDocument(); // the current step shows Start, the others their minutes
    expect(steps[0]).toHaveTextContent("Tell us about your shop");
    expect(steps[0]).toHaveTextContent("Name, address, timings, what you sell");
    expect(steps[2]).toHaveTextContent("Optional · defaults are set");
  });

  it("ticks the done steps and highlights the current one with Start →", () => {
    render(view({ shop: true, catalogue: true }));
    expect(document.querySelector('[data-step="shop"]')).toHaveAttribute("data-state", "done");
    expect(document.querySelector('[data-step="shop"] svg')).not.toBeNull(); // the tick
    const current = document.querySelector('[data-step="speaks"]') as HTMLElement;
    expect(current).toHaveAttribute("data-state", "current");
    expect(current).toHaveAttribute("aria-current", "step");
    expect(within(current).getByRole("link", { name: "Start →" })).toHaveAttribute("href", `${BASE}/my-assistant?tab=voice`);
    expect(screen.getAllByRole("link", { name: "Start →" })).toHaveLength(1);
  });

  it("shows the progress ring and 'Continue setup →' to the current step", () => {
    render(view({ shop: true }));
    expect(screen.getByRole("img", { name: "1/7" })).toBeInTheDocument();
    expect(screen.getByText("steps done")).toBeInTheDocument();
    expect(screen.getByText("Next: Add your catalogue & prices")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Continue setup →" })).toHaveAttribute("href", `${BASE}/catalogue`);
  });

  it("the ring fills with the steps done", () => {
    const { container } = render(<ProgressRing done={7} total={7} />);
    const circles = container.querySelectorAll("circle");
    expect(circles[1].getAttribute("stroke-dashoffset")).toBe("0");
  });

  it("'Skip for now' is under the headline and calls the skip action", () => {
    const a = actions();
    render(view({}, { actions: a }));
    const skip = screen.getByRole("button", { name: "Skip for now" });
    expect(skip.closest("header")).not.toBeNull();
    fireEvent.click(skip);
    expect(a.skip).toHaveBeenCalledTimes(1);
  });

  it("the Go live button says what is missing (and 'Go live with defaults' is not there yet)", () => {
    render(view({ shop: true }, { missing: ["phone_number"] }));
    expect(screen.queryByRole("button", { name: "Go live with defaults" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Go live" }));
    expect(screen.getByRole("status")).toHaveTextContent("To go live we still need a connected phone number.");
  });

  it("names both when both are missing", () => {
    render(view({}, { missing: ["business_name", "phone_number"] }));
    fireEvent.click(screen.getByRole("button", { name: "Go live" }));
    expect(screen.getByRole("status")).toHaveTextContent("your business name and a connected phone number");
  });

  it("'Go live with defaults' appears once the name and the phone number are done, and calls the go-live action", async () => {
    const a = actions();
    render(view({ shop: true, phone: true }, { canGoLive: true, missing: [], actions: a }));
    fireEvent.click(screen.getByRole("button", { name: "Go live with defaults" }));
    await waitFor(() => expect(a.goLive).toHaveBeenCalledTimes(1));
  });

  it("a Go live the server refuses says what is still missing", async () => {
    const a = actions({ goLive: vi.fn(async () => ({ ok: false, missing: ["phone_number" as const] })) });
    render(view({ shop: true, phone: true }, { canGoLive: true, missing: [], actions: a }));
    fireEvent.click(screen.getByRole("button", { name: "Go live with defaults" }));
    expect(await screen.findByText("To go live we still need a connected phone number.")).toBeInTheDocument();
  });

  it("offers a test number on staging only (mock), through its own action", () => {
    const testNumber = vi.fn(async () => undefined);
    render(view({}, { actions: actions({ testNumber }) }));
    fireEvent.click(screen.getByRole("button", { name: "Use a test number (staging)" }));
    expect(testNumber).toHaveBeenCalledTimes(1);
    cleanup();
    render(view({}));
    expect(screen.queryByRole("button", { name: "Use a test number (staging)" })).toBeNull();
  });

  it("'Not sure? Just talk.' opens the live conversation in place (setup script) and End returns", async () => {
    render(view({}));
    expect(screen.getByText("Not sure? Just talk.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Talk live" }));
    expect(await screen.findByText(/LIVE WITH YOUR ASSISTANT/)).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "End" }));
    await waitFor(() => expect(screen.getByText("Not sure? Just talk.")).toBeInTheDocument());
  });

  it("'Need help?' goes to the WhatsApp support link", () => {
    render(view({}));
    expect(screen.getByRole("link", { name: "WhatsApp our team. We'll set it up with you." })).toHaveAttribute("href", "/app/support/whatsapp?page=today");
  });

  it("has the empty state below with 'Make a test call'", () => {
    render(view({}));
    const empty = document.querySelector('[data-part="empty-next"]') as HTMLElement;
    expect(within(empty).getByRole("link", { name: "Make a test call" })).toHaveAttribute("href", `${BASE}/calls`);
  });
});

describe("the 'Finish setup' chip", () => {
  it("shows N/7, reopens the checklist and can be put away", () => {
    const dismiss = vi.fn(async () => undefined);
    render(<FinishChip done={3} base={BASE} words={WORDS} dismiss={dismiss} />);
    expect(screen.getByRole("link", { name: "Finish setup · 3/7" })).toHaveAttribute("href", `${BASE}?setup=1`);
    fireEvent.click(screen.getByRole("button", { name: "Hide this" }));
    expect(dismiss).toHaveBeenCalledTimes(1);
  });
});
