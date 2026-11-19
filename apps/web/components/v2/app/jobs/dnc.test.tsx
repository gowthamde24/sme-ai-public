import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { appDict } from "@/i18n/app";
import { MOCK_DNC, MOCK_DNC_COUNT, MOCK_DNC_LIFTED } from "@/lib/jobs/dnc-mock";

import { DoNotCallList } from "./DoNotCallList";

afterEach(cleanup);
const words = Object.fromEntries(Object.entries(appDict("en") as Record<string, string>).filter(([k]) => /^(jobs\.dnc|apierr)\./.test(k)));
const BASE = "/app/tenants/t";
const page = { items: [...MOCK_DNC], count: MOCK_DNC_COUNT, nextCursor: null };
const acts = (over = {}) => ({
  add: vi.fn(async (phone: string) => ({ ok: true as const, data: { id: "77777777-7777-4777-8777-777777777799", phoneMasked: phone.includes("90000") ? "+91 90000 ••• 64" : "+91 98480 ••• 99", reason: "added_by_owner" as const, at: "2026-11-19T04:00:00Z", state: "active" as const, addedBy: null, history: [] } })),
  remove: vi.fn(async (id: string) => ({ ok: true as const, data: { id } })),
  ...over,
});
const show = (a = acts(), over: Partial<Parameters<typeof DoNotCallList>[0]> = {}) => render(<DoNotCallList page={page} q="" words={words} base={BASE} actions={a} moreHref={null} {...over} />);

