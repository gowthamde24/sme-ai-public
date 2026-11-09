import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { wordsFor } from "@/i18n/app-words";
import { parseMoneySummary } from "@/lib/api/money";

import { MoneyView } from "./MoneyView";
import { RemindButton } from "./RemindButton";

/** app v4 part 6: Sales > Money. */
const W = wordsFor("en", ["mo."]);
const BASE = "/app/tenants/t";
const A = "ca000000-0000-4000-8000-0000000000a1";
const B = "ca000000-0000-4000-8000-0000000000a2";
const CO1 = "11111111-1111-4111-8111-111111111111";
const CO2 = "11111111-1111-4111-8111-111111111112";
const CT = "ca000000-0000-4000-8000-0000000000f1";
const summary = (over: Record<string, unknown> = {}) =>
  parseMoneySummary({ as_of: "2026-10-14", owed_paise: 17_500_000, overdue_paise: 5_000_000, customers_owing: 2, customers_overdue: 1, paid_this_month_paise: 7_000_000, month_from: "2026-10-01", complete: true, top: [{ account_id: A, company_id: CO1, contact_id: CT, name: "Sri Rama Builders", outstanding_paise: 13_000_000, overdue_paise: 5_000_000 }, { account_id: B, company_id: CO2, contact_id: null, name: "Lakshmi Hardware", outstanding_paise: 4_500_000, overdue_paise: 0 }], ...over });
afterEach(cleanup);
const view = (s: ReturnType<typeof summary> | null, remind: Parameters<typeof MoneyView>[0]["remind"] = () => <span data-remind />, duesHref: string | null = `${BASE}/dues`) => render(<MoneyView summary={s} w={W} base={BASE} remind={remind} duesHref={duesHref} when={(d) => d} />);

describe("Money (app v4)", () => {
  it("owed, overdue and paid this month, then who owes the most, each with a link to the account; Remind only where something is overdue", () => {
    view(summary());
    expect(document.querySelector('[data-stat="owed"]')).toHaveTextContent("₹1,75,000");
    expect(document.querySelector('[data-stat="owed"]')).toHaveTextContent("2 customers");
    expect(document.querySelector('[data-stat="overdue"]')).toHaveTextContent("₹50,000");
    expect(document.querySelector('[data-stat="overdue"]')).toHaveTextContent("1 customer");
    expect(document.querySelector('[data-stat="paid"]')).toHaveTextContent("₹70,000");
    const rama = within(document.querySelector(`[data-row="${A}"]`) as HTMLElement);
    expect(rama.getByRole("link", { name: "Sri Rama Builders" })).toHaveAttribute("href", `${BASE}/dues/${CO1}`);
    expect(rama.getByText("₹50,000 overdue")).toBeInTheDocument();
    expect(rama.getByText("₹1,30,000")).toBeInTheDocument();
    expect(document.querySelector(`[data-row="${A}"] [data-remind]`)).not.toBeNull();
    expect(document.querySelector(`[data-row="${B}"] [data-remind]`)).toBeNull(); // nothing overdue: no Remind
    expect(screen.getByRole("link", { name: "See every account" })).toHaveAttribute("href", `${BASE}/dues`);
    expect(screen.getByText(/Nothing is sent until you approve it/)).toBeInTheDocument();
  });
  it("says so when a summary could not be read, when nobody owes, when nothing is overdue and when the list is only the top of more", () => {
    view(null);
    expect(screen.getByRole("alert")).toHaveTextContent("The money summary could not be read just now.");
    cleanup();
    view(summary({ top: [], owed_paise: 0, overdue_paise: 0, customers_owing: 0, customers_overdue: 0 }), null, null);
    expect(screen.getByText("Nobody owes anything right now.")).toBeInTheDocument();
    expect(screen.getByText("Nothing is overdue")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "See every account" })).toBeNull();
    cleanup();
    view(summary({ complete: false }), null);
    expect(screen.getByText("Showing the customers who owe the most. There are more.")).toBeInTheDocument();
    expect(document.querySelector("[data-remind]")).toBeNull();
  });
});

describe("Remind", () => {
  const row = { companyId: CO1, contactId: CT, name: "Sri Rama Builders" };
  it("makes the draft with the one id this row made, says nothing is sent, and links to the draft", async () => {
    const remind = vi.fn(async (id: string) => ({ ok: true as const, campaignId: id, added: 1 }));
    render(<RemindButton w={W} campaignsHref={`${BASE}/campaigns`} row={row} remind={remind} />);
    fireEvent.click(screen.getByRole("button", { name: "Remind" }));
    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent("Draft made. Nothing is sent until you approve it.");
    const id = remind.mock.calls[0][0];
    expect(status.querySelector("a")).toHaveAttribute("href", `${BASE}/campaigns/${id}`);
    expect(remind).toHaveBeenCalledWith(id, row);
  });
  it("a second try after a refusal uses the same draft id (a retry changes the same draft); the refusal is said in words", async () => {
    const remind = vi.fn().mockResolvedValueOnce({ ok: false, error: "down" }).mockImplementationOnce(async (id: string) => ({ ok: true, campaignId: id, added: 1 }));
    render(<RemindButton w={W} campaignsHref={null} row={row} remind={remind} />);
    fireEvent.click(screen.getByRole("button", { name: "Remind" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Nothing was made."));
    fireEvent.click(await screen.findByRole("button", { name: "Remind" }));
    await waitFor(() => expect(screen.getByRole("status")).toBeInTheDocument());
    expect(remind.mock.calls[1][0]).toBe(remind.mock.calls[0][0]);
    expect(screen.queryByRole("link")).toBeNull(); // no campaigns page for this person: no link
  });
  it("a customer with no contact has no button, only the sentence", () => {
    render(<RemindButton w={W} campaignsHref={null} row={{ ...row, contactId: null }} remind={vi.fn()} />);
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText("No contact to remind")).toBeInTheDocument();
  });
});
