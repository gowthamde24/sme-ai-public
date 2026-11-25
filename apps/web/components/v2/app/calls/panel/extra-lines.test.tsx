import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const nav = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: nav.refresh }) }));

import { appDict } from "@/i18n/app";
import { mockOverview, type ExtraLine, type ExtraLines as Overview, type LineActions, type LineResult } from "@/lib/extra-lines/types";
import { MOCK_LINES } from "@/lib/phone-lines/types";
import { expectNoSentenceForm } from "@/test/helpers/no-sentence-form";

import { CallsAtOnce } from "./CallsAtOnce";

const W = appDict("en") as Record<string, string>;
const CREDITS = "/app/tenants/11111111-1111-4111-8111-111111111111/billing";
const LINE = (over: Partial<ExtraLine> = {}): ExtraLine => ({ id: "00000000-0000-4000-8000-000000000001", status: "active", working: true, paidUntil: "2026-12-12T06:00:00Z", cancelAtEnd: false, graceUntil: null, ...over });
const overview = (over: Partial<Overview> = {}): Overview => ({ ...mockOverview(0, 0), ...over });
const OK: LineResult = { ok: true };

afterEach(() => {
  cleanup();
  nav.refresh.mockReset();
});

function draw(o: Overview, actions: Partial<LineActions> = {}, owner = true) {
  const all: LineActions = { add: vi.fn(async () => OK), cancel: vi.fn(async () => OK), keep: vi.fn(async () => OK), ...actions };
  const view = render(<CallsAtOnce words={W} lines={MOCK_LINES} owner={owner} extra={{ overview: o, actions: all, creditsHref: CREDITS, locale: "en-IN", test: false }} />);
  return { ...view, actions: all };
}

