import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { wordsFor } from "@/i18n/app-words";

import { RetailersSearch, type ConfirmResult, type SearchStatus } from "./RetailersSearch";

const T = "11111111-1111-4111-8111-111111111111";
const P1 = "3b1c0000-0000-4000-8000-000000000001";
const P2 = "3b1c0000-0000-4000-8000-000000000002";
const WORDS = wordsFor("en", ["rtl.", "apierr.", "problem."], ["dta.btn.working"]);
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const RESULT = { cards: [{ id: P1, label: "Balaji Sarees", url: "https://maps.google.com/?cid=2" }, { id: P2, label: "No Link Silks", url: null }], text: "I found two shops (see the cards).", error: null };
const ON: SearchStatus = { enabled: true, used: 2, limit: 10 };
const confirmOk = (created = true): ((...a: string[]) => Promise<ConfirmResult>) => vi.fn(async () => ({ ok: true as const, data: { lead_id: "55555555-5555-4555-8555-555555555555", created } }));
const press = (name: string | RegExp) => act(async () => fireEvent.click(screen.getByRole("button", { name })));
const ask = async (kind = "saree wholesalers", city = "Guntur") => {
  fireEvent.change(screen.getByLabelText("What kind of shops?"), { target: { value: kind } });
  fireEvent.change(screen.getByLabelText("City or town"), { target: { value: city } });
  await press("Search");
};
const routes = (reply: () => Response) => {
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  globalThis.fetch = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(url), body: JSON.parse(String(init?.body ?? "{}")) });
    return reply();
  }) as unknown as typeof fetch;
  return calls;
};
beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

