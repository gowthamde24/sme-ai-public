import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { appDict } from "@/i18n/app";
import { parsePracticeCall, parseProspect, parseQuoteDraftMade, parseQuoteDraftPreview } from "@/lib/api/lead-finder";
import { E1, PRACTICE, PROSPECT_QUALIFIED, PROSPECT_READY, Q1, QUOTE_DRAFT, QUOTE_DRAFT_MADE, QUOTE_DRAFT_NONE } from "@/lib/api/lead-finder-fixtures";
import type { QuoteDraftMade, QuoteDraftView } from "@/lib/lead-finder/types";

import type { Failed, Reply } from "../cc/kit";
import { ProspectList, type ListActions } from "./ProspectList";
import { QuoteDraft, type DraftActions } from "./QuoteDraft";

const words = Object.fromEntries(Object.entries(appDict("en") as Record<string, string>).filter(([k]) => /^(lf|apierr)\./.test(k) || k === "today.state.draft"));
const BASE = "/app/tenants/t";
const view = (json: unknown = QUOTE_DRAFT, enquiryId: string | null = null): QuoteDraftView => ({ ...parseQuoteDraftPreview(json), enquiryId });
const ok = <T,>(data: T) => ({ ok: true as const, data });
const refused = (kind: Failed["kind"], error: string, code?: string): Failed => ({ ok: false, kind, error, ...(code ? { code } : {}), ...(kind === "mfa" ? { mfa: true } : {}) });
beforeEach(() => vi.clearAllMocks());

const draw = (canMake: boolean, over: Partial<DraftActions> = {}, open = true) => {
  const actions: DraftActions = { preview: vi.fn(async (): Promise<Reply<QuoteDraftView>> => ok(view())), make: vi.fn(async (): Promise<Reply<QuoteDraftMade>> => ok(parseQuoteDraftMade(QUOTE_DRAFT_MADE))), ...over };
  render(<QuoteDraft words={words} base={BASE} canMake={canMake} actions={actions} open={open} />);
  return actions;
};

