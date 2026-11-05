import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const refresh = vi.fn();
const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push }), usePathname: () => "/", useSearchParams: () => new URLSearchParams() }));

// the lazy picker (Today's first load) is the real one in a test
vi.mock("../visits/LazySlotPicker", async () => ({ SlotPicker: (await import("../visits/SlotPicker")).SlotPicker }));

import { appDict } from "@/i18n/app";

import { NeedsYou } from "./NeedsYou";
import { NeedsProvider } from "./needs-store";
import { todayWords } from "./today-words";
import { CALL_ID, MESSAGE_ID, NOW, U, VISIT_ID, WORDS, call, classic, fakeActions, outbox, proposal } from "./today-test-kit";
import type { NeedsCard, Role } from "./types";

// the tests of the cards draw the full cards at once; a test of the rows says so with `desktop()` (rows are what every screen draws, phone included)
let compactNext = false;
const board = (cards: NeedsCard[] | null, { role = "owner" as Role, actions = fakeActions(), waiting = cards?.length ?? null } = {}) => {
  const view = render(
    <NeedsProvider initial={cards} waiting={waiting}>
      <NeedsYou words={WORDS} role={role} actions={actions} now={NOW} lang="en" compact={compactNext} />
    </NeedsProvider>,
  );
  return { ...view, actions };
};
const cardOf = (name: RegExp | string) => screen.getByRole("article", { name });
const count = () => screen.getByRole("heading", { name: "Needs you" }).parentElement!.querySelector("[data-count]")!;

beforeEach(() => vi.clearAllMocks());
afterEach(() => {
  cleanup();
  compactNext = false;
});

describe("Needs you: the English gloss of a message in another language (job BE)", () => {
  it("shows an English gloss under the words so the person who approves can read it; none when the message has none", () => {
    const card = outbox() as Extract<NeedsCard, { type: "outbox" }>;
    board([{ ...card, message: { ...card.message!, gloss: "This saree costs ₹500 only." } } as NeedsCard]);
    const a = cardOf(/^Reply to Lakshmi R\./);
    expect(within(a).getByText("In English")).toBeInTheDocument();
    expect(within(a).getByText("This saree costs ₹500 only.")).toHaveAttribute("lang", "en");
    cleanup();
    board([outbox()]);
    expect(within(cardOf(/^Reply to Lakshmi R\./)).queryByText("In English")).toBeNull();
  });
});

describe("Needs you: a message that carries photos (job BC)", () => {
  it("shows the photos with the words, so the person who approves sees what goes out; a message without photos shows none", () => {
    const card = outbox() as Extract<NeedsCard, { type: "outbox" }>;
    board([{ ...card, message: { ...card.message!, media: [{ position: 1, thumb_url: "https://s.example/1_t.jpg?token=a" }, { position: 2, thumb_url: null }] } } as NeedsCard]);
    const a = cardOf(/^Reply to Lakshmi R\./);
    expect(within(a).getByAltText("Photo 1 of 2 sent with this message")).toHaveAttribute("src", "https://s.example/1_t.jpg?token=a");
    expect(within(a).getByText("No photo")).toBeInTheDocument();
    cleanup();
    board([outbox()]);
    expect(within(cardOf(/^Reply to Lakshmi R\./)).queryByRole("img")).toBeNull();
  });
});

describe("Needs you: each kind of card", () => {
  it("a WhatsApp message held for approval shows its exact words, the language it goes out in, why it waits and the three choices", () => {
    board([outbox()]);
    const a = cardOf(/^Reply to Lakshmi R\./);
    expect(within(a).getByText("Price · needs your OK")).toBeInTheDocument();
    expect(within(a).getByText("8:42")).toBeInTheDocument(); // the clock of today, in India
    expect(within(a).getByText(/ఈ చీర ధర 500 రూపాయలు మాత్రమే\./)).toHaveAttribute("lang", "te");
    expect(within(a).getByText("Goes out in Telugu")).toBeInTheDocument();
    expect(within(a).getByText(/Why it waits: It mentions money/)).toBeInTheDocument();
    for (const name of ["Approve and send", "Edit", "Not now"]) expect(within(a).getByRole("button", { name })).toBeInTheDocument();
  });
  it("the badge says what makes a message wait: a price, a promise, a complaint, or only that it needs a look", () => {
    const flags = (f: ("money" | "commitment" | "complaint")[]) => outbox({ key: `k-${f.join("")}`, message: { ...outbox().type === "outbox" ? (outbox() as Extract<NeedsCard, { type: "outbox" }>).message! : (null as never), flags: f } });
    board([flags(["money"]), flags(["commitment"]), flags(["complaint"]), flags([])]);
    expect(screen.getAllByText(/ · needs your OK$/).map((n) => n.textContent)).toEqual(["Price · needs your OK", "Promise · needs your OK", "Complaint · needs your OK", "Message · needs your OK"]);
  });
  it("a request for a call has the reason and the two choices", () => {
    board([call()]);
    const a = cardOf("Suresh K. asked for a call");
    expect(within(a).getByText("Call · needs your OK")).toBeInTheDocument();
    expect(within(a).getByText("Wedding order, about 12 sarees. Prefers after 6 pm.")).toBeInTheDocument();
    expect(within(a).getByRole("button", { name: "Approve call" })).toBeInTheDocument();
    expect(within(a).getByRole("button", { name: "Offer a store visit" })).toBeInTheDocument();
  });
  it("the older kinds are cards that open the page that decides, and send nothing", () => {
    board([classic(), classic({ kind: "order_money_held", id: "o1", agent: "order_desk", href: "/app/tenants/T/orders/O" })].map((c, i) => (i === 1 ? { ...c, key: "order_money_held-o1" } : c)));
    const a = screen.getAllByRole("article")[0];
    expect(within(a).getByText("Quote draft")).toBeInTheDocument();
    expect(within(a).getByText("₹14,175.00")).toBeInTheDocument();
    expect(within(a).getByRole("link", { name: "Check the quote" })).toHaveAttribute("href", "/app/tenants/T/enquiries/E");
    expect(within(a).getByRole("link", { name: /Open/ })).toHaveAttribute("href", "/app/tenants/T/enquiries/E");
    expect(within(a).getByText("Nothing is sent, approved or recorded by opening this.")).toBeInTheDocument();
    expect(within(a).queryByRole("button")).toBeNull();
  });
  it("a customer with no name is 'a customer'", () => {
    board([outbox({ customer: null, city: null }), call({ customer: null })]);
    expect(screen.getByRole("article", { name: "Reply to a customer" })).toBeInTheDocument();
    expect(screen.getByRole("article", { name: "a customer asked for a call" })).toBeInTheDocument();
  });
});

