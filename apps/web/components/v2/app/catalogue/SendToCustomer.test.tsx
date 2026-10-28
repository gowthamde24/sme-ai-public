import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));

import { photoJson } from "@/lib/api/catalogue-fixtures";
import { parseItem } from "@/lib/api/catalogue";
import { itemJson } from "@/lib/api/catalogue-fixtures";

import { SendToCustomer } from "./SendToCustomer";
import { BASE, IDS, WORDS, fakeSendActions, item } from "./catalogue-test-kit";

const MSG = "77777777-7777-4777-8777-777777777777";
const sixPhotos = parseItem(itemJson({}, Array.from({ length: 6 }, (_, i) => photoJson(`0f8a927d-6666-4a66-8a66-00000000000${i + 1}`, i + 1)))).photos;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  vi.spyOn(crypto, "randomUUID").mockReturnValue(MSG);
  localStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

type Over = Partial<React.ComponentProps<typeof SendToCustomer>>;
function show(over: Over = {}) {
  const actions = over.actions ?? fakeSendActions();
  const photos = over.photos ?? item().photos;
  render(<SendToCustomer itemId={IDS.ITEM_A} name="DEMO Maroon Kanchi pattu" photos={photos} words={WORDS} lead={null} outboxHref={`${BASE}/outbox`} todayHref={BASE} {...over} actions={actions} />);
  return actions as ReturnType<typeof fakeSendActions>;
}
const type = (label: string | RegExp, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const settle = (ms = 400) => act(async () => void vi.advanceTimersByTime(ms));
const findLead = async (q = "Sri") => {
  type("Find a customer", q);
  await settle();
};
const chooseLead = async () => {
  await findLead();
  fireEvent.click(screen.getByRole("button", { name: /Sri Lakshmi Silks/ }));
};
const send = () => act(async () => void fireEvent.click(screen.getByRole("button", { name: "Send to the outbox" })));

describe("finding the customer", () => {
  it("searches after a short pause once there are two letters, and shows the name, the city and the end of the phone: never the number", async () => {
    const actions = show();
    type("Find a customer", "S");
    await settle();
    expect(actions.search).not.toHaveBeenCalled();
    expect(screen.getByText("Type at least 2 letters.")).toBeInTheDocument();
    await findLead("Sri");
    expect(actions.search).toHaveBeenCalledTimes(1);
    expect(actions.search).toHaveBeenCalledWith("Sri");
    const hit = screen.getByRole("button", { name: /Sri Lakshmi Silks/ });
    expect(hit).toHaveTextContent("Sri Lakshmi Silks · Priya S.");
    expect(hit).toHaveTextContent("Hyderabad · phone ends 0001");
    expect(hit.className).toContain("min-h-11");
  });

  it("waits for the person to stop typing (one search, not one per letter), and the Find button searches now", async () => {
    const actions = show();
    for (const q of ["Sr", "Sri", "Sri "]) {
      type("Find a customer", q);
      await settle(100);
    }
    expect(actions.search).not.toHaveBeenCalled();
    await settle(300);
    expect(actions.search).toHaveBeenCalledTimes(1);
    type("Find a customer", "Lakshmi");
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: "Find" })));
    expect(actions.search).toHaveBeenLastCalledWith("Lakshmi");
  });

  it("says when nobody is found, and when the search fails", async () => {
    const search = vi.fn().mockResolvedValueOnce({ ok: true, items: [] }).mockResolvedValueOnce({ ok: false, error: "That did not work. Nothing was changed. Try again." });
    show({ actions: fakeSendActions({ search }) });
    await findLead("Zzz");
    expect(screen.getByText("No customer found. Try another name.")).toBeInTheDocument();
    await findLead("Yyy");
    expect(screen.getByText("That did not work. Nothing was changed. Try again.")).toBeInTheDocument();
  });

  it("ignores an old answer that arrives after a newer search", async () => {
    let first!: (v: unknown) => void;
    const search = vi
      .fn()
      .mockImplementationOnce(() => new Promise((r) => (first = r)))
      .mockResolvedValueOnce({ ok: true, items: [{ leadId: IDS.LEAD_FOUND, customer: "Newer Silks", city: null, contactName: null, phoneLast4: null }] });
    show({ actions: fakeSendActions({ search }) });
    await findLead("Old");
    await findLead("Newer");
    await act(async () => first({ ok: true, items: [{ leadId: IDS.LEAD_FOUND, customer: "Older Silks", city: null, contactName: null, phoneLast4: null }] }));
    expect(screen.getByText("Newer Silks")).toBeInTheDocument();
    expect(screen.queryByText("Older Silks")).toBeNull();
  });

  it("a pick is shown by name and can be changed; a customer the person came from is already chosen", async () => {
    show();
    await chooseLead();
    expect(screen.getByText("Sending to Sri Lakshmi Silks · Priya S.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Change customer" }));
    expect(screen.getByLabelText("Find a customer")).toBeInTheDocument();
    cleanup();
    show({ lead: { leadId: IDS.LEAD_FOUND, label: "Priya S." } });
    expect(screen.getByText("Sending to Priya S.")).toBeInTheDocument();
    expect(screen.queryByLabelText("Find a customer")).toBeNull();
  });
});

