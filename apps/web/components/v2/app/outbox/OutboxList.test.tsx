import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: () => undefined }), usePathname: () => "/", useSearchParams: () => new URLSearchParams() }));

import type { OutboxMessage } from "@/lib/api/outbox";
import { SENT_JSON } from "@/lib/api/outbox-fixtures";

import type { Role } from "../today/types";
import { OutboxList, historyOf } from "./OutboxList";
import { BASE, FAILED, HELD, NOW, SENT, STOPPED, WAITING, WORDS, fakeOutboxActions, msg } from "./outbox-test-kit";
import type { OutboxTab } from "./reasons";

const show = (items: OutboxMessage[], { tab = "waiting" as OutboxTab, role = "owner" as Role, actions = fakeOutboxActions() } = {}) => {
  render(<OutboxList items={items} tab={tab} role={role} words={WORDS} lang="en" now={NOW} actions={actions} leadBase={`${BASE}/leads`} />);
  return actions;
};
const open = async (name: RegExp | string) => act(async () => fireEvent.click(screen.getByRole("button", { name })));
const click = (name: string | RegExp) => act(async () => fireEvent.click(screen.getByRole("button", { name })));

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

describe("a message that carries photos (a catalogue send, job BC)", () => {
  const withPhotos = () => msg(SENT_JSON, { id: "11111111-aaaa-4aaa-8aaa-0000000000c1", media: [{ photo_id: "0f8a927d-1111-4a11-8a11-000000000001", position: 1, thumb_url: "https://s.example/1_t.jpg?token=a" }, { photo_id: "0f8a927d-1111-4a11-8a11-000000000002", position: 2, thumb_url: "https://s.example/2_t.jpg?token=b" }] });
  it("shows the thumbnails in order under the first line, lazily, with words for a screen reader", () => {
    show([withPhotos()], { tab: "sent" });
    const imgs = within(document.querySelector("li[data-status]") as HTMLElement).getAllByRole("img");
    expect(imgs.map((i) => i.getAttribute("src"))).toEqual(["https://s.example/1_t.jpg?token=a", "https://s.example/2_t.jpg?token=b"]);
    expect(imgs.map((i) => i.getAttribute("alt"))).toEqual(["Photo 1 of 2 sent with this message", "Photo 2 of 2 sent with this message"]);
    expect(imgs.every((i) => i.getAttribute("loading") === "lazy")).toBe(true);
  });
  it("a message without photos draws none", () => {
    show([SENT()], { tab: "sent" });
    expect(screen.queryByRole("img")).toBeNull();
  });
  it("opening the row keeps the photos and draws them larger", async () => {
    show([withPhotos()], { tab: "sent" });
    const before = document.querySelector("[data-part=message-photos] li")!.className;
    await open(/DEMO Lakshmi Textiles/);
    expect(screen.getAllByRole("img")).toHaveLength(2);
    expect(document.querySelector("[data-part=message-photos] li")!.className).not.toBe(before);
  });
});