describe("Needs you: the decisions call the right endpoint, and the card leaves at once", () => {
  it("Approve and send calls approveMessage with the message's id, the card leaves before the answer, and the toast tells what really happened", async () => {
    let finish!: (v: { ok: true; message: string }) => void;
    const approveMessage = vi.fn(() => new Promise<{ ok: true; message: string }>((r) => (finish = r)));
    board([outbox(), call()], { actions: fakeActions({ approveMessage }) });
    fireEvent.click(within(cardOf(/Reply to/)).getByRole("button", { name: "Approve and send" }));
    expect(approveMessage).toHaveBeenCalledWith(MESSAGE_ID);
    expect(screen.queryByRole("article", { name: /Reply to/ })).toBeNull(); // gone at once (optimistic)
    expect(count()).toHaveTextContent("1");
    expect(screen.queryByText("Sent to Lakshmi R.")).toBeNull(); // no claim before the server answers
    await act(async () => finish({ ok: true, message: "Sent to Lakshmi R." }));
    expect(screen.getByRole("status")).toHaveTextContent("Sent to Lakshmi R.");
  });
  it("Not now, Approve call and Offer a store visit each call their own action with the id", async () => {
    const actions = fakeActions();
    board([outbox(), call()], { actions });
    await act(async () => fireEvent.click(within(cardOf(/Reply to/)).getByRole("button", { name: "Not now" })));
    expect(actions.rejectMessage).toHaveBeenCalledWith(MESSAGE_ID);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Approve call" })));
    expect(actions.approveCall).toHaveBeenCalledWith(CALL_ID);
    expect(screen.getByRole("status")).toHaveTextContent("Call approved for Suresh K. Nothing is dialled by this app.");
    expect(actions.approveMessage).not.toHaveBeenCalled();
    expect(actions.offerVisit).not.toHaveBeenCalled();
  });
  it("Offer a store visit calls offerVisit with the language of the request, and the toast says the offer is queued in the outbox", async () => {
    const actions = fakeActions();
    board([call()], { actions });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Offer a store visit" })));
    expect(actions.offerVisit).toHaveBeenCalledWith(CALL_ID, "hi");
    expect(screen.getByRole("status")).toHaveTextContent("The call is declined and the visit offer is queued in the outbox.");
    expect(screen.queryByRole("article")).toBeNull(); // the call leaves the list
  });
  it("a call whose reason could not be read offers the visit in English", async () => {
    const actions = fakeActions();
    board([call({ request: null })], { actions });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Offer a store visit" })));
    expect(actions.offerVisit).toHaveBeenCalledWith(CALL_ID, "en");
  });
  it("a refusal puts the card back where it was, with the reason; a missing second factor shows the way to Security", async () => {
    const approveMessage = vi.fn(async () => ({ ok: false as const, error: "This needs your two-step code, if you turned it on. Nothing was changed.", mfa: true }));
    board([classic(), outbox(), call()], { actions: fakeActions({ approveMessage }) });
    await act(async () => fireEvent.click(within(cardOf(/Reply to/)).getByRole("button", { name: "Approve and send" })));
    const articles = screen.getAllByRole("article").map((a) => a.getAttribute("aria-labelledby"));
    expect(articles).toEqual([expect.stringContaining("quote_approval"), expect.stringContaining("outbox_approval"), expect.stringContaining("call_approval")]); // same place
    const a = cardOf(/Reply to/);
    expect(within(a).getByRole("alert")).toHaveTextContent("This needs your two-step code, if you turned it on. Nothing was changed.");
    expect(within(a).getByRole("link", { name: "Open Security" })).toHaveAttribute("href", "/app/security");
    expect(count()).toHaveTextContent("3");
    expect(screen.getByRole("status")).toBeEmptyDOMElement(); // no toast for a refusal
  });
  it("a card that is out of date makes the page read again", async () => {
    const rejectMessage = vi.fn(async () => ({ ok: false as const, error: "This changed while you were looking.", stale: true }));
    board([outbox()], { actions: fakeActions({ rejectMessage }) });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Not now" })));
    expect(refresh).toHaveBeenCalled();
    expect(cardOf(/Reply to/)).toBeInTheDocument();
  });
  it("an action that throws is a refusal too, never a lost card", async () => {
    const approveCall = vi.fn(async () => {
      throw new Error("network");
    });
    board([call()], { actions: fakeActions({ approveCall }) });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Approve call" })));
    expect(cardOf("Suresh K. asked for a call")).toBeInTheDocument();
  });
});

