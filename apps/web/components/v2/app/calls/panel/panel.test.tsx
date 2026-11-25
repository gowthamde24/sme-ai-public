import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const nav = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: nav.push, refresh: vi.fn() }) }));
// the orb is a canvas: a plain stand-in here
vi.mock("@/components/v2/Orb", () => ({ Orb: () => <span data-orb /> }));

import { appDict } from "@/i18n/app";
import { MOCK_LINES, type Lines } from "@/lib/phone-lines/types";
import { expectNoSentenceForm } from "@/test/helpers/no-sentence-form";

import { BeforeYouStart } from "./BeforeYouStart";
import { CallBillingFacts } from "./CallBillingFacts";
import { CallsAtOnce } from "./CallsAtOnce";
import { HearItYourself } from "./HearItYourself";

const dict = appDict("en") as Record<string, string>;
const W = dict;
const BASE = "/app/tenants/11111111-1111-4111-8111-111111111111";
afterEach(() => {
  cleanup();
  nav.push.mockReset();
});

describe("Before you start calling", () => {
  it("is open on the Calls page: the five rules as numbered open rows, calling hours 10 am to 9 pm, do-not-call automatic, the business is the caller", () => {
    const { container } = render(<BeforeYouStart words={W} open />);
    const details = container.querySelector("details") as HTMLDetailsElement;
    expect(details.open).toBe(true);
    const rows = within(container.querySelector("ol") as HTMLElement).getAllByRole("listitem");
    expect(rows).toHaveLength(5);
    expect(rows[0]).toHaveTextContent("Only call people who agreed.");
    expect(rows[1]).toHaveTextContent("We fix the calling hours. Calls go out between 10 am and 9 pm.");
    expect(rows[2]).toHaveTextContent("Do-not-call is automatic.");
    expect(rows[3]).toHaveTextContent("Your business is the caller.");
    expect(rows[4]).toHaveTextContent("Phone rules may apply.");
    expect(screen.getByRole("heading", { name: "Before you start calling" })).toBeInTheDocument();
  });
  it("is folded on Lead sources: the summary offers 'Read the five rules', the rules are one tap away", () => {
    const { container } = render(<BeforeYouStart words={W} open={false} />);
    expect((container.querySelector("details") as HTMLDetailsElement).open).toBe(false);
    expect(screen.getByText("Read the five rules")).toBeInTheDocument();
    fireEvent.click(container.querySelector("summary") as HTMLElement);
    // (jsdom toggles the attribute on a click of the summary)
    expect(container.querySelectorAll("li")).toHaveLength(5);
  });
  it("is flat: no box, no card per rule, no control, no sentence form", () => {
    const { container } = render(<BeforeYouStart words={W} open />);
    expect(container.querySelector("input,select,textarea,button")).toBeNull();
    expect(container.innerHTML).not.toMatch(/rounded-(xl|2xl|\[14px\])|shadow/);
    expectNoSentenceForm(container);
  });
});

describe("Hear it yourself", () => {
  it("is one card with one button; nobody is dialled and it costs nothing", () => {
    const { container } = render(<HearItYourself words={W} language="English" base={BASE} />);
    const card = container.querySelector('[data-part="hear-it-yourself"]') as HTMLElement;
    expect(within(card).getByRole("heading", { name: "Hear it yourself" })).toBeInTheDocument();
    expect(card).toHaveTextContent("Nobody is dialled and it costs nothing.");
    expect(within(card).getAllByRole("button")).toHaveLength(1);
    expect(within(card).getByRole("button", { name: "Start a test call" })).toBeInTheDocument();
    expectNoSentenceForm(container);
  });
  it("Start a test call opens the conversation in place (the browser-voice talk body, practice mode); Type goes to My assistant", () => {
    const { container } = render(<HearItYourself words={W} language="English" base={BASE} />);
    fireEvent.click(screen.getByRole("button", { name: "Start a test call" }));
    expect(container.querySelector('[data-part="talk-live"]')).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Start a test call" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: dict["dst.type"] }));
    expect(nav.push).toHaveBeenCalledWith(`${BASE}/my-assistant`);
    expect(screen.getByRole("button", { name: "Start a test call" })).toBeInTheDocument();
  });
});

