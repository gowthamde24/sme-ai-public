import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { appDict } from "@/i18n/app";
import { MOCK_DNC, MOCK_DNC_COUNT } from "@/lib/jobs/dnc-mock";

import { DoNotCallList } from "./DoNotCallList";

afterEach(cleanup);
const words = Object.fromEntries(Object.entries(appDict("en") as Record<string, string>).filter(([k]) => /^(jobs\.dnc|apierr)\./.test(k)));
const BASE = "/app/tenants/t";
const page = { items: [...MOCK_DNC], count: MOCK_DNC_COUNT, nextCursor: null };
const acts = (over = {}) => ({
  add: vi.fn(async (phone: string) => ({ ok: true as const, data: { id: "77777777-7777-4777-8777-777777777799", phoneMasked: phone.includes("90000") ? "+91 90000 ••• 64" : "+91 98480 ••• 99", reason: "added_by_owner" as const, at: "2026-11-19T04:00:00Z" } })),
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
    expect(rows).toHaveLength(4);
    const first = rows[0] as HTMLElement;
    expect(within(first).getByText("+91 98480 ••• 21")).toBeInTheDocument();
    expect(within(first).getByText("Said STOP on WhatsApp")).toBeInTheDocument();
    expect(within(first).getByText("12 Nov")).toBeInTheDocument();
    expect(within(rows[1] as HTMLElement).getByText("Asked on a call not to be called")).toBeInTheDocument();
    expect(within(rows[2] as HTMLElement).getByText("Added by you")).toBeInTheDocument();
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
    const row = document.querySelector("[data-dnc]") as HTMLElement;
    fireEvent.click(within(row).getByRole("button", { name: "Remove +91 98480 ••• 21 from the list" }));
    const ask = within(row).getByRole("alertdialog");
    expect(within(ask).getByText("A number leaves the list only when you remove it and the person has asked you to.")).toBeInTheDocument();
    expect(a.remove).not.toHaveBeenCalled();
    fireEvent.click(within(ask).getByRole("button", { name: "Keep it" }));
    expect(within(row).queryByRole("alertdialog")).toBeNull();
    fireEvent.click(within(row).getByRole("button", { name: "Remove +91 98480 ••• 21 from the list" }));
    fireEvent.click(within(row).getByRole("button", { name: "Yes, remove it" }));
    await waitFor(() => expect(a.remove).toHaveBeenCalledWith(MOCK_DNC[0].id));
    expect(await screen.findByText("Removed from the list.")).toBeInTheDocument();
    expect(document.querySelectorAll("[data-dnc]")).toHaveLength(3);
    expect(screen.getByText("127 numbers. The assistant never calls or messages these.")).toBeInTheDocument();
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
    expect(document.querySelector('[data-part="dnc-rule"]')?.textContent).toBe("A number leaves the list only when you remove it and the person has asked you to.");
  });
  it("an empty search says so, and a long list has a link to more", () => {
    show(acts(), { q: "zzz", page: { items: [], count: 0, nextCursor: null } });
    expect(screen.getByText("No number matches. Try the last digits.")).toBeInTheDocument();
    cleanup();
    show(acts(), { moreHref: `${BASE}/do-not-call?cursor=c1` });
    expect(screen.getByRole("link", { name: "More numbers" })).toHaveAttribute("href", `${BASE}/do-not-call?cursor=c1`);
  });
});