describe("Needs you: editing the words", () => {
  it("opens the words in a box, saves them through editMessage, shows the words the server kept, and sends nothing", async () => {
    const actions = fakeActions();
    board([outbox()], { actions });
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    const box = screen.getByRole("textbox", { name: "The words that go to the customer" });
    expect((box as HTMLTextAreaElement).value).toContain("ధర 500");
    expect(screen.getByText("The line that says an AI assistant wrote it stays. Nothing is sent until you approve.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Approve and send" })).toBeNull(); // no approving while editing
    fireEvent.change(box, { target: { value: "మా కొత్త చీరలు చూడండి" } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Save the new words" })));
    expect(actions.editMessage).toHaveBeenCalledWith(MESSAGE_ID, "మా కొత్త చీరలు చూడండి");
    expect(actions.approveMessage).not.toHaveBeenCalled();
    expect(screen.getByText("మా కొత్త చీరలు చూడండి")).toBeInTheDocument(); // back to reading, with the new words
    expect(screen.getByRole("button", { name: "Approve and send" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Saved. Read it once more, then approve.");
  });
  it("cannot save fewer than two characters, shows a refusal, and Cancel leaves the words as they were", async () => {
    const editMessage = vi.fn(async () => ({ ok: false as const, error: "That did not work. Nothing was changed. Try again." }));
    board([outbox()], { actions: fakeActions({ editMessage }) });
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    const box = screen.getByRole("textbox");
    fireEvent.change(box, { target: { value: " a " } });
    expect(screen.getByRole("button", { name: "Save the new words" })).toBeDisabled();
    fireEvent.change(box, { target: { value: "two words" } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Save the new words" })));
    expect(screen.getByRole("alert")).toHaveTextContent("That did not work. Nothing was changed. Try again.");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByText(/ఈ చీర ధర 500/)).toBeInTheDocument();
  });
});

describe("Needs you: who sees which buttons", () => {
  it("the Owner decides messages and calls", () => {
    board([outbox(), call()], { role: "owner" });
    expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual(["Approve and send", "Edit", "Not now", "Approve call", "Offer a store visit"]);
  });
  it("an Admin decides messages, and a call says only the owner decides it", () => {
    board([outbox(), call()], { role: "admin" });
    expect(within(cardOf(/Reply to/)).getByRole("button", { name: "Approve and send" })).toBeInTheDocument();
    const c = cardOf("Suresh K. asked for a call");
    expect(within(c).queryByRole("button")).toBeNull();
    expect(within(c).getByText("Only the owner decides a call.")).toBeInTheDocument();
  });
  it.each(["sales", "viewer"] as const)("%s sees the cards but no decision buttons", (role) => {
    board([outbox(), call(), classic()], { role });
    expect(screen.queryByRole("button", { name: /Approve|Edit|Not now|Offer/ })).toBeNull();
    expect(screen.getByText("Only the owner decides a call.")).toBeInTheDocument();
  });
  it("with no actions given (nothing to call) there are no buttons either", () => {
    render(
      <NeedsProvider initial={[outbox()]} waiting={1}>
        <NeedsYou words={WORDS} role="owner" actions={null} now={NOW} compact={false} />
      </NeedsProvider>,
    );
    expect(screen.queryByRole("button")).toBeNull();
  });
  it("words that could not be loaded are never approved blind: the card says so and offers no button", () => {
    board([outbox({ message: null })]);
    const a = cardOf(/Reply to|Message for/);
    expect(within(a).getByText(/could not be loaded, so it cannot be approved here/)).toBeInTheDocument();
    expect(within(a).queryByRole("button")).toBeNull();
  });
});

describe("Needs you: the count is the cards", () => {
  it("shows as many as it counts, and counts down as the cards leave", async () => {
    board([classic(), outbox(), call()]);
    expect(count()).toHaveTextContent("3");
    expect(screen.getAllByRole("article")).toHaveLength(3);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Not now" })));
    expect(count()).toHaveTextContent("2");
    expect(screen.getAllByRole("article")).toHaveLength(2);
  });
  it("when the API counts more than it lists (it lists the newest twenty) the count is the real one and a line says how many are shown", () => {
    board([classic(), outbox()], { waiting: 25 });
    expect(count()).toHaveTextContent("25");
    expect(screen.getByText("Showing the newest 2 of 25. The rest are in the lists of each screen.")).toBeInTheDocument();
    expect(screen.getAllByRole("article")).toHaveLength(2);
  });
  it("no note when the count and the cards agree", () => {
    board([classic()], { waiting: 1 });
    expect(screen.queryByText(/Showing the newest/)).toBeNull();
  });
});

describe("Needs you: empty, unreadable, and the phone", () => {
  it("nothing waiting is one slim line (a check mark, no card, no circle: the page has a single orb) and no people", () => {
    const { container } = board([]);
    expect(screen.getByText("All clear. I will tell you the moment something needs you.")).toBeInTheDocument();
    const line = container.querySelector('[data-empty="needs"]') as HTMLElement;
    expect(line.tagName).toBe("P");
    expect(line.querySelector("[data-orb]")).toBeNull();
    expect(container.querySelector("[data-orb]")).toBeNull();
    expect(screen.queryByRole("article")).toBeNull();
    expect(count()).toHaveTextContent("0");
  });
  it("an unreadable Today says 'Not available yet' and draws no count", () => {
    const { container } = board(null);
    expect(screen.getByText("Not available yet")).toBeInTheDocument();
    expect(container.querySelector("[data-count]")).toBeNull();
  });
  it("at most three rows show (a phone as a desktop), and 'See all' shows the rest (and 'Show fewer' hides them again)", () => {
    const many = [classic(), outbox(), call(), classic({ id: "x2" }), classic({ id: "x3" })].map((c, i) => ({ ...c, key: `k${i}` }) as NeedsCard);
    board(many);
    const items = () => within(screen.getByRole("heading", { name: "Needs you" }).closest("section")!).getAllByRole("listitem");
    expect(items().map((li) => (li.className.includes("hidden") ? "hidden" : "shown"))).toEqual(["shown", "shown", "shown", "hidden", "hidden"]);
    fireEvent.click(screen.getByRole("button", { name: "See all (5)" }));
    expect(items().some((li) => li.className.includes("hidden"))).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Show fewer" }));
    expect(items().filter((li) => li.className.includes("hidden"))).toHaveLength(2);
  });
  it("three cards or fewer have no 'See all', and there is no explainer paragraph (it is in the ? help)", () => {
    board([classic(), outbox(), call()]);
    expect(screen.queryByText(/always wait for you/)).toBeNull();
    expect(screen.queryByRole("button", { name: /See all/ })).toBeNull();
  });
  it("the toast goes away by itself", async () => {
    vi.useFakeTimers();
    try {
      board([call()]);
      await act(async () => fireEvent.click(screen.getByRole("button", { name: "Approve call" })));
      expect(screen.getByRole("status")).toHaveTextContent("Call approved");
      await act(async () => void vi.advanceTimersByTime(6100));
      expect(screen.getByRole("status")).toBeEmptyDOMElement();
    } finally {
      vi.useRealTimers();
    }
  });
});


describe("Needs you: a visit your assistant proposed", () => {
  const card = () => cardOf(/^Your assistant proposed a visit for Priya S\./);
  it("shows who, when (the Indian day and clock), how many and what for, and says nothing was sent", () => {
    board([proposal()]);
    const a = card();
    expect(within(a).getByText("Visit · needs your OK")).toBeInTheDocument();
    expect(within(a).getByText("Wed, 14 Oct, 11:00")).toBeInTheDocument();
    expect(within(a).getByText("3 people")).toBeInTheDocument();
    expect(within(a).getByText("Bridal sarees")).toBeInTheDocument();
    expect(within(a).getByText("Hyderabad", { exact: false })).toBeInTheDocument();
    expect(within(a).getByText("Booked, but not confirmed with the customer yet. Nothing was sent to the customer.")).toBeInTheDocument();
    expect(within(a).getAllByRole("button").map((b) => b.textContent)).toEqual(["Confirm the visit", "Change time", "Cancel the visit"]);
  });
  it("counts as one of the things that need the person", () => {
    board([outbox(), proposal()]);
    expect(count()).toHaveTextContent("2");
  });
  it("Confirm calls confirm with the visit's id, the card leaves, and the toast says nothing was sent", async () => {
    const { actions } = board([proposal()]);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Confirm the visit" })));
    expect(actions.visit.confirm).toHaveBeenCalledWith(VISIT_ID);
    expect(screen.queryByRole("article")).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent("Confirmed for Priya S., and nothing was sent to the customer.");
  });
  it("Cancel calls cancel with the id and no reason", async () => {
    const { actions } = board([proposal()]);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Cancel the visit" })));
    expect(actions.visit.cancel).toHaveBeenCalledWith(VISIT_ID, "");
    expect(screen.queryByRole("article")).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent("Cancelled for Priya S.");
  });
  it("a refusal puts the card back with the reason and the way to Security when the second factor is missing", async () => {
    const actions = fakeActions();
    actions.visit.confirm.mockResolvedValueOnce({ ok: false, error: "This needs your two-step code, if you turned it on. Nothing was changed.", mfa: true } as never);
    board([proposal()], { actions });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Confirm the visit" })));
    expect(within(card()).getByRole("alert")).toHaveTextContent("This needs your two-step code, if you turned it on.");
    expect(within(card()).getByRole("link", { name: "Open Security" })).toBeInTheDocument();
  });
  it("Change time opens the days' free times, moves the visit, and the card shows the new time", async () => {
    const { actions } = board([proposal()]);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Change time" })));
    expect(actions.visit.slots).toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Move the visit" })).toBeDisabled(); // no time chosen yet
    await act(async () => fireEvent.change(screen.getByLabelText("Day"), { target: { value: "2026-10-15" } }));
    expect(actions.visit.slots).toHaveBeenLastCalledWith("2026-10-15");
    await act(async () => fireEvent.click(screen.getByRole("button", { name: /^12:00/ })));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Move the visit" })));
    expect(actions.visit.move).toHaveBeenCalledWith(VISIT_ID, "2026-10-15", "12:00");
    expect(within(card()).getByText("Thu, 15 Oct, 12:00")).toBeInTheDocument(); // still a card: it is waiting for the customer again
    expect(screen.getByRole("status")).toHaveTextContent(/^Moved to /);
    expect(within(card()).getAllByRole("button").map((b) => b.textContent)).toEqual(["Confirm the visit", "Change time", "Cancel the visit"]);
  });
  it("a move that is refused keeps the picker open and shows the reason", async () => {
    const actions = fakeActions();
    actions.visit.move.mockResolvedValueOnce({ ok: false, error: "Every place at that time is taken. Choose another time." } as never);
    board([proposal()], { actions });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Change time" })));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: /^11:00/ })));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Move the visit" })));
    expect(screen.getByRole("alert")).toHaveTextContent("Every place at that time is taken. Choose another time.");
    expect(screen.getByRole("button", { name: "Move the visit" })).toBeInTheDocument();
  });
  it("a Viewer sees the card without buttons; Sales and Admin may decide it", () => {
    board([proposal()], { role: "viewer" });
    expect(within(card()).queryByRole("button")).toBeNull();
    cleanup();
    for (const role of ["sales", "admin", "owner"] as const) {
      board([proposal()], { role });
      expect(within(card()).getAllByRole("button")).toHaveLength(3);
      cleanup();
    }
  });
  it("offers no buttons when the server gave no actions for visits", () => {
    board([proposal()], { actions: fakeActions({ visit: null }) });
    expect(within(card()).queryByRole("button")).toBeNull();
  });
});

describe("Needs you: Lead Desk (hot leads, plans, callbacks, limits) and the 'All clear' rule", () => {
  const desk = (kind: "hot_lead_waiting" | "plan_waiting" | "callback_due" | "outreach_paused", over: Partial<Extract<NeedsCard, { type: "item" }>["item"]> = {}): NeedsCard => ({
    type: "item",
    key: `${kind}-${U}`,
    at: "2026-10-11T03:12:00Z",
    item: { kind, id: U, customer: "Ravi K.", city: null, agent: "followup_desk", summary: `summary of ${kind}`, at: "2026-10-11T03:12:00Z", amount_paise: null, href: "/app/tenants/T/outreach", ...over },
  });
  it.each([
    ["hot_lead_waiting", "Hot lead", "Call back now", "Customer"],
    ["plan_waiting", "Plan to approve", "Review and approve", "Plan"],
    ["callback_due", "Callbacks due", "See the callbacks", "Plan"],
    ["outreach_paused", "Limit reached", "Review the limit", "Plan"],
  ] as const)("a %s card says what it is, names its first fact and opens the page that decides", (kind, label, step, who) => {
    board([desk(kind)]);
    const a = cardOf(/^Ravi K\./);
    expect(within(a).getByText(label)).toBeInTheDocument();
    expect(within(a).getByText(who)).toBeInTheDocument();
    expect(within(a).getByRole("link", { name: step })).toHaveAttribute("href", "/app/tenants/T/outreach");
    expect(within(a).getByText(`summary of ${kind}`)).toBeInTheDocument();
  });
  it("a hot lead with no name is 'a customer'", () => {
    board([desk("hot_lead_waiting", { customer: "" })]);
    expect(within(cardOf(/^a customer/i)).getByText("Hot lead")).toBeInTheDocument();
  });
  it("says 'All clear' when the count is 0 and only then", () => {
    board([], { waiting: 0 });
    expect(count()).toHaveAttribute("data-count", "0");
    expect(screen.getByText(/All clear/)).toBeInTheDocument();
    cleanup();
    // two things wait but none is listed: the count says two and nobody is told it is all clear
    board([], { waiting: 2 });
    expect(count()).toHaveAttribute("data-count", "2");
    expect(screen.queryByText(/All clear/)).toBeNull();
    cleanup();
    board([desk("hot_lead_waiting")], { waiting: 1 });
    expect(count()).toHaveAttribute("data-count", "1");
    expect(screen.queryByText(/All clear/)).toBeNull();
  });
});

describe("Needs you on a desktop: one compact row per thing (owner 31 Oct)", () => {
  const desktop = () => {
    compactNext = true;
  };
  const rows = () => [...document.querySelectorAll("[data-needs-row]")] as HTMLElement[];
  it("each thing is ONE line: badge, title, a short reason, how long ago, the quick buttons on the right and Details; the three newest show, then See all", () => {
    desktop();
    board([classic(), outbox(), call(), classic({ id: "x2" }), classic({ id: "x3" })].map((c, i) => ({ ...c, key: `k${i}` }) as NeedsCard));
    expect(rows()).toHaveLength(5);
    expect(screen.queryAllByRole("article")).toHaveLength(0); // no full card until Details
    const items = within(screen.getByRole("heading", { name: "Needs you" }).closest("section")!).getAllByRole("listitem");
    expect(items.map((li) => li.className.split(" ").includes("hidden"))).toEqual([false, false, false, true, true]); // three rows on a desktop (the third is only hidden on a phone)
    const message = rows()[1];
    expect(within(message).getByText("Price")).toBeInTheDocument(); // the short badge, not "Price · needs your OK"
    expect(within(message).getByRole("heading", { level: 3 })).toHaveTextContent("Reply to Lakshmi R.");
    expect(within(message).getByText(/ఈ చీర ధర 500/)).toBeInTheDocument(); // the first words of the message, one line
    expect(within(message).getByRole("button", { name: "Approve and send" })).toHaveTextContent(/^Approve$/); // short on the row, the full words for a screen reader
    expect(within(message).getByRole("button", { name: "Not now" })).toBeInTheDocument();
    expect(within(message).getByRole("button", { name: "Details" })).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByRole("button", { name: "See all (5)" })).toBeInTheDocument();
  });
  it("the quick buttons do what the card's buttons do: Approve and send, Approve call", async () => {
    desktop();
    const { actions } = board([outbox(), call()].map((c, i) => ({ ...c, key: `k${i}` }) as NeedsCard));
    await act(async () => void fireEvent.click(within(rows()[0]).getByRole("button", { name: "Approve and send" })));
    expect(actions.approveMessage).toHaveBeenCalledWith(MESSAGE_ID);
    await act(async () => void fireEvent.click(within(rows()[0]).getByRole("button", { name: "Approve call" })));
    expect(actions.approveCall).toHaveBeenCalledWith(CALL_ID);
  });
  it("Details opens the whole card in the row's place, with all its buttons; Show less folds it back", () => {
    desktop();
    board([outbox()]);
    fireEvent.click(screen.getByRole("button", { name: "Details" }));
    const a = cardOf(/^Reply to Lakshmi R\./);
    expect(within(a).getByRole("button", { name: "Edit" })).toBeInTheDocument();
    expect(within(a).getByText("Goes out in Telugu")).toBeInTheDocument();
    expect(rows()).toHaveLength(0);
    fireEvent.click(within(a).getByRole("button", { name: "Show less" }));
    expect(rows()).toHaveLength(1);
    expect(screen.queryByRole("article")).toBeNull();
  });
  it("a role that may not decide gets the row and Details, no quick buttons", () => {
    desktop();
    board([outbox(), call()].map((c, i) => ({ ...c, key: `k${i}` }) as NeedsCard), { role: "sales" });
    for (const r of rows()) expect(within(r).queryByRole("button", { name: /Approve/ })).toBeNull();
    expect(within(rows()[0]).getByRole("button", { name: "Details" })).toBeInTheDocument();
  });
});