describe("a row of the Outbox", () => {
  it("shows the reason in plain words, the channel, the language, the time, the customer and the first line", () => {
    show([WAITING()]);
    const row = screen.getByRole("listitem");
    expect(within(row).getByText("Mentions a price")).toBeInTheDocument();
    expect(within(row).getByText("WhatsApp")).toBeInTheDocument();
    expect(within(row).getByText(/Telugu/)).toBeInTheDocument();
    expect(within(row).getByText("8:42")).toBeInTheDocument();
    expect(within(row).getByText(/DEMO Lakshmi Textiles/)).toBeInTheDocument();
    expect(within(row).getByText("ఈ చీర ధర 500 రూపాయలు మాత్రమే.")).toHaveAttribute("lang", "te");
    expect(within(row).queryByText(/AI సహాయకుడి/)).toBeNull(); // only the first line
  });
  it("a message held for quiet hours says when it goes out", () => {
    show([HELD()], { tab: "scheduled" });
    expect(screen.getByText("Quiet hours")).toBeInTheDocument();
    expect(screen.getByText("Goes out at 15 Oct, 9:00")).toBeInTheDocument();
  });
  it.each([
    [STOPPED(), "Customer said STOP"],
    [FAILED(), "WhatsApp did not take it"],
    [SENT(), "Sent by Agent OWL on its own"],
  ])("a blocked, failed or sent message wears its own chip", (m, chip) => {
    show([m], { tab: "blocked" });
    expect(screen.getByText(chip)).toBeInTheDocument();
  });
  it("a customer with no name is 'a customer'", () => {
    show([msg(WAITING() as never, { customer: null })].map(() => WAITING()).map((m) => ({ ...m, customer: null })));
    expect(screen.getByText("a customer")).toBeInTheDocument();
  });
  it("opens in place to the full words, the flags and the history, and closes again", async () => {
    show([WAITING()]);
    expect(screen.queryByText(/AI సహాయకుడి/)).toBeNull();
    await open(/Mentions a price/);
    expect(screen.getByText(/AI సహాయకుడి/)).toBeInTheDocument();
    expect(screen.getByText("Mentions money")).toBeInTheDocument();
    expect(screen.getByText(/Why: It mentions money/)).toBeInTheDocument();
    expect(screen.getByText("The first message to a customer says it comes from the shop's AI assistant.")).toBeInTheDocument();
    const history = screen.getByRole("list", { name: "History" });
    expect(within(history).getAllByRole("listitem").map((li) => li.textContent)).toEqual(["8:42 · Written by Agent OWL", "8:42 · Waiting for a person: Mentions a price"]);
    expect(screen.getByRole("link", { name: "Open the lead" })).toHaveAttribute("href", `${BASE}/leads/${WAITING().lead_id}`);
    await open(/Mentions a price/);
    expect(screen.queryByText(/AI సహాయకుడి/)).toBeNull();
  });
  it("only one row is open at a time", async () => {
    show([WAITING(), STOPPED()], { tab: "waiting" });
    await open(/Mentions a price/);
    await open(/Customer said STOP/);
    expect(screen.queryByText(/AI సహాయకుడి/)).toBeNull();
    expect(screen.getByText(/Hello, would you like/, { selector: "p" })).toBeInTheDocument();
  });
  it("a failed message says why in words", async () => {
    show([FAILED()], { tab: "blocked" });
    await open(/WhatsApp did not take it/);
    expect(screen.getByText("WhatsApp did not answer in time.")).toBeInTheDocument();
  });
  it("the whole row is a button at least 44 px high and says whether it is open", () => {
    show([WAITING()]);
    const b = screen.getByRole("button", { name: /Mentions a price/ });
    expect(b).toHaveAttribute("aria-expanded", "false");
    expect(b.className).toContain("p-4");
  });
  it("shows no number: the API gives none", () => {
    show([WAITING()]);
    expect(document.body.textContent).not.toMatch(/\+?\d[\d ]{9,}/);
  });
});

describe("the history of a message, from the times the API gives", () => {
  const h = (m: OutboxMessage) => historyOf(m, { words: WORDS, now: NOW, lang: "en" }).map((x) => x.text);
  it("queued, approved, sent, in time order", () => {
    expect(h(msg(SENT() as never, { edited_at: "2026-10-14T02:30:00Z", decided_at: "2026-10-14T03:00:00Z", reason: "owner_approved", created_at: "2026-10-14T01:00:00Z", sent_at: "2026-10-14T03:01:00Z", source: "assistant" }))).toEqual([
      "6:30 · Written by Agent OWL",
      "8:00 · Words changed by a person",
      "8:30 · Approved by a person",
      "8:31 · Sent",
    ]);
  });
  it("a held message ends with when it is held until; a rejected one with the person's 'not now'", () => {
    expect(h(HELD()).at(-1)).toBe("15 Oct, 9:00 · Held until it goes out");
    expect(h(msg(STOPPED() as never, { reason: "owner_rejected", decided_at: "2026-10-14T01:00:00Z" })).at(-1)).toBe("6:30 · A person said not now");
  });
  it("a message made by the shop's own template says so", () => {
    expect(h(msg(SENT() as never, { source: "system" }))[0]).toContain("Made by the shop's own template");
  });
  it("blocked and failed end with 'Not sent' and 'Not delivered', each with the reason", () => {
    expect(h(STOPPED()).at(-1)).toBe("13 Oct, 21:30 · Not sent: Customer said STOP");
    expect(h(FAILED()).at(-1)).toContain("Not delivered: WhatsApp did not take it");
  });
});

