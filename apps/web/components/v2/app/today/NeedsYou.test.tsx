import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: () => undefined }), usePathname: () => "/", useSearchParams: () => new URLSearchParams() }));

import { NeedsYou } from "./NeedsYou";
import { NeedsProvider } from "./needs-store";
import { CALL_ID, MESSAGE_ID, NOW, WORDS, call, classic, fakeActions, outbox } from "./today-test-kit";
import type { NeedsCard, Role } from "./types";

const board = (cards: NeedsCard[] | null, { role = "owner" as Role, actions = fakeActions(), waiting = cards?.length ?? null } = {}) => {
  const view = render(
    <NeedsProvider initial={cards} waiting={waiting}>
      <NeedsYou words={WORDS} role={role} actions={actions} now={NOW} />
    </NeedsProvider>,
  );
  return { ...view, actions };
};
const cardOf = (name: RegExp | string) => screen.getByRole("article", { name });
const count = () => screen.getByRole("heading", { name: "Needs you" }).parentElement!.querySelector("[data-count]")!;

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

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
  it("Offer a store visit calls offerVisit, and the toast does not claim the offer was sent", async () => {
    const actions = fakeActions();
    board([call()], { actions });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Offer a store visit" })));
    expect(actions.offerVisit).toHaveBeenCalledWith(CALL_ID);
    expect(screen.getByRole("status")).toHaveTextContent(/This app has not sent the offer/);
  });
  it("a refusal puts the card back where it was, with the reason; a missing second factor shows the way to Security", async () => {
    const approveMessage = vi.fn(async () => ({ ok: false as const, error: "This needs your authenticator app. Nothing was changed.", mfa: true }));
    board([classic(), outbox(), call()], { actions: fakeActions({ approveMessage }) });
    await act(async () => fireEvent.click(within(cardOf(/Reply to/)).getByRole("button", { name: "Approve and send" })));
    const articles = screen.getAllByRole("article").map((a) => a.getAttribute("aria-labelledby"));
    expect(articles).toEqual([expect.stringContaining("quote_approval"), expect.stringContaining("outbox_approval"), expect.stringContaining("call_approval")]); // same place
    const a = cardOf(/Reply to/);
    expect(within(a).getByRole("alert")).toHaveTextContent("This needs your authenticator app. Nothing was changed.");
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
        <NeedsYou words={WORDS} role="owner" actions={null} now={NOW} />
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
  it("nothing waiting is the owl's happy line, a flat owl and no people", () => {
    const { container } = board([]);
    expect(screen.getByText("All clear. I will tell you the moment something needs you.")).toBeInTheDocument();
    expect(container.querySelector('[data-empty="needs"] svg[data-owl="main"]')).not.toBeNull();
    expect(screen.queryByRole("article")).toBeNull();
    expect(count()).toHaveTextContent("0");
  });
  it("an unreadable Today says 'Not available yet' and draws no count", () => {
    const { container } = board(null);
    expect(screen.getByText("Not available yet")).toBeInTheDocument();
    expect(container.querySelector("[data-count]")).toBeNull();
  });
  it("on a phone only the two newest show, and 'See all' shows the rest (and 'Show fewer' hides them again)", () => {
    const many = [classic(), outbox(), call(), classic({ id: "x2" }), classic({ id: "x3" })].map((c, i) => ({ ...c, key: `k${i}` }) as NeedsCard);
    board(many);
    const items = () => within(screen.getByRole("heading", { name: "Needs you" }).closest("section")!).getAllByRole("listitem");
    expect(items().map((li) => li.className.includes("max-md:hidden"))).toEqual([false, false, true, true, true]);
    fireEvent.click(screen.getByRole("button", { name: "See all (5)" }));
    expect(items().some((li) => li.className.includes("max-md:hidden"))).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Show fewer" }));
    expect(items().filter((li) => li.className.includes("max-md:hidden"))).toHaveLength(3);
  });
  it("two cards or fewer have no 'See all'", () => {
    board([classic(), outbox()]);
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