describe("the call row on a desktop, as the owner's target draws it", () => {
  const desktop = () => {
    compactNext = true;
  };
  const asked = call({ customer: "Ramesh", request: { reason: "Follow up on the question about the price and a visit.", language: "en" } } as never);
  it("a short badge, 'Name asked for a call · price and visit' on one line, then Approve and Store visit", () => {
    desktop();
    board([asked]);
    const row = document.querySelector("[data-needs-row]") as HTMLElement;
    expect(within(row).getByText("Call")).toBeInTheDocument();
    expect(row).toHaveTextContent("Ramesh asked for a call · price and visit");
    expect(within(row).getByRole("button", { name: "Approve call" })).toHaveTextContent(/^Approve$/);
    expect(within(row).getByRole("button", { name: "Offer a store visit" })).toHaveTextContent(/^Store visit$/);
    expect(row).not.toHaveTextContent("needs your OK");
  });
  it("in Telugu every part of the row is Telugu, except the name (the reason comes from the translations, not from the English sentence)", () => {
    desktop();
    const te = todayWords((k) => (appDict("te") as Record<string, string>)[k] ?? k);
    render(
      <NeedsProvider initial={[asked]} waiting={1}>
        <NeedsYou words={te} role="owner" actions={fakeActions()} now={NOW} lang="te" compact />
      </NeedsProvider>,
    );
    const row = document.querySelector("[data-needs-row]") as HTMLElement;
    const text = row.textContent ?? "";
    expect(text).toContain("Ramesh");
    expect(text).toContain("ధర మరియు విజిట్");
    expect(text.replace("Ramesh", "")).not.toMatch(/[A-Za-z]{3}/); // no English word is left
  });
});