describe("find retailers", () => {
  it("says whether map search is on and how much of today's allowance is used", () => {
    render(<RetailersSearch tenantId={T} words={WORDS} status={ON} confirm={confirmOk()} />);
    expect(screen.getByText("Map search is on. Used today: 2 of 10.")).toBeInTheDocument();
    cleanup();
    render(<RetailersSearch tenantId={T} words={WORDS} status="unknown" confirm={confirmOk()} />);
    expect(screen.getByText(/We cannot tell from here whether map search is on/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Search" })).toBeEnabled();
  });
  it("when the system has map search off, the search stays off and says why", () => {
    render(<RetailersSearch tenantId={T} words={WORDS} status={{ enabled: false, used: null, limit: null }} confirm={confirmOk()} />);
    expect(screen.getAllByText(/Map search is not switched on in this system/).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Search" })).toBeDisabled();
  });
  it("asks our own route with the kind, the city and a new id, and shows a card per shop with where it is from", async () => {
    const calls = routes(() => json({ ok: true, data: RESULT }));
    render(<RetailersSearch tenantId={T} words={WORDS} status={ON} confirm={confirmOk()} />);
    await ask();
    expect(calls[0].url).toBe(`/app/tenants/${T}/retailers/search`);
    expect(calls[0].body).toMatchObject({ kind: "saree wholesalers", city: "Guntur" });
    expect(calls[0].body.messageId).toMatch(/^[0-9a-f-]{36}$/);
    const cards = screen.getAllByRole("article");
    expect(cards).toHaveLength(2);
    expect(within(cards[0]).getByRole("heading", { name: "Balaji Sarees" })).toBeInTheDocument();
    expect(within(cards[0]).getByText("From Google Maps")).toBeInTheDocument();
    const view = within(cards[0]).getByRole("link", { name: "View on Google Maps" });
    expect(view).toHaveAttribute("href", "https://maps.google.com/?cid=2");
    expect(view).toHaveAttribute("rel", "noopener noreferrer");
    expect(view).toHaveAttribute("target", "_blank");
    expect(within(cards[1]).queryByRole("link", { name: "View on Google Maps" })).toBeNull(); // no Maps link was given
    expect(screen.getByText(/shown here now and are not kept/)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/scrap|crawl|harvest/i);
  });
  it("saves a shop as a lead from what the person TYPES (nothing is prefilled from the card), then links to the lead", async () => {
    routes(() => json({ ok: true, data: RESULT }));
    const confirm = confirmOk();
    render(<RetailersSearch tenantId={T} words={WORDS} status={ON} confirm={confirm} />);
    await ask();
    const card = screen.getAllByRole("article")[0];
    await act(async () => fireEvent.click(within(card).getByRole("button", { name: "Add as a lead" })));
    const name = within(card).getByLabelText("Shop name");
    expect(name).toHaveValue(""); // Google's name is not copied in
    expect(within(card).getByLabelText("City or town")).toHaveValue("Guntur"); // the city the person searched
    await act(async () => fireEvent.click(within(card).getByRole("button", { name: "Save as a lead" })));
    expect(confirm).not.toHaveBeenCalled();
    expect(within(card).getByRole("alert")).toHaveTextContent("Type the shop's name.");
    fireEvent.change(name, { target: { value: "Balaji Sarees" } });
    await act(async () => fireEvent.click(within(card).getByRole("button", { name: "Save as a lead" })));
    expect(confirm).toHaveBeenCalledWith(P1, "Balaji Sarees", "Guntur", "");
    expect(within(card).getByRole("status")).toHaveTextContent("Saved as a lead.");
    expect(within(card).getByRole("link", { name: "Open the lead" })).toHaveAttribute("href", `/app/tenants/${T}/leads/55555555-5555-4555-8555-555555555555`);
  });
  it("the same shop saved twice says it was already saved", async () => {
    routes(() => json({ ok: true, data: RESULT }));
    render(<RetailersSearch tenantId={T} words={WORDS} status={ON} confirm={confirmOk(false)} />);
    await ask();
    const card = screen.getAllByRole("article")[1];
    await act(async () => fireEvent.click(within(card).getByRole("button", { name: "Add as a lead" })));
    fireEvent.change(within(card).getByLabelText("Shop name"), { target: { value: "No Link Silks" } });
    await act(async () => fireEvent.click(within(card).getByRole("button", { name: "Save as a lead" })));
    expect(within(card).getByRole("status")).toHaveTextContent("This shop was already saved as a lead.");
  });
  it("a refusal to save is said in words and keeps what was typed", async () => {
    routes(() => json({ ok: true, data: RESULT }));
    const confirm = vi.fn(async () => ({ ok: false as const, kind: "forbidden" as const, error: "" }));
    render(<RetailersSearch tenantId={T} words={WORDS} status={ON} confirm={confirm} />);
    await ask();
    const card = screen.getAllByRole("article")[0];
    await act(async () => fireEvent.click(within(card).getByRole("button", { name: "Add as a lead" })));
    fireEvent.change(within(card).getByLabelText("Shop name"), { target: { value: "Balaji" } });
    await act(async () => fireEvent.click(within(card).getByRole("button", { name: "Save as a lead" })));
    expect(within(card).getByRole("alert")).toHaveTextContent("Your role cannot do this");
    expect(within(card).getByLabelText("Shop name")).toHaveValue("Balaji");
  });
  it("no results says so; the assistant's words can be opened", async () => {
    routes(() => json({ ok: true, data: { cards: [], text: "I found nothing.", error: null } }));
    render(<RetailersSearch tenantId={T} words={WORDS} status={ON} confirm={confirmOk()} />);
    await ask();
    expect(screen.getByText("Nothing was found. Try another kind of shop or a larger town.")).toBeInTheDocument();
    expect(screen.getByText("What Agent OWL said")).toBeInTheDocument();
  });
  it.each([
    ["agents_disabled", /switched off for this business/],
    ["ai_paused_until", /allowance is used up/],
    ["run_limit_reached", /Too many questions at once/],
    ["assistant_unavailable", /not available right now/],
  ])("an assistant refusal (%s) is said in words", async (code, words) => {
    routes(() => json({ ok: true, data: { cards: [], text: "", error: code } }));
    render(<RetailersSearch tenantId={T} words={WORDS} status={ON} confirm={confirmOk()} />);
    await ask();
    expect(screen.getByRole("alert")).toHaveTextContent(words);
  });
  it.each([
    [{ ok: false, kind: "forbidden", error: "" }, 403, /Your role cannot do this/],
    [{ ok: false, kind: "rate_limited", error: "", retryAfter: 17 }, 429, /Wait 17 seconds/],
    [{ ok: false, kind: "unavailable", error: "" }, 503, /could not reach the service/],
    [{ ok: false, kind: "other", error: "", code: "agents_disabled" }, 409, /switched off for this business/],
  ])("a refusal of the search route (%j) is said in words and the form keeps its words", async (body, status, words) => {
    routes(() => json(body, status));
    render(<RetailersSearch tenantId={T} words={WORDS} status={ON} confirm={confirmOk()} />);
    await ask();
    expect(screen.getByRole("alert")).toHaveTextContent(words);
    expect(screen.getByLabelText("What kind of shops?")).toHaveValue("saree wholesalers");
  });
  it("a phone number, an e-mail address or a link in the question is stopped before asking", async () => {
    const calls = routes(() => json({ ok: true, data: RESULT }));
    render(<RetailersSearch tenantId={T} words={WORDS} status={ON} confirm={confirmOk()} />);
    await ask("shops 9876543210", "");
    expect(screen.getByRole("alert")).toHaveTextContent("Take out phone numbers, e-mail addresses and links");
    expect(calls).toHaveLength(0);
    await ask("ab", "");
    expect(screen.getByRole("alert")).toHaveTextContent("Type what kind of shops you want.");
  });
  it("while the search runs it says so and cannot be pressed again", async () => {
    let release: (r: Response) => void = () => undefined;
    globalThis.fetch = vi.fn(() => new Promise<Response>((res) => (release = res))) as unknown as typeof fetch;
    render(<RetailersSearch tenantId={T} words={WORDS} status={ON} confirm={confirmOk()} />);
    fireEvent.change(screen.getByLabelText("City or town"), { target: { value: "Guntur" } });
    await press("Search");
    expect(screen.getByRole("button", { name: "Searching…" })).toBeDisabled();
    expect(screen.getByText(/Agent OWL is looking on the map/)).toBeInTheDocument();
    await act(async () => release(json({ ok: true, data: RESULT })));
    expect(screen.getAllByRole("article")).toHaveLength(2);
  });
  it("a shop's name from the map is drawn as text", async () => {
    routes(() => json({ ok: true, data: { ...RESULT, cards: [{ id: P1, label: "<img src=x onerror=alert(1)>", url: null }] } }));
    const { container } = render(<RetailersSearch tenantId={T} words={WORDS} status={ON} confirm={confirmOk()} />);
    await ask();
    expect(screen.getByText("<img src=x onerror=alert(1)>")).toBeInTheDocument();
    expect(container.querySelector("img")).toBeNull();
  });
});