describe("who may decide, and what the decision does", () => {
  it("the Owner and the Admin get Approve and send, Edit and Not now on a message that waits", async () => {
    for (const role of ["owner", "admin"] as const) {
      show([WAITING()], { role });
      await open(/Mentions a price/);
      expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual([expect.stringContaining("Mentions a price"), "Approve and send", "Edit", "Not now"]);
      cleanup();
    }
  });
  it.each(["sales", "viewer"] as const)("%s reads it and is told who decides", async (role) => {
    show([WAITING()], { role });
    await open(/Mentions a price/);
    expect(screen.queryByRole("button", { name: "Approve and send" })).toBeNull();
    expect(screen.getByText("Only the owner or an admin decides this.")).toBeInTheDocument();
  });
  it("a message that is not waiting has no decision buttons for anyone", async () => {
    show([SENT()], { tab: "sent" });
    await open(/Sent by Agent OWL/);
    expect(screen.queryByRole("button", { name: "Approve and send" })).toBeNull();
    expect(screen.queryByText("Only the owner or an admin decides this.")).toBeNull();
  });
  it("Approve and send calls approve with the id, the row leaves at once and a note says what really happened", async () => {
    let finish!: (v: { ok: true; message: string }) => void;
    const approve = vi.fn(() => new Promise<{ ok: true; message: string }>((r) => (finish = r)));
    show([WAITING()], { actions: fakeOutboxActions({ approve }) });
    await open(/Mentions a price/);
    await click("Approve and send");
    expect(approve).toHaveBeenCalledWith(WAITING().id);
    expect(screen.queryByRole("listitem")).toBeNull();
    expect(screen.queryByText("Sent to DEMO Lakshmi Textiles.")).toBeNull(); // no claim before the server answers
    await act(async () => finish({ ok: true, message: "Sent to DEMO Lakshmi Textiles." }));
    expect(screen.getByRole("status")).toHaveTextContent("Sent to DEMO Lakshmi Textiles.");
  });
  it("Not now calls reject", async () => {
    const actions = show([WAITING()]);
    await open(/Mentions a price/);
    await click("Not now");
    expect(actions.reject).toHaveBeenCalledWith(WAITING().id);
    expect(actions.approve).not.toHaveBeenCalled();
  });
  it("a refusal puts the row back with the reason, and without the second factor shows the way to Security", async () => {
    const approve = vi.fn(async () => ({ ok: false as const, error: "This needs your authenticator app. Nothing was changed.", mfa: true }));
    show([WAITING()], { actions: fakeOutboxActions({ approve }) });
    await open(/Mentions a price/);
    await click("Approve and send");
    expect(screen.getAllByRole("listitem").length).toBeGreaterThan(0); // the row is back (and still open)
    expect(screen.getByRole("alert")).toHaveTextContent("This needs your authenticator app.");
    expect(within(screen.getByRole("alert")).getByRole("link", { name: "Open Security" })).toHaveAttribute("href", "/app/security");
  });
  it("a card that is out of date makes the page read again", async () => {
    const reject = vi.fn(async () => ({ ok: false as const, error: "This changed meanwhile.", stale: true }));
    show([WAITING()], { actions: fakeOutboxActions({ reject }) });
    await open(/Mentions a price/);
    await click("Not now");
    expect(refresh).toHaveBeenCalled();
  });
  it("Edit changes the words in place, the message stays waiting, and a too-short text cannot be saved", async () => {
    const actions = show([WAITING()]);
    await open(/Mentions a price/);
    await click("Edit");
    const box = screen.getByLabelText(/Words/i);
    fireEvent.change(box, { target: { value: "x" } });
    expect(screen.getByRole("button", { name: "Save the new words" })).toBeDisabled();
    fireEvent.change(box, { target: { value: "ఈ చీర ధర 450 రూపాయలు." } });
    await click("Save the new words");
    expect(actions.edit).toHaveBeenCalledWith(WAITING().id, "ఈ చీర ధర 450 రూపాయలు.");
    expect(screen.getByText("ఈ చీర ధర 450 రూపాయలు.", { selector: "p" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Approve and send" })).toBeInTheDocument();
  });
});

describe("Send what is due now", () => {
  it("is offered to the Owner and the Admin in the Scheduled tab only, calls dispatch and says how many went", async () => {
    const actions = show([HELD()], { tab: "scheduled" });
    expect(screen.getByText("Sends only what may go. Messages held for quiet hours wait until 9:00.")).toBeInTheDocument();
    await click("Send what is due now");
    expect(actions.dispatch).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("status")).toHaveTextContent("2 sent.");
    expect(refresh).toHaveBeenCalled();
  });
  it("is not offered in the other tabs, or to Sales", () => {
    show([WAITING()], { tab: "waiting" });
    expect(screen.queryByRole("button", { name: "Send what is due now" })).toBeNull();
    cleanup();
    show([HELD()], { tab: "scheduled", role: "sales" });
    expect(screen.queryByRole("button", { name: "Send what is due now" })).toBeNull();
  });
  it("a refusal is shown in our words", async () => {
    const dispatch = vi.fn(async () => ({ ok: false as const, error: "Your role does not allow this. Nothing was changed." }));
    show([HELD()], { tab: "scheduled", actions: fakeOutboxActions({ dispatch }) });
    await click("Send what is due now");
    expect(screen.getByRole("status")).toHaveTextContent("Your role does not allow this.");
  });
});

describe("empty tabs", () => {
  it.each([
    ["waiting", "Nothing is waiting for you."],
    ["scheduled", "Nothing is held back for later."],
    ["sent", "Nothing was sent in this time."],
    ["blocked", "Nothing was blocked in this time."],
  ] as const)("%s says so, with the owl", (tab, text) => {
    show([], { tab });
    expect(screen.getByText(text)).toBeInTheDocument();
    expect(document.querySelector(`[data-empty="${tab}"] svg`)).not.toBeNull();
  });
});