describe("Needs you: a new business from the Lead Finder (job lead-finder part D)", () => {
  const prospect = (summary: string): NeedsCard => ({ type: "item", key: `prospect_waiting-${U}`, at: "2026-10-11T03:12:00Z", item: { kind: "prospect_waiting", id: U, customer: "Sri Sai Constructions", city: null, agent: "lead_finder", summary, at: "2026-10-11T03:12:00Z", amount_paise: null, href: `/app/tenants/T/retailers?id=${U}` } });
  it("is one short row, 'name · fit · reason', that opens the Prospects tab on that business", () => {
    compactNext = true;
    board([prospect("fit 64 · low stock")]);
    const row = document.querySelector(`[data-needs-row="prospect_waiting-${U}"]`) as HTMLElement;
    expect(row.textContent).toContain("Prospect");
    expect(row.textContent).toContain("Sri Sai Constructions · fit 64 · low stock");
    expect(within(row).getByRole("link", { name: "Decide" })).toHaveAttribute("href", `/app/tenants/T/retailers?id=${U}`);
  });
  it("keeps its reason in Telugu too (the words are ours, not the API's English)", () => {
    const te = appDict("te") as Record<string, string>;
    render(
      <NeedsProvider initial={[prospect("ఫిట్ 64 · స్టాక్ తక్కువ")]} waiting={1}>
        <NeedsYou words={todayWords((k) => te[k] ?? k)} role="owner" actions={fakeActions()} now={NOW} lang="te" compact />
      </NeedsProvider>,
    );
    const row = document.querySelector(`[data-needs-row="prospect_waiting-${U}"]`) as HTMLElement;
    expect(row.textContent).toContain("Sri Sai Constructions · ఫిట్ 64 · స్టాక్ తక్కువ");
  });
});