describe("the draft quote of a qualified call (contract section 7)", () => {
  it("shows each line as item × qty at ₹price with what they said, and each left-out item with its reason in words", async () => {
    draw(true);
    expect(await screen.findByText("Kanchi Pattu Bridal × 40 at ₹8,500")).toBeInTheDocument();
    expect(screen.getByText("they said: About forty pieces a month, more in the season.")).toBeInTheDocument();
    const left = within(document.querySelector("[data-draft-left-out]") as HTMLElement);
    expect(left.getByText("no exact price set")).toBeInTheDocument();
    expect(left.getByText("they said no number")).toBeInTheDocument();
    expect(left.getByText("not in stock now")).toBeInTheDocument();
    expect(screen.getByText(/Nothing is approved or sent/)).toBeInTheDocument();
  });
  it("Make the draft quote (when ready) makes it, says nothing was approved or sent, and opens on its ENQUIRY's page", async () => {
    const a = draw(true);
    fireEvent.click(await screen.findByRole("button", { name: "Make the draft quote" }));
    expect(a.make).toHaveBeenCalledTimes(1);
    expect(await screen.findByText("Draft quote made. Nothing was approved or sent.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open the draft quote" })).toHaveAttribute("href", `${BASE}/enquiries/${E1}?quote=${Q1}`);
    expect(screen.queryByRole("button", { name: "Make the draft quote" })).toBeNull();
  });
  it("not ready: no button, and the other reasons in words", async () => {
    draw(true, { preview: vi.fn(async () => ok(view(QUOTE_DRAFT_NONE))) });
    expect(await screen.findByText("No line can go in a draft yet.")).toBeInTheDocument();
    for (const text of ["no longer in the catalogue", "its item type is switched off", "a draft holds five lines"]) expect(screen.getByText(text)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Make the draft quote" })).toBeNull();
  });
  it("a salesperson sees the preview and who can make it, with no button", async () => {
    draw(false);
    expect(await screen.findByText("Only the owner or an admin can make the draft quote.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Make the draft quote" })).toBeNull();
  });
  it("already made: Open the draft quote instead of the button (the list of quotes when its enquiry could not be read)", async () => {
    draw(true, { preview: vi.fn(async () => ok(view({ ...QUOTE_DRAFT, made: true }, E1))) });
    expect(await screen.findByRole("link", { name: "Open the draft quote" })).toHaveAttribute("href", `${BASE}/enquiries/${E1}?quote=${Q1}`);
    expect(screen.queryByRole("button", { name: "Make the draft quote" })).toBeNull();
    document.body.innerHTML = "";
    draw(true, { preview: vi.fn(async () => ok(view({ ...QUOTE_DRAFT, made: true }, null))) });
    expect(await screen.findByRole("link", { name: "Open the draft quote" })).toHaveAttribute("href", `${BASE}/quotes`);
  });
  it("a missing second factor shows the way to Security; nothing to quote is said in words", async () => {
    const make = vi.fn(async (): Promise<Reply<QuoteDraftMade>> => refused("mfa", "This needs your two-step code first."));
    draw(true, { make });
    fireEvent.click(await screen.findByRole("button", { name: "Make the draft quote" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("This needs your two-step code first.");
    expect(within(alert).getByRole("link", { name: "Open Security" })).toHaveAttribute("href", "/app/security");
    make.mockResolvedValueOnce(refused("invalid", "Nothing from this call can go in a draft.", "nothing_to_quote"));
    fireEvent.click(screen.getByRole("button", { name: "Make the draft quote" }));
    expect(await screen.findByText("Nothing from this call can go in a draft.")).toBeInTheDocument();
  });
  it("a draft made before with other prices: said in words, and the preview is read again with the way to open it", async () => {
    const preview = vi.fn(async (): Promise<Reply<QuoteDraftView>> => ok(view()));
    draw(true, { preview, make: vi.fn(async () => refused("conflict", "A draft from this call was already made with other prices. Open it instead.", "quote_draft_exists")) });
    fireEvent.click(await screen.findByRole("button", { name: "Make the draft quote" }));
    preview.mockResolvedValueOnce(ok(view({ ...QUOTE_DRAFT, made: true }, E1)));
    expect(await screen.findByRole("alert")).toHaveTextContent("already made with other prices");
    expect(await screen.findByRole("link", { name: "Open the draft quote" })).toHaveAttribute("href", `${BASE}/enquiries/${E1}?quote=${Q1}`);
    expect(preview).toHaveBeenCalledTimes(2);
  });
  it("closed, nothing is read until the person opens it", async () => {
    const a = draw(true, {}, false);
    expect(a.preview).not.toHaveBeenCalled();
    const box = document.querySelector("[data-quote-draft-box]") as HTMLDetailsElement;
    box.open = true;
    fireEvent(box, new Event("toggle"));
    expect(await screen.findByText("Kanchi Pattu Bridal × 40 at ₹8,500")).toBeInTheDocument();
    expect(a.preview).toHaveBeenCalledTimes(1);
  });
});

describe("where it is offered", () => {
  const actions = (): ListActions => ({ act: vi.fn(), practice: vi.fn(async () => ok(parsePracticeCall(PRACTICE))), quoteDraft: vi.fn(async () => ok(view())), makeQuoteDraft: vi.fn(async () => ok(parseQuoteDraftMade(QUOTE_DRAFT_MADE))) });
  it("on a qualified business of the list (with its lead), not on the others", () => {
    render(<ProspectList items={[PROSPECT_QUALIFIED, PROSPECT_READY].map(parseProspect)} words={words} base={BASE} canPractice langNames={{ en: "English", te: "తెలుగు" }} actions={actions()} />);
    expect(within(document.querySelector(`[data-prospect="${PROSPECT_QUALIFIED.id}"]`) as HTMLElement).getByText("Draft a quote")).toBeInTheDocument();
    expect(within(document.querySelector(`[data-prospect="${PROSPECT_READY.id}"]`) as HTMLElement).queryByText("Draft a quote")).toBeNull();
  });
  it("under a practice call that qualified, opened and read at once for the call's business", async () => {
    const a = actions();
    render(<ProspectList items={[PROSPECT_READY].map(parseProspect)} words={words} base={BASE} canPractice langNames={{ en: "English", te: "తెలుగు" }} actions={a} />);
    fireEvent.click(screen.getByText("Practice call"));
    fireEvent.click(screen.getByRole("button", { name: "Start the practice call" }));
    expect(await screen.findByText("Kanchi Pattu Bridal × 40 at ₹8,500")).toBeInTheDocument();
    expect(a.quoteDraft).toHaveBeenCalledWith(PROSPECT_QUALIFIED.id);
    expect(screen.getByRole("button", { name: "Make the draft quote" })).toBeInTheDocument();
  });
});
