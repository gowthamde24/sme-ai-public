import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const nav = { pathname: "/app/tenants/22222222-2222-2222-2222-222222222222/leads" };
vi.mock("next/navigation", () => ({ usePathname: () => nav.pathname, useSearchParams: () => new URLSearchParams(), useRouter: () => ({ refresh: vi.fn() }) }));
// next/dynamic loads the panel's chunk after the click; a test renders the real panel at once
vi.mock("next/dynamic", () => ({
  default: (load: () => Promise<unknown>) => {
    let part: React.ComponentType<Record<string, unknown>> | null = null;
    void load().then((m) => {
      part = m as React.ComponentType<Record<string, unknown>>;
    });
    return function Lazy(props: Record<string, unknown>) {
      const Part = part;
      return Part ? <Part {...props} /> : null;
    };
  },
}));

import { appT } from "@/i18n/app";

import { AskCard } from "./AskCard";
import { AskProvider } from "./AskProvider";
import { ASK_WORD_KEYS } from "./ask-words";
import type { AskEvent, AskTransport } from "./ask-types";

const BASE = "/app/tenants/22222222-2222-2222-2222-222222222222";
const en = appT("en");
const WORDS = Object.fromEntries(ASK_WORD_KEYS.map((k) => [k, en(k as "frame.notyet")]));
const CHIP_WORDS = Object.fromEntries(["ask.chip.needs", "ask.chip.call", "ask.chip.money", "ask.chip.quotes", "ask.chip.team"].map((k) => [k, en(k as "frame.notyet")]));

function playing(events: AskEvent[], seen: string[] = []): AskTransport {
  return async function* (req) {
    seen.push(req.question);
    for (const e of events) {
      await Promise.resolve();
      yield e;
    }
  };
}
const ANSWER: AskEvent[] = [{ type: "text", delta: "Nothing needs you today: 0 approvals waiting." }, { type: "done" }];
const harness = (transport: AskTransport | null, over: { availability?: "live" | "not_available" | "switched_off"; readOnly?: boolean } = {}) => (
  <AskProvider lang="en" base={BASE} words={WORDS} chipWords={CHIP_WORDS} availability={over.availability ?? "live"} readOnly={over.readOnly ?? false} transport={transport} voiceStatus={null}>
    {/* Today draws the card, the other screens the orb: never both (so one field has the id "ask-input") */}
    {nav.pathname === BASE ? <AskCard lang="en" base={BASE} availability="live" words={WORDS} chips={["What needs me today?", "Who should I call first?", "How much customer money is held?"]} onMood={() => undefined} /> : null}
  </AskProvider>
);

beforeEach(() => {
  nav.pathname = `${BASE}/leads`;
  window.matchMedia = vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() });
});
afterEach(cleanup);