describe("choosing the photos and writing the caption", () => {
  it("starts with the first four photos chosen; a fifth cannot be added until one is unticked, and none chosen cannot be sent", async () => {
    show({ photos: sixPhotos });
    const boxes = () => screen.getAllByRole("checkbox").filter((b) => /photo \d/.test(b.getAttribute("aria-label") ?? ""));
    expect(boxes().map((b) => (b as HTMLInputElement).checked)).toEqual([true, true, true, true, false, false]);
    expect(boxes()[4]).toBeDisabled();
    expect(screen.getByText("4 photos are chosen. Untick one to choose another.")).toBeInTheDocument();
    fireEvent.click(boxes()[1]);
    expect(boxes()[4]).toBeEnabled();
    fireEvent.click(boxes()[4]);
    expect(boxes().filter((b) => (b as HTMLInputElement).checked)).toHaveLength(4);
    for (const b of boxes().filter((x) => (x as HTMLInputElement).checked)) fireEvent.click(b);
    expect(screen.getByText("Choose at least one photo.")).toBeInTheDocument();
    await chooseLead();
    expect(screen.getByRole("button", { name: "Send to the outbox" })).toBeDisabled();
  });

  it("the caption starts as a plain English line with the saree's name and no price; another language starts empty (the person writes it) and English brings the line back", () => {
    show();
    const caption = screen.getByLabelText("Caption") as HTMLTextAreaElement;
    expect(caption.value).toBe("Here is DEMO Maroon Kanchi pattu from our shop. Tell us if you would like to see more.");
    expect(caption.value).not.toMatch(/₹|\d/);
    fireEvent.change(screen.getByLabelText("Language of the message"), { target: { value: "te" } });
    expect(caption.value).toBe("");
    fireEvent.change(screen.getByLabelText("Language of the message"), { target: { value: "en" } });
    expect(caption.value).toMatch(/^Here is DEMO/);
    fireEvent.change(caption, { target: { value: "My own words about the saree." } });
    fireEvent.change(screen.getByLabelText("Language of the message"), { target: { value: "hi" } });
    expect(caption.value).toBe("My own words about the saree."); // the person's own words are never wiped
    expect(screen.getByText(/waits for the owner to approve/)).toBeInTheDocument();
  });

  it("previews the message the way WhatsApp will show it: the chosen photos, the caption, and that nothing is sent yet", () => {
    show({ photos: sixPhotos });
    const preview = document.querySelector("[data-part=preview]") as HTMLElement;
    expect(within(preview).getAllByRole("img")).toHaveLength(4);
    expect(within(preview).getByText(/Here is DEMO Maroon Kanchi pattu/)).toBeInTheDocument();
    expect(within(preview).getByText("This is how the message will look on WhatsApp. Nothing has been sent yet.")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Caption"), { target: { value: "" } });
    expect(within(preview).getByText("Your caption shows here.")).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("checkbox", { name: /photo 2/ })[0]);
    expect(within(preview).getAllByRole("img")).toHaveLength(3);
  });
});