describe("the Do-Not-Call list", () => {
  it("says how many numbers there are and that the assistant never calls or messages them", () => {
    show();
    expect(screen.getByText("128 numbers. The assistant never calls or messages these.")).toBeInTheDocument();
  });
  it("shows each number masked, the reason in words and the date", () => {
    show();
    const rows = document.querySelectorAll("[data-dnc]");
    expect(rows).toHaveLength(5);
    const first = rows[0] as HTMLElement;
    expect(within(first).getByText("+91 98480 ••• 21")).toBeInTheDocument();
    expect(within(first).getByText("Said STOP on WhatsApp")).toBeInTheDocument();
    expect(within(first).getByText("12 Nov")).toBeInTheDocument();
    expect(within(rows[1] as HTMLElement).getByText("Asked on a call not to be called")).toBeInTheDocument();
    // an owner-added number says WHO added it
    expect(within(rows[2] as HTMLElement).getByText("Added by Ramesh")).toBeInTheDocument();
  });
  it("the search box is a plain GET form to this page (it works before any script)", () => {
    show(acts(), { q: "984" });
    const box = screen.getByRole("searchbox", { name: "Search a number" });
    expect(box).toHaveValue("984");
    const form = box.closest("form") as HTMLFormElement;
    expect(form.getAttribute("method")).toBe("get");
    expect(form.getAttribute("action")).toBe(`${BASE}/do-not-call`);
    expect(box).toHaveAttribute("name", "q");
  });
  it("Add: an Indian mobile number is checked in the form, sent once, and shows at the top masked with the count one higher", async () => {
    const a = acts();
    show(a);
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    fireEvent.change(screen.getByLabelText("Mobile number"), { target: { value: "12345" } });
    fireEvent.click(screen.getByRole("button", { name: "Add to the list" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Please type a 10-digit Indian mobile number.");
    expect(a.add).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Mobile number"), { target: { value: "98480 12399" } });
    fireEvent.click(screen.getByRole("button", { name: "Add to the list" }));
    await waitFor(() => expect(a.add).toHaveBeenCalledWith("98480 12399"));
    expect(a.add).toHaveBeenCalledTimes(1);
    expect(await screen.findByText("Added. The assistant will not call or message this number.")).toBeInTheDocument();
    expect((document.querySelector("[data-dnc]") as HTMLElement).textContent).toContain("+91 98480 ••• 99");
    expect(screen.getByText("129 numbers. The assistant never calls or messages these.")).toBeInTheDocument();
    expect(screen.queryByLabelText("Mobile number")).toBeNull();
  });
  it("Add: a refusal of the server is said in its words and the form stays", async () => {
    show(acts({ add: vi.fn(async () => ({ ok: false as const, kind: "forbidden" as const, error: "You may not do this." })) }));
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    fireEvent.change(screen.getByLabelText("Mobile number"), { target: { value: "98480 12399" } });
    fireEvent.click(screen.getByRole("button", { name: "Add to the list" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("You may not do this.");
    expect(screen.getByLabelText("Mobile number")).toBeInTheDocument();
  });
  it("Remove (Owner): asks once with the line about when a number may leave, only then removes", async () => {
    const a = acts();
    show(a);
    const row = document.querySelector(`[data-dnc="${MOCK_DNC[2].id}"]`) as HTMLElement; // added by the owner: the only kind with a Remove
    fireEvent.click(within(row).getByRole("button", { name: "Remove +91 90000 ••• 64 from the list" }));
    const ask = within(row).getByRole("alertdialog");
    expect(within(ask).getByText(/A number you added yourself leaves the list when you remove it/)).toBeInTheDocument();
    expect(a.remove).not.toHaveBeenCalled();
    fireEvent.click(within(ask).getByRole("button", { name: "Keep it" }));
    expect(within(row).queryByRole("alertdialog")).toBeNull();
    fireEvent.click(within(row).getByRole("button", { name: "Remove +91 90000 ••• 64 from the list" }));
    fireEvent.click(within(row).getByRole("button", { name: "Yes, remove it" }));
    await waitFor(() => expect(a.remove).toHaveBeenCalledWith(MOCK_DNC[2].id));
    expect(await screen.findByText("Removed from the list.")).toBeInTheDocument();
    expect(document.querySelectorAll("[data-dnc]")).toHaveLength(4);
    expect(screen.getByText("127 numbers. The assistant never calls or messages these.")).toBeInTheDocument();
  });
  it("a number that said STOP itself has NO Remove, for anyone: it says it was stopped by the customer; the numbers use the theme font, not a monospace one", () => {
    show(acts());
    for (const i of [0, 1, 3]) {
      const row = document.querySelector(`[data-dnc="${MOCK_DNC[i].id}"]`) as HTMLElement;
      expect(within(row).queryByRole("button", { name: /^Remove/ })).toBeNull();
      expect(within(row).getByText("Stopped by the customer")).toBeInTheDocument();
    }
    expect(screen.getAllByRole("button", { name: /^Remove/ })).toHaveLength(1);
    for (const n of document.querySelectorAll('[data-part="dnc-number"]')) {
      expect(n.className).toContain("tabular-nums");
      expect(n.className).not.toContain("font-mono");
    }
  });
  it("a legal or complaint rule (`other`) stays too: no Remove, and it says it is kept by a rule", () => {
    show(acts());
    const row = document.querySelector(`[data-dnc="${MOCK_DNC[4].id}"]`) as HTMLElement;
    expect(MOCK_DNC[4].reason).toBe("other");
    expect(within(row).getByText("Legal or complaint rule")).toBeInTheDocument();
    expect(within(row).getByText("Kept by a legal or complaint rule")).toBeInTheDocument();
    expect(within(row).queryByRole("button", { name: /^Remove/ })).toBeNull();
    expect(within(row).queryByText("Stopped by the customer")).toBeNull();
  });
  it("a number that came off the list is NOT in the list: it leaves, and every entry still on it is active with no history", () => {
    show(acts());
    expect(MOCK_DNC.every((e) => e.state === "active" && e.history.length === 0)).toBe(true);
    for (const e of MOCK_DNC_LIFTED) expect(document.querySelector(`[data-dnc="${e.id}"]`)).toBeNull();
    expect(document.querySelector('[data-part="dnc-history"]')).toBeNull();
  });
  it("\"Show numbers that came off the list\" is a plain link (it works before any script); asked for, each lifted number shows how it came off, one line each, with no Remove", () => {
    show(acts(), { liftedHref: `${BASE}/do-not-call?lifted=1` });
    expect(screen.getByRole("link", { name: "Show numbers that came off the list" })).toHaveAttribute("href", `${BASE}/do-not-call?lifted=1`);
    expect(document.querySelector('[data-part="dnc-lifted-list"]')).toBeNull();
    cleanup();
    show(acts(), { lifted: MOCK_DNC_LIFTED, liftedHref: `${BASE}/do-not-call` });
    expect(screen.getByRole("link", { name: "Hide numbers that came off the list" })).toHaveAttribute("href", `${BASE}/do-not-call`);
    const lines = [...document.querySelectorAll('[data-part="dnc-lifted-list"] [data-part="dnc-history"] li')].map((li) => li.textContent);
    expect(lines).toEqual(["5 Nov: They sent a message asking to hear from us", "6 Nov: You recorded their yes", "8 Nov: They ticked the box on your form"]);
    expect(screen.getAllByText("Came off the list")).toHaveLength(3);
    const row = document.querySelector(`[data-dnc-lifted="${MOCK_DNC_LIFTED[0].id}"]`) as HTMLElement;
    expect(within(row).getByText("+91 88850 ••• 33")).toBeInTheDocument();
    expect(within(row).queryByRole("button")).toBeNull();
    // the count of the list is still the list's own
    expect(screen.getByText("128 numbers. The assistant never calls or messages these.")).toBeInTheDocument();
    cleanup();
    show(acts(), { lifted: [], liftedHref: `${BASE}/do-not-call` });
    expect(screen.getByText("No number has come off the list.")).toBeInTheDocument();
  });
  it("no link to lifted numbers is drawn when the page does not ask for them", () => {
    show(acts());
    expect(screen.queryByRole("link", { name: /came off the list/ })).toBeNull();
  });
  it("an Admin or a Sales member has no Remove; a Sales member has no Add either", () => {
    show(acts({ remove: null }));
    expect(screen.queryByRole("button", { name: /^Remove/ })).toBeNull();
    expect(screen.getByRole("button", { name: "Add" })).toBeInTheDocument();
    cleanup();
    show(acts({ add: null, remove: null }));
    expect(screen.queryByRole("button", { name: "Add" })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Remove/ })).toBeNull();
  });
  it("the rule about leaving the list is always on the page", () => {
    show(acts({ add: null, remove: null }));
    expect(document.querySelector('[data-part="dnc-rule"]')?.textContent).toBe("A number you added yourself leaves the list when you remove it. A number that said STOP stays until that person asks for contact again themselves.");
  });
  it("an empty search says so, and a long list has a link to more", () => {
    show(acts(), { q: "zzz", page: { items: [], count: 0, nextCursor: null } });
    expect(screen.getByText("No number matches. Try the last digits.")).toBeInTheDocument();
    cleanup();
    show(acts(), { moreHref: `${BASE}/do-not-call?cursor=c1` });
    expect(screen.getByRole("link", { name: "More numbers" })).toHaveAttribute("href", `${BASE}/do-not-call?cursor=c1`);
  });
});
