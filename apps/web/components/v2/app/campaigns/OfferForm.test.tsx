import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh }) }));

import { parseCampaign, parseOfferCounts, parsePreview } from "@/lib/api/campaigns";
import { CAMPAIGN, CAMPAIGN_RUNNING_JSON, PREVIEW_JSON } from "@/lib/api/campaigns-fixtures";

import { BASE, WORDS } from "../materials/mat-test-kit";
import { ApprovalPanel, offerCostLine } from "./ApprovalPanel";
import { OfferAudience } from "./OfferAudience";
import { OfferForm, offerText, type OfferFormActions } from "./OfferForm";

const T1 = "72d117e4-2c05-5be8-9c28-824bd4e4dcc6";
const TEMPLATES = [{ id: T1, name: "new_collection_offer", language: "en", body: "Hello {{1}}, {{2}} has a new collection: {{3}}. Reply STOP to unsubscribe." }];
function show(over: Partial<React.ComponentProps<typeof OfferForm>> = {}, save?: OfferFormActions["save"]) {
  const go = vi.fn();
  const actions = { save: vi.fn(save ?? (async () => ({ ok: true as const, campaignId: CAMPAIGN, backToDraft: false }))) };
  render(<OfferForm base={BASE} campaignId={CAMPAIGN} campaign={null} templates={TEMPLATES} business="Neelambari Silks" words={WORDS} actions={actions} go={go} {...over} />);
  return { actions, go };
}
const type = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

describe("making an offer", () => {
  it("turns the template's words into the campaign's words (the database checks they match)", () => {
    expect(offerText(TEMPLATES[0].body)).toBe("Hello {{name}}, {{business}} has a new collection: {{label}}. Reply STOP to unsubscribe.");
  });
  it("shows the message as a customer reads it, with the label filled in", () => {
    show();
    type("Label", "Silk sarees");
    expect(screen.getByText("Hello Ravi, Neelambari Silks has a new collection: Silk sarees. Reply STOP to unsubscribe.")).toBeInTheDocument();
  });
  it("saves one message on the day at the chosen time, with the label and the weekly cap, and goes to the customers step", async () => {
    const { actions, go } = show();
    type("Name", "Diwali silk");
    type("Label", "  Silk   sarees ");
    type("Offers per customer", "2");
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: "Save and choose customers" })));
    expect(actions.save).toHaveBeenCalledWith(CAMPAIGN, { name: "Diwali silk", language: "en", waTemplateId: T1, messageText: "Hello {{name}}, {{business}} has a new collection: {{label}}. Reply STOP to unsubscribe.", offerLabel: "Silk sarees", weeklyCap: 2, time: "10:00" });
    expect(go).toHaveBeenCalledWith(`${BASE}/campaigns/${CAMPAIGN}?saved=1&tab=audience`);
  });
  it("asks for a label of 2 to 30 characters before it asks the API", async () => {
    const { actions } = show();
    type("Name", "Diwali silk");
    type("Label", "a");
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: "Save and choose customers" })));
    expect(screen.getByRole("alert")).toHaveTextContent("The label needs 2 to 30 characters.");
    expect(actions.save).not.toHaveBeenCalled();
  });
  it("shows the API's refusal in words", async () => {
    show({}, async () => ({ ok: false, error: "That label is not allowed." }));
    type("Name", "Diwali silk");
    type("Label", "50% off");
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: "Save and choose customers" })));
    expect(screen.getByRole("alert")).toHaveTextContent("That label is not allowed.");
  });
  it("says so, and cannot be saved, when there is no approved offer message", () => {
    show({ templates: [] });
    expect(screen.getByText(/There is no approved offer message yet/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save and choose customers" })).toBeDisabled();
  });
});

describe("who gets an offer", () => {
  it("adds the customers who said yes for the day and says how many", async () => {
    const action = vi.fn(async () => ({ ok: true as const, added: 12, skipped: [{ row: 3, reason: "duplicate" }], recipients: 12 }));
    render(<OfferAudience words={WORDS} base={BASE} canEdit today="2026-11-20" action={action} />);
    fireEvent.change(screen.getByLabelText("Day of the offer"), { target: { value: "2026-11-25" } });
    fireEvent.change(screen.getByLabelText("Only names containing (optional)"), { target: { value: "Ra" } });
    fireEvent.click(screen.getByRole("button", { name: "Add customers who said yes" }));
    await waitFor(() => expect(action).toHaveBeenCalledWith("2026-11-25", "Ra"));
    expect(await screen.findByRole("status")).toHaveTextContent("Added 12. 12 in the list. 1 could not be added.");
    expect(refresh).toHaveBeenCalled();
  });
  it("shows nothing to someone who cannot edit", () => {
    const { container } = render(<OfferAudience words={WORDS} base={BASE} canEdit={false} today="2026-11-20" action={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });
});

const OFFER = { recipients: 40, will_receive: 31, left_out: { stopped: 2, marketing_withdrawn: 3, no_marketing_consent: 4, no_whatsapp: 0 }, cost: { messages_at_most: 31, paise_each: 60, paise_at_most: 1860, rate_source: "estimate", before_gst: true } };
describe("approving an offer", () => {
  it("shows who gets it, who is left out and why, and the most it can cost, before GST", () => {
    const preview = parsePreview({ ...PREVIEW_JSON, offer: OFFER });
    render(<ApprovalPanel preview={preview} role="owner" status="draft" words={WORDS} approve={vi.fn()} />);
    const box = screen.getByText("Who gets this offer").closest("section") as HTMLElement;
    expect(box).toHaveTextContent("31");
    expect(box).toHaveTextContent("(the list has 40)");
    expect(box).toHaveTextContent("4 did not say yes to offers.");
    expect(box).toHaveTextContent("3 said no to offers.");
    expect(box).toHaveTextContent("2 asked us to stop.");
    expect(box).not.toHaveTextContent("no WhatsApp number");
    expect(box).toHaveTextContent("about ₹18.60 before GST (estimate)");
  });
  it("drops the word estimate once the rate is the invoice's, and says when there is no rate", () => {
    expect(offerCostLine(parseOfferCounts({ ...OFFER, cost: { ...OFFER.cost, rate_source: "invoice" } }), WORDS)).toBe("₹18.60 before GST");
    expect(offerCostLine(parseOfferCounts({ ...OFFER, cost: { messages_at_most: 31, paise_each: null, paise_at_most: null, rate_source: null, before_gst: true } }), WORDS)).toBe("The cost is not known yet.");
  });
  it("reads the campaign's label and weekly cap", () => {
    const c = parseCampaign({ ...CAMPAIGN_RUNNING_JSON, kind: "offer", offer_label: "Silk sarees", weekly_cap: 2 });
    expect(c.offer_label).toBe("Silk sarees");
    expect(c.weekly_cap).toBe(2);
  });
});