describe("sending to the outbox", () => {
  it("sends the chosen photos in the saree's order, the trimmed caption, the language and the record choice, with one id; the outbox decides", async () => {
    const actions = show({ photos: sixPhotos });
    await chooseLead();
    fireEvent.change(screen.getByLabelText("Caption"), { target: { value: "  A lovely saree for you  " } });
    fireEvent.change(screen.getByLabelText("Language of the message"), { target: { value: "ta" } });
    fireEvent.click(screen.getAllByRole("checkbox", { name: /photo 2/ })[0]);
    await send();
    expect(actions.send).toHaveBeenCalledWith({ messageId: MSG, itemId: IDS.ITEM_A, leadId: IDS.LEAD_FOUND, photoIds: [sixPhotos[0].id, sixPhotos[2].id, sixPhotos[3].id], text: "A lovely saree for you", language: "ta", keepRecord: true });
  });

  it("'keep a record' is ticked by default, and unticking it is sent as false", async () => {
    const actions = show();
    await chooseLead();
    expect(screen.getByLabelText("Keep a record of this")).toBeChecked();
    fireEvent.click(screen.getByLabelText("Keep a record of this"));
    await send();
    expect(actions.send.mock.calls[0][0].keepRecord).toBe(false);
  });

  it("is not possible until a customer is chosen and the caption has words", async () => {
    show();
    const go = screen.getByRole("button", { name: "Send to the outbox" });
    expect(go).toBeDisabled();
    await chooseLead();
    expect(go).toBeEnabled();
    fireEvent.change(screen.getByLabelText("Caption"), { target: { value: "x" } });
    expect(go).toBeDisabled();
  });

  it.each([
    ["sent", { state: "sent", text: "Sent to the customer.", why: null }, /Sent to the customer\./, null],
    ["needs_approval", { state: "needs_approval", text: "Waiting for the owner or an admin to approve it.", why: "Why it waits: the caption mentions a price." }, /Waiting for the owner or an admin to approve it\./, /Why it waits: the caption mentions a price\./],
    ["queued", { state: "queued", text: "Queued. It goes out at 9:00 am.", why: null }, /Queued\. It goes out at 9:00 am\./, null],
    ["blocked", { state: "blocked", text: "Not sent: this customer asked us to stop.", why: null }, /Not sent: this customer asked us to stop\./, null],
  ])("says in plain words how it went: %s", async (_name, answer, text, why) => {
    const send_ = vi.fn(async () => ({ ok: true as const, recordText: "Keep a record is on: when the message has really gone out, a line is added to this lead’s history.", ...answer }));
    show({ actions: fakeSendActions({ send: send_ }) });
    await chooseLead();
    await send();
    const status = screen.getByRole("status");
    expect(status).toHaveAttribute("data-state", answer.state);
    expect(status).toHaveTextContent(text);
    if (why) expect(status).toHaveTextContent(why);
    expect(status).toHaveTextContent("Keep a record is on");
    expect(screen.getByRole("link", { name: "Open the outbox" })).toHaveAttribute("href", `${BASE}/outbox`);
    // the form is replaced by the answer, so it cannot be sent twice by accident
    expect(screen.queryByRole("button", { name: "Send to the outbox" })).toBeNull();
    // a message waiting for a person also points at Today, where it is decided
    if (answer.state === "needs_approval") expect(screen.getByRole("link", { name: "Open Today" })).toHaveAttribute("href", BASE);
    else expect(screen.queryByRole("link", { name: "Open Today" })).toBeNull();
  });

  it("'Send to another customer' starts again with a fresh form", async () => {
    show();
    await chooseLead();
    await send();
    fireEvent.click(screen.getByRole("button", { name: "Send to another customer" }));
    expect(screen.getByLabelText("Find a customer")).toHaveValue("");
    expect(screen.getByLabelText("Caption")).toHaveValue("Here is DEMO Maroon Kanchi pattu from our shop. Tell us if you would like to see more.");
  });

  it("a refusal is shown in our words and the form stays for another try with the SAME message id (a retry is never a second message)", async () => {
    const send_ = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, error: "This needs your two-step code, if you turned it on. Nothing was changed.", mfa: true })
      .mockResolvedValueOnce({ ok: true, state: "sent", text: "Sent to the customer.", why: null, recordText: "x" });
    show({ actions: fakeSendActions({ send: send_ }) });
    await chooseLead();
    await send();
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("This needs your two-step code, if you turned it on.");
    expect(within(alert).getByRole("link", { name: "Open Security" })).toHaveAttribute("href", "/app/security");
    await send();
    expect(send_.mock.calls[0][0].messageId).toBe(send_.mock.calls[1][0].messageId);
    expect(screen.getByRole("status")).toHaveTextContent("Sent to the customer.");
  });

  it("a send that throws is the general sentence; the button works only once at a time", async () => {
    let release!: (v: unknown) => void;
    const send_ = vi.fn(() => new Promise((r) => (release = r)));
    show({ actions: fakeSendActions({ send: send_ }) });
    await chooseLead();
    fireEvent.click(screen.getByRole("button", { name: "Send to the outbox" }));
    expect(screen.getByRole("button", { name: "Working…" })).toBeDisabled();
    fireEvent.submit(document.querySelector("form")!);
    expect(send_).toHaveBeenCalledTimes(1);
    await act(async () => release({ ok: false, error: "That did not work. Nothing was changed. Try again." }));
    expect(screen.getByRole("alert")).toHaveTextContent("That did not work.");
  });
});