describe("the floating orb (job DQ part 0)", () => {
  it("is a 56 px circle on a screen, not on Today, not on the live call, not in a read-only workspace, and not when there is nothing to ask", () => {
    const { rerender } = render(harness(playing(ANSWER)));
    const orb = screen.getByRole("button", { name: "Ask Vijaya" });
    expect(orb.className).toContain("size-14");
    expect(orb).toHaveAttribute("aria-haspopup", "dialog");
    expect(orb).toHaveAttribute("aria-expanded", "false");
    nav.pathname = BASE;
    rerender(harness(playing(ANSWER)));
    expect(screen.queryByRole("button", { name: "Ask Vijaya" })).toBeNull(); // Today: the card is the assistant
    nav.pathname = `${BASE}/office/live`;
    rerender(harness(playing(ANSWER)));
    expect(screen.queryByRole("button", { name: "Ask Vijaya" })).toBeNull(); // the live call
    nav.pathname = `${BASE}/quotes`;
    rerender(harness(playing(ANSWER), { readOnly: true }));
    expect(screen.queryByRole("button", { name: "Ask Vijaya" })).toBeNull();
    rerender(harness(playing(ANSWER), { availability: "switched_off" }));
    expect(screen.queryByRole("button", { name: "Ask Vijaya" })).toBeNull();
    rerender(harness(null));
    expect(screen.queryByRole("button", { name: "Ask Vijaya" })).toBeNull();
  });

  it("opens a dialog with the line and the chips of the page (Leads: who to call first), and Esc or Close returns to the orb with the focus on it", async () => {
    render(harness(playing(ANSWER)));
    fireEvent.click(screen.getByRole("button", { name: "Ask Vijaya" }));
    const panel = await screen.findByRole("dialog", { name: "Ask Vijaya" });
    expect(panel).toHaveAttribute("aria-modal", "true");
    expect(within(panel).getByRole("textbox", { name: "Your question for Vijaya" })).toHaveFocus();
    expect(within(panel).getAllByRole("listitem").map((li) => li.textContent)).toEqual(["Who should I call first?", "What needs me today?", "How much customer money is held?"]);
    fireEvent.keyDown(panel, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    await waitFor(() => expect(screen.getByRole("button", { name: "Ask Vijaya" })).toHaveFocus());
    fireEvent.click(screen.getByRole("button", { name: "Ask Vijaya" }));
    fireEvent.click(await screen.findByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("the chips follow the screen: Sales asks about quotes and money, a screen with none of its own gets the three common ones", async () => {
    nav.pathname = `${BASE}/quotes`;
    render(harness(playing(ANSWER)));
    fireEvent.click(screen.getByRole("button", { name: "Ask Vijaya" }));
    const panel = await screen.findByRole("dialog");
    expect(within(panel).getAllByRole("listitem").map((li) => li.textContent)).toEqual(["Which quotes are waiting for me?", "How much customer money is held?", "What needs me today?"]);
    cleanup();
    nav.pathname = `${BASE}/something-new`;
    render(harness(playing(ANSWER)));
    fireEvent.click(screen.getByRole("button", { name: "Ask Vijaya" }));
    expect(within(await screen.findByRole("dialog")).getAllByRole("listitem").map((li) => li.textContent)).toEqual(["What needs me today?", "Who should I call first?", "How much customer money is held?"]);
  });

  it("a chip asks its words and the answer appears in the panel", async () => {
    const seen: string[] = [];
    render(harness(playing(ANSWER, seen)));
    fireEvent.click(screen.getByRole("button", { name: "Ask Vijaya" }));
    const panel = await screen.findByRole("dialog");
    fireEvent.click(within(panel).getByRole("button", { name: "Who should I call first?" }));
    await waitFor(() => expect(seen).toEqual(["Who should I call first?"]));
    expect(await within(panel).findByText("Nothing needs you today: 0 approvals waiting.")).toBeInTheDocument();
  });

  it("the same conversation: a question asked on Leads is on Today, with 'Show earlier' for the one before", async () => {
    const seen: string[] = [];
    const { rerender } = render(harness(playing(ANSWER, seen)));
    fireEvent.click(screen.getByRole("button", { name: "Ask Vijaya" }));
    const panel = await screen.findByRole("dialog");
    fireEvent.change(within(panel).getByRole("textbox"), { target: { value: "first question" } });
    fireEvent.click(within(panel).getByRole("button", { name: "Ask" }));
    await within(panel).findByText("Nothing needs you today: 0 approvals waiting.");
    fireEvent.change(within(panel).getByRole("textbox"), { target: { value: "second question" } });
    fireEvent.click(within(panel).getByRole("button", { name: "Ask" }));
    await waitFor(() => expect(seen).toEqual(["first question", "second question"]));
    await waitFor(() => expect(within(panel).getAllByText("Nothing needs you today: 0 approvals waiting.").length).toBeGreaterThan(0));
    // on to Today: the provider stays, the orb goes, the card has the latest exchange
    nav.pathname = BASE;
    rerender(harness(playing(ANSWER, seen)));
    expect(screen.queryByRole("dialog")).toBeNull();
    const card = document.querySelector('[data-ask-where="card"]') as HTMLElement;
    expect(within(card).getByText(/second question/)).toBeInTheDocument();
    expect(within(card).getByText("Nothing needs you today: 0 approvals waiting.")).toBeInTheDocument();
    expect(within(card).queryByText(/first question/)).toBeNull();
    fireEvent.click(within(card).getByRole("button", { name: "Show earlier (1)" }));
    expect(within(card).getByText(/first question/)).toBeInTheDocument();
    expect(seen).toHaveLength(2); // nothing was asked again
  });

  it("a small dot says there is an answer the person has not seen (asked, then the panel closed)", async () => {
    const hold: { release?: () => void } = {};
    const slow: AskTransport = async function* () {
      await new Promise<void>((r) => (hold.release = r));
      yield { type: "text", delta: "late answer" };
      yield { type: "done" };
    };
    render(harness(slow));
    fireEvent.click(screen.getByRole("button", { name: "Ask Vijaya" }));
    const panel = await screen.findByRole("dialog");
    fireEvent.click(within(panel).getByRole("button", { name: "What needs me today?" }));
    fireEvent.keyDown(panel, { key: "Escape" });
    expect(document.querySelector('[data-ask="dot"]')).toBeNull();
    await act(async () => {
      hold.release?.();
    });
    await waitFor(() => expect(document.querySelector('[data-ask="dot"]')).not.toBeNull());
    expect(screen.getByRole("button", { name: /Ask Vijaya\. New answer/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Ask Vijaya/ }));
    await screen.findByRole("dialog");
    expect(document.querySelector('[data-ask="dot"]')).toBeNull();
  });

  it("keyboard: '/' and Cmd or Ctrl+K open the panel; '/' typed into a field does not; on Today they put the cursor in the card's own line", async () => {
    const { rerender } = render(harness(playing(ANSWER)));
    fireEvent.keyDown(window, { key: "/" });
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    fireEvent.keyDown(window, { key: "k", metaKey: true });
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    const field = document.createElement("input");
    document.body.appendChild(field);
    field.focus();
    fireEvent.keyDown(field, { key: "/" });
    expect(screen.queryByRole("dialog")).toBeNull();
    field.remove();
    nav.pathname = BASE;
    rerender(harness(playing(ANSWER)));
    fireEvent.keyDown(window, { key: "/" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("textbox", { name: "Your question for Vijaya" })).toHaveFocus();
  });

  it("the focus stays inside the panel: Tab from the last control goes to the first, Shift+Tab the other way", async () => {
    render(harness(playing(ANSWER)));
    fireEvent.click(screen.getByRole("button", { name: "Ask Vijaya" }));
    const panel = await screen.findByRole("dialog");
    const controls = [...panel.querySelectorAll<HTMLElement>("button:not([disabled]), input:not([disabled])")];
    controls[controls.length - 1].focus();
    fireEvent.keyDown(panel, { key: "Tab" });
    expect(controls[0]).toHaveFocus();
    fireEvent.keyDown(panel, { key: "Tab", shiftKey: true });
    expect(controls[controls.length - 1]).toHaveFocus();
  });

  it("moving to another screen closes the panel", async () => {
    const { rerender } = render(harness(playing(ANSWER)));
    fireEvent.click(screen.getByRole("button", { name: "Ask Vijaya" }));
    await screen.findByRole("dialog");
    nav.pathname = `${BASE}/orders`;
    rerender(harness(playing(ANSWER)));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("there is no bar fixed at the bottom: the only fixed things are the orb and, once open, the panel", async () => {
    render(harness(playing(ANSWER)));
    expect(document.querySelector("form")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Ask Vijaya" }));
    await screen.findByRole("dialog");
    expect(document.querySelectorAll("form")).toHaveLength(1);
    expect(document.querySelector("form")!.className).not.toContain("fixed");
  });
});