describe("Needs you: a caller who asked for a person (C1 #347)", () => {
  const LEAD = "/app/tenants/11111111-1111-4111-8111-111111111111/leads/22222222-2222-4222-8222-222222222222";
  const person = (over: Partial<Extract<NeedsCard, { type: "person" }>> = {}): NeedsCard => ({ type: "person", key: `person_requested-${CALL_ID}`, at: new Date(NOW - 10 * 60_000).toISOString(), id: CALL_ID, customer: "Ravi K.", city: "Guntur", leadHref: LEAD, gist: "Wants to talk about a bulk order.", visitAt: null, bookHref: null, ...over });
  it("says who asked, with Call back (the lead) and Done; Done takes it off and says so", async () => {
    const { actions } = board([person()]);
    const a = cardOf(/^Ravi K\. asked to talk to a person/);
    expect(within(a).getByText("Wants to talk about a bulk order.")).toHaveAttribute("lang", "en");
    expect(within(a).getByRole("link", { name: "Call back" })).toHaveAttribute("href", LEAD);
    await act(async () => fireEvent.click(within(a).getByRole("button", { name: "Done, we called back" })));
    expect(actions.callHandled).toHaveBeenCalledWith(CALL_ID);
    expect(screen.queryByRole("article")).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent("Marked as done. It's off your list.");
  });
  it("a call with no lead has no Call back; a Viewer gets no Done", () => {
    board([person({ leadHref: null })], { role: "viewer" });
    const a = cardOf(/asked to talk to a person/);
    expect(within(a).queryByRole("link", { name: "Call back" })).toBeNull();
    expect(within(a).queryByRole("button", { name: /Done/ })).toBeNull();
  });
  it("a refusal puts the card back with the reason", async () => {
    board([person()], { actions: fakeActions({ callHandled: vi.fn(async () => ({ ok: false as const, error: "This changed meanwhile.", stale: true })) }) });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Done, we called back" })));
    expect(cardOf(/asked to talk to a person/)).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("This changed meanwhile.");
  });
  it("a caller who agreed a visit time (C1 #354): the day and time in the title, Book opens Visits on that time, Done as before", async () => {
    const book = "/app/tenants/T/visits?date=2026-11-03&time=10:00&lead=22222222-2222-4222-8222-222222222222";
    const { actions } = board([person({ key: `visit_requested-${CALL_ID}`, visitAt: "2026-11-03T04:30:00Z", bookHref: book })]);
    const a = cardOf(/^Ravi K\. wants to visit on .*10:00/);
    expect(within(a).getByRole("link", { name: "Book" })).toHaveAttribute("href", book);
    expect(within(a).queryByRole("link", { name: "Call back" })).toBeNull();
    expect(within(a).getByText("Book it in Visits, then mark it done.")).toBeInTheDocument();
    await act(async () => fireEvent.click(within(a).getByRole("button", { name: "Done, we called back" })));
    expect(actions.callHandled).toHaveBeenCalledWith(CALL_ID);
  });
  it("as a row: the short badge, the title, Call back and Done", () => {
    compactNext = true;
    board([person()]);
    const row = document.querySelector(`[data-needs-row="person_requested-${CALL_ID}"]`) as HTMLElement;
    expect(row).toHaveTextContent("Person");
    expect(within(row).getByRole("link", { name: "Call back" })).toBeInTheDocument();
    expect(within(row).getByRole("button", { name: "Done, we called back" })).toHaveTextContent("Done");

describe("Needs you: the Lead Finder's rows and See all (owner, 5 Nov)", () => {
  const P = "b1b1b1b1-0000-4000-8000-000000000001";
  const prospect = (n: number, over: Partial<Extract<NeedsCard, { type: "item" }>["item"]> = {}): NeedsCard => {
    const id = `b1b1b1b1-0000-4000-8000-00000000000${n}`;
    return classic({ kind: "prospect_waiting", id, customer: `Boutique ${n}`, city: null, agent: "lead_finder", summary: "fit 93 · 1 of the first 10 calls — needs your OK", rowLine: "Jayanagar · 4.6★ · fit 93", prospect: { area: "Jayanagar", rating: 4.6, needsOk: true }, amount_paise: null, href: `/app/tenants/T/retailers?id=${id}`, ...over }) as NeedsCard;
  };
  const keyed = (cards: NeedsCard[]) => cards.map((c, i) => ({ ...c, key: `k${i}` }) as NeedsCard);
  const rowsOf = () => [...document.querySelectorAll("[data-needs-row]")] as HTMLElement[];
  it("a prospect row says where and how good, 'Needs OK' is a small badge, and it has Call and Skip instead of Decide", () => {
    compactNext = true;
    board([prospect(1)]);
    const row = rowsOf()[0];
    expect(within(row).getByRole("heading", { level: 3 })).toHaveTextContent(/^Boutique 1$/);
    expect(row).toHaveTextContent("Jayanagar · 4.6★ · fit 93");
    expect(row).not.toHaveTextContent("first 10 calls");
    expect(row.querySelector("[data-needs-tag]")).toHaveTextContent("Needs OK");
    expect(within(row).getByRole("button", { name: "Call" })).toBeInTheDocument();
    expect(within(row).getByRole("button", { name: "Skip" })).toBeInTheDocument();
    expect(within(row).queryByRole("link", { name: "Decide" })).toBeNull();
  });
  it("Call is the Owner's yes and then opens that business's practice call; Skip takes the row off; a refusal puts it back", async () => {
    compactNext = true;
    const { actions } = board(keyed([prospect(1), prospect(2)]));
    await act(async () => void fireEvent.click(within(rowsOf()[0]).getByRole("button", { name: "Call" })));
    expect(actions.prospect.call).toHaveBeenCalledWith(P);
    expect(push).toHaveBeenCalledWith(`/app/tenants/T/retailers?id=${P}&practice=1`);
    expect(screen.getByRole("status")).toHaveTextContent("Yes to calling");
    await act(async () => void fireEvent.click(within(rowsOf()[0]).getByRole("button", { name: "Skip" })));
    expect(actions.prospect.skip).toHaveBeenCalledWith("b1b1b1b1-0000-4000-8000-000000000002");
    expect(rowsOf()).toHaveLength(0);
    cleanup();
    const no = vi.fn(async () => ({ ok: false as const, error: "Someone decided this meanwhile.", stale: true }));
    const refused = fakeActions();
    refused.prospect.skip = no;
    board([prospect(1)], { actions: refused });
    await act(async () => void fireEvent.click(within(rowsOf()[0]).getByRole("button", { name: "Skip" })));
    expect(rowsOf()).toHaveLength(1);
    expect(push).toHaveBeenCalledTimes(1);
  });
  it("the 'N more' row and a person with no prospect buttons keep 'Decide'", () => {
    compactNext = true;
    board([prospect(1, { id: "more", customer: "11 more prospects", prospect: undefined, rowLine: undefined, count: 11, summary: "need you on the Prospects tab", href: "/app/tenants/T/retailers?status=needs_owner" })]);
    expect(within(rowsOf()[0]).getByRole("link", { name: "Decide" })).toHaveAttribute("href", "/app/tenants/T/retailers?status=needs_owner");
    cleanup();
    board([prospect(1)], { actions: { ...fakeActions(), prospect: null } as never });
    expect(within(rowsOf()[0]).getByRole("link", { name: "Decide" })).toBeInTheDocument();
    expect(within(rowsOf()[0]).queryByRole("button", { name: "Call" })).toBeNull();
  });
  it("the count is of things: 4 quotes + 5 businesses + '11 more' says 20, and See all (20) opens every row", () => {
    compactNext = true;
    const quotes = [1, 2, 3, 4].map((n) => classic({ id: `q${n}` }));
    const more = prospect(6, { id: "more", customer: "11 more prospects", prospect: undefined, rowLine: undefined, count: 11 });
    board(keyed([...quotes, ...[1, 2, 3, 4, 5].map((n) => prospect(n)), more]), { waiting: 20 });
    expect(count()).toHaveTextContent("20");
    const all = screen.getByRole("button", { name: "See all (20)" });
    expect(all).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(all);
    expect(within(screen.getByRole("heading", { name: "Needs you" }).closest("section")!).getAllByRole("listitem").filter((li) => li.className.includes("hidden"))).toHaveLength(0);
    expect(screen.queryByText(/Showing the newest/)).toBeNull();
  });
});