describe("Add a line (EXTRA_LINES on)", () => {
  it("is a button, not a mail to us; the price is plain text first, then one confirm; no card, no sentence with blanks", () => {
    const { container } = draw(overview());
    expect(screen.queryByRole("link", { name: "Add a line" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Add a line" }));
    const group = screen.getByRole("group", { name: "Add a line" });
    expect(within(group).getByText("₹149 a month for each extra line.")).toBeInTheDocument();
    expect(within(group).getByText(/Taken from your credits each month\. GST was already added/)).toBeInTheDocument();
    expect(within(group).getByRole("button", { name: "Add the line" })).toBeInTheDocument();
    expect(group.className).not.toMatch(/rounded|shadow|bg-/);
    expectNoSentenceForm(container);
    fireEvent.click(within(group).getByRole("button", { name: "Not now" }));
    expect(screen.queryByRole("group", { name: "Add a line" })).toBeNull();
  });
  it("confirming asks for the line once, says it is done and refreshes the page", async () => {
    const add = vi.fn(async (): Promise<LineResult> => OK);
    draw(overview(), { add });
    fireEvent.click(screen.getByRole("button", { name: "Add a line" }));
    fireEvent.click(screen.getByRole("button", { name: "Add the line" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Done. One more call can run at a time."));
    expect(add).toHaveBeenCalledTimes(1);
    expect(add.mock.calls[0]?.[0]).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
    expect(nav.refresh).toHaveBeenCalled();
  });
  it("a press that failed and is pressed again keeps its key: one line, one charge", async () => {
    const add = vi.fn<(key: string) => Promise<LineResult>>().mockResolvedValueOnce({ ok: false, error: "down" }).mockResolvedValueOnce(OK);
    draw(overview(), { add });
    fireEvent.click(screen.getByRole("button", { name: "Add a line" }));
    fireEvent.click(screen.getByRole("button", { name: "Add the line" }));
    await screen.findByRole("alert");
    fireEvent.click(screen.getByRole("button", { name: "Add the line" }));
    await waitFor(() => expect(add).toHaveBeenCalledTimes(2));
    expect(add.mock.calls[1]?.[0]).toBe(add.mock.calls[0]?.[0]);
  });
  it("without enough credits: one plain sentence and a link to add credits; nothing says how much is missing", async () => {
    draw(overview(), { add: vi.fn(async () => ({ ok: false, error: "unavailable", reason: "not_enough_credits" }) as LineResult) });
    fireEvent.click(screen.getByRole("button", { name: "Add a line" }));
    fireEvent.click(screen.getByRole("button", { name: "Add the line" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("There are not enough credits for a line.");
    expect(within(alert).getByRole("link", { name: "Add credits" })).toHaveAttribute("href", CREDITS);
    expect(nav.refresh).not.toHaveBeenCalled();
  });
  it.each([
    [{ ok: false, error: "unavailable", reason: "at_limit" }, "You have the most lines a workspace can have."],
    [{ ok: false, error: "unavailable", reason: "no_number" }, "Get a phone number first."],
    [{ ok: false, error: "unavailable" }, "We could not add the line just now. You were not charged."],
    [{ ok: false, error: "forbidden" }, "Only the Owner can add or cancel a line."],
    [{ ok: false, error: "step_up" }, "Sign in again with your second code"],
  ])("a refusal (%#) is said in plain words", async (result, sentence) => {
    draw(overview(), { add: vi.fn(async () => result as LineResult) });
    fireEvent.click(screen.getByRole("button", { name: "Add a line" }));
    fireEvent.click(screen.getByRole("button", { name: "Add the line" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(sentence);
  });
  it("is for the Owner only, and not offered when no more can be added", () => {
    draw(overview(), {}, false);
    expect(screen.queryByRole("button", { name: "Add a line" })).toBeNull();
    cleanup();
    draw(overview({ canAdd: false, total: 20, cap: 20 }));
    expect(screen.queryByRole("button", { name: "Add a line" })).toBeNull();
    expect(screen.getByText(/most lines a workspace can have/)).toBeInTheDocument();
  });
  it("without the switch the card is as it was: a mail to us, no price", () => {
    const { container } = render(<CallsAtOnce words={W} lines={MOCK_LINES} owner />);
    expect(screen.getByRole("link", { name: "Add a line" }).getAttribute("href")).toMatch(/^mailto:/);
    expect(container.textContent).not.toMatch(/₹/);
  });
});

describe("the lines already bought", () => {
  it("are open rows that say what happens next, with one quiet button each", () => {
    const o = overview({ extra: [LINE(), LINE({ id: "00000000-0000-4000-8000-000000000002", cancelAtEnd: true }), LINE({ id: "00000000-0000-4000-8000-000000000003", status: "grace", graceUntil: "2026-12-15T06:00:00Z" }), LINE({ id: "00000000-0000-4000-8000-000000000004", status: "paused", working: false }), LINE({ id: "00000000-0000-4000-8000-000000000005", working: false })] });
    const { container } = draw(o);
    const rows = container.querySelectorAll("[data-line-row]");
    expect(rows).toHaveLength(5);
    expect(rows[0]).toHaveTextContent("Extra line 1");
    expect(rows[0]).toHaveTextContent("Renews on 12 Dec");
    expect(within(rows[0] as HTMLElement).getByRole("button", { name: "Cancel this line" })).toBeInTheDocument();
    expect(rows[1]).toHaveTextContent("Ends on 12 Dec. It works until then.");
    expect(within(rows[1] as HTMLElement).getByRole("button", { name: "Keep this line" })).toBeInTheDocument();
    expect(rows[2]).toHaveTextContent("Not paid yet. Add credits before 15 Dec or it pauses.");
    expect(rows[3]).toHaveTextContent("Paused. Add credits and it starts again.");
    expect(within(rows[3] as HTMLElement).queryByRole("button")).toBeNull();
    expect(rows[4]).toHaveTextContent("Getting ready");
    expect(container.querySelector('[data-part="extra-list"]')?.className ?? "").not.toMatch(/rounded|shadow/);
  });
  it("cancel and keep ask the server for that line and refresh the page", async () => {
    const o = overview({ extra: [LINE(), LINE({ id: "00000000-0000-4000-8000-000000000002", cancelAtEnd: true })] });
    const { actions } = draw(o);
    fireEvent.click(screen.getByRole("button", { name: "Cancel this line" }));
    await waitFor(() => expect(actions.cancel).toHaveBeenCalledWith("00000000-0000-4000-8000-000000000001"));
    fireEvent.click(screen.getByRole("button", { name: "Keep this line" }));
    await waitFor(() => expect(actions.keep).toHaveBeenCalledWith("00000000-0000-4000-8000-000000000002"));
    expect(nav.refresh).toHaveBeenCalledTimes(2);
  });
});
