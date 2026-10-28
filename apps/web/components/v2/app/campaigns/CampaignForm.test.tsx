import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

import { parseCampaign } from "@/lib/api/campaigns";
import { CAMPAIGN, CAMPAIGN_RUNNING_JSON, TEMPLATE } from "@/lib/api/campaigns-fixtures";

import { BASE, WORDS } from "../materials/mat-test-kit";
import { CampaignForm, type CampaignFormActions } from "./CampaignForm";

const TEMPLATES = [{ id: TEMPLATE, name: "payment_reminder_en", language: "en" }, { id: "7e000000-0000-4000-8000-000000000002", name: "payment_reminder_te", language: "te" }];
function show(over: Partial<React.ComponentProps<typeof CampaignForm>> = {}, save?: CampaignFormActions["save"]) {
  const go = vi.fn();
  const actions = { save: vi.fn(save ?? (async () => ({ ok: true as const, campaignId: CAMPAIGN, backToDraft: false }))) };
  render(<CampaignForm base={BASE} campaignId={CAMPAIGN} campaign={null} kinds={["payment_due", "delivery_update"]} templates={TEMPLATES} words={WORDS} actions={actions} go={go} {...over} />);
  return { actions, go };
}
const type = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const save = () => act(async () => void fireEvent.click(screen.getByRole("button", { name: "Save the draft" })));
beforeEach(() => vi.clearAllMocks());

describe("making a campaign", () => {
  it("sends the whole campaign with the page's id and opens it", async () => {
    const { actions, go } = show();
    type("Name", "October reminders");
    type("Message", "Hello {{name}}, {{amount}} is due on {{due_date}}.");
    type("WhatsApp template", TEMPLATE);
    await save();
    expect(actions.save).toHaveBeenCalledWith(CAMPAIGN, { name: "October reminders", kind: "payment_due", language: "en", waTemplateId: TEMPLATE, messageText: "Hello {{name}}, {{amount}} is due on {{due_date}}.", steps: [{ offset_days: -3, time: "10:00" }, { offset_days: 0, time: "10:00" }], callAfterStep: null, callWaitHours: 24 });
    expect(go).toHaveBeenCalledWith(`${BASE}/campaigns/${CAMPAIGN}?saved=1`);
  });
  it("lists only the templates in the chosen language", () => {
    show();
    expect(screen.getByRole("option", { name: "payment_reminder_en" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "payment_reminder_te" })).toBeNull();
    type("Language of the message", "te");
    expect(screen.getByRole("option", { name: "payment_reminder_te" })).toBeInTheDocument();
  });
  it("a delivery update has no amount button and refuses an amount in the text", async () => {
    const { actions } = show();
    type("Message", "Your order {{reference}} is on the way, {{amount}}.");
    fireEvent.change(screen.getByLabelText("Kind"), { target: { value: "delivery_update" } });
    expect(screen.queryByRole("button", { name: "Amount" })).toBeNull();
    type("Name", "Trips");
    await save();
    expect(screen.getByRole("alert")).toHaveTextContent("no amount");
    expect(actions.save).not.toHaveBeenCalled();
  });
  it.each([["no name", "", "Hello {{name}} pay soon", "Give the campaign a name."], ["a text that is too short", "A", "Hi", "8 to 600"], ["a detail that does not exist", "A", "Hello {{phone}} pay soon", "does not exist"]])("%s is refused before it is sent", async (_n, name, text, sentence) => {
    const { actions } = show();
    type("Name", name);
    type("Message", text);
    await save();
    expect(screen.getByRole("alert")).toHaveTextContent(sentence);
    expect(actions.save).not.toHaveBeenCalled();
  });
  it("shows how the message reads for one person, with example details", () => {
    show();
    type("Message", "Hello {{name}}, {{amount}} is due on {{due_date}}.");
    expect(screen.getByText(/Hello Ravi Kumar, ₹12,500.00 is due on 20 Oct 2026\./)).toBeInTheDocument();
  });
  it("steps that go backwards in time are refused", async () => {
    const { actions } = show();
    type("Name", "A");
    type("Message", "Hello {{name}} pay soon please");
    type("Step 1: days from the due date (minus is before)", "5");
    await save();
    expect(screen.getByRole("alert")).toHaveTextContent("in order");
    expect(actions.save).not.toHaveBeenCalled();
  });
  it("a refusal from the server is shown with the Security link when the second factor is missing", async () => {
    show({}, async () => ({ ok: false, error: "This needs your two-step code, if you turned it on.", mfa: true }));
    type("Name", "A");
    type("Message", "Hello {{name}} pay soon please");
    await save();
    expect(screen.getByRole("alert")).toHaveTextContent("two-step code");
  });
});

describe("changing a campaign", () => {
  it("the kind cannot change, and an approved campaign warns that it goes back to draft", async () => {
    const { actions, go } = show({ campaign: parseCampaign(CAMPAIGN_RUNNING_JSON) }, async () => ({ ok: true, campaignId: CAMPAIGN, backToDraft: true }));
    expect(screen.getByLabelText("Kind")).toBeDisabled();
    expect(screen.getByText(/Saving sends this campaign back to draft/)).toBeInTheDocument();
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: "Save changes" })));
    expect(actions.save).toHaveBeenCalledTimes(1);
    expect(go).toHaveBeenCalledWith(`${BASE}/campaigns/${CAMPAIGN}?back=1`);
  });
});