describe("Calls at once", () => {
  const draw = (lines: Lines | null, owner = true, test = false) => render(<CallsAtOnce words={W} lines={lines} owner={owner} test={test} />);
  it("says '1 of 2 calls at once', that the lines are shared, and draws one tile per line: Open (dashed) or On a call (with the calls dot)", () => {
    const { container } = draw(MOCK_LINES);
    expect(screen.getByRole("heading", { name: "Calls at once" })).toBeInTheDocument();
    expect(screen.getByText("1 of 2 calls at once")).toBeInTheDocument();
    expect(screen.getByText("Shared by all your numbers.")).toBeInTheDocument();
    const tiles = container.querySelectorAll("[data-line]");
    expect(tiles).toHaveLength(2);
    expect(tiles[1]).toHaveAttribute("data-state", "open");
    expect(tiles[1]).toHaveTextContent("Line 2Open");
    expect(tiles[1].className).toContain("border-dashed");
    expect(tiles[1].querySelector("[data-k]")).toBeNull();
    expect(tiles[0]).toHaveAttribute("data-state", "on_call");
    expect(tiles[0]).toHaveTextContent("Line 1On a call");
    expect(tiles[0].className).not.toContain("border-dashed");
    expect(tiles[0].querySelector('[data-k="call"]')).not.toBeNull();
  });
  it("0 of 3 with every line open; all busy is '3 of 3'", () => {
    draw({ total: 3, inUse: 0, lines: [1, 2, 3].map((n) => ({ n, state: "open" as const })) });
    expect(screen.getByText("0 of 3 calls at once")).toBeInTheDocument();
    cleanup();
    draw({ total: 3, inUse: 3, lines: [1, 2, 3].map((n) => ({ n, state: "on_call" as const })) });
    expect(screen.getByText("3 of 3 calls at once")).toBeInTheDocument();
    expect(document.querySelectorAll('[data-state="on_call"]')).toHaveLength(3);
  });
  it("the busy-tone sentence is a neutral notice: a grey dot and one sentence, no box", () => {
    const { container } = draw(MOCK_LINES);
    const note = container.querySelector('[data-part="once-note"]') as HTMLElement;
    expect(note).toHaveTextContent("When all lines are busy, a new caller hears a busy tone.");
    expect(note.querySelector(".rounded-full")).not.toBeNull();
    expect(note.className).not.toMatch(/border|bg-(info|amber|red|green)|rounded-(lg|xl)/);
  });
  it("'Add a line' is for the Owner only, has no price, and writes to us", () => {
    const { container } = draw(MOCK_LINES, true);
    const add = screen.getByRole("link", { name: "Add a line" });
    expect(add.getAttribute("href")).toMatch(/^mailto:support@.+\?subject=Add%20a%20line$/);
    expect(container.textContent).not.toMatch(/₹|Rs\.? ?\d|\bprice\b|per month|a month/i);
    cleanup();
    draw(MOCK_LINES, false);
    expect(screen.queryByRole("link", { name: "Add a line" })).toBeNull();
  });
  it("a route that cannot be read says so and guesses nothing; no lines at all says calls are not on", () => {
    const { container } = draw(null);
    expect(container.querySelector('[data-part="once-unread"]')).toHaveTextContent("We could not read your lines just now.");
    expect(container.querySelector("[data-line]")).toBeNull();
    expect(screen.queryByText(/calls at once$/)).toBeNull();
    expect(screen.queryByRole("link", { name: "Add a line" })).toBeNull();
    cleanup();
    const none = draw({ total: 0, inUse: 0, lines: [] });
    expect(none.container.querySelector('[data-part="once-none"]')).toHaveTextContent("Calls are not switched on for your business yet.");
    expect(screen.queryByRole("link", { name: "Add a line" })).toBeNull();
  });
  it("the test data says so; there is no input anywhere (no sentence form)", () => {
    const { container } = draw(MOCK_LINES, true, true);
    expect(screen.getByText("Test data. No line is read.")).toBeInTheDocument();
    expectNoSentenceForm(container);
  });
});

describe("How calls are billed", () => {
  it("four open rows with no Draft tag (call charging is wired): nothing for an unanswered call, 30-second blocks, calls you receive cost the same, testing is free", () => {
    const { container } = render(<CallBillingFacts words={W} />);
    expect(screen.getByRole("heading", { name: "How calls are billed" })).toBeInTheDocument();
    const rows = container.querySelectorAll("[data-row]");
    expect(rows).toHaveLength(4);
    expect(rows[0]).toHaveTextContent("Nobody picks up, or the line is busy");
    expect(rows[0]).toHaveTextContent("A call nobody answers costs nothing.");
    expect(rows[1]).toHaveTextContent("Calls are billed per 30 seconds, rounded up.");
    expect(rows[2]).toHaveTextContent("Calls you receive cost the same as calls we make for you.");
    expect(rows[3]).toHaveTextContent("Test calls and practice are free.");
    expect(container.querySelectorAll('[data-part="draft-tag"]')).toHaveLength(0);
  });
  it("writes no amount: the rates are the plan's, drawn by the page", () => {
    const { container } = render(<CallBillingFacts words={W} />);
    expect(container.textContent).not.toMatch(/₹|Rs\.? ?\d/);
    expectNoSentenceForm(container);
  });
});
