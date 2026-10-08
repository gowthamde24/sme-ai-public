import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { WHATSAPP_CODES } from "@/lib/whatsapp/codes";
import { WHATSAPP_SENTENCES } from "@/lib/whatsapp/sentences";

import { WhatsappActions } from "./whatsapp-actions";
import type { WhatsappView } from "./whatsapp-view";

const T = "22222222-2222-2222-2222-222222222222";
const Q = "88888888-8888-4888-8888-888888888888";
const L = "33333333-3333-3333-3333-333333333333";
const C = "cccccccc-cccc-4ccc-8ccc-ccccccccccc1";

const view = (over: Partial<WhatsappView> = {}): WhatsappView => ({ leadId: L, expired: false, validUntil: "2026-10-21", fits: true, gate: "open", policyInForce: true, consentContactId: null, notice: null, ...over });
const show = (over: Partial<WhatsappView> = {}) => render(<WhatsappActions tenantId={T} quoteId={Q} view={view(over)} />);

describe("WhatsappActions", () => {
  it("offers Open in WhatsApp as a plain link to this site's own redirect route, in a new tab without opener or referrer", () => {
    show();
    const link = screen.getByRole("link", { name: "Open in WhatsApp" });
    expect(link).toHaveAttribute("href", `/app/tenants/${T}/quotes/${Q}/whatsapp`);
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(screen.getByText(/You press send yourself\. Nothing is sent by this system\./)).toBeInTheDocument();
    expect(screen.queryByText(/Open the WhatsApp chat/)).toBeNull();
  });

  it("holds no number, no wa.me address and no text anywhere in what it renders", () => {
    const { container } = show();
    const withoutIds = container.innerHTML.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, "ID");
    expect(withoutIds).not.toMatch(/wa\.me|tel:|\+?\d{8,}/);
    expect(container.querySelectorAll("a")).toHaveLength(1);
  });

  it("a text that does not fit offers the chat alone and says to copy and paste", () => {
    show({ fits: false });
    expect(screen.queryByRole("link", { name: "Open in WhatsApp" })).toBeNull();
    expect(screen.getByRole("link", { name: "Open the WhatsApp chat" })).toHaveAttribute("href", `/app/tenants/${T}/quotes/${Q}/whatsapp?chat=1`);
    expect(screen.getByText(WHATSAPP_SENTENCES.too_long)).toBeInTheDocument();
  });

  it("an expired quote shows no controls and says it expired and that Copy still works", () => {
    show({ expired: true, validUntil: "2026-10-07", gate: "unread" });
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText(/This quote expired after 2026-10-07, so WhatsApp is not offered\. You can still copy the text\./)).toBeInTheDocument();
  });

  it.each(["contact", "key", "erased", "unkeyed", "consent"] as const)("the gate word %s: its sentence and no controls", (gate) => {
    show({ gate });
    expect(screen.getByText(WHATSAPP_SENTENCES[gate])).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Open/ })).toBeNull();
  });

  it("consent also links to the consent page of that person, built from ids", () => {
    show({ gate: "consent", consentContactId: C });
    expect(screen.getByRole("link", { name: /Record consent for this person/ })).toHaveAttribute("href", `/app/tenants/${T}/contacts/${C}/consent`);
  });

  it("consent with no contact gives the sentence and no link", () => {
    show({ gate: "consent", consentContactId: null });
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("a gate that could not be read offers nothing and says so", () => {
    show({ gate: "unread" });
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText(WHATSAPP_SENTENCES.unavailable)).toBeInTheDocument();
  });

  it("with no follow-up policy in force the controls still show, with a plain note about the list", () => {
    show({ policyInForce: false });
    expect(screen.getByRole("link", { name: "Open in WhatsApp" })).toBeInTheDocument();
    expect(screen.getByText(/No follow-up policy is in force\./)).toBeInTheDocument();
    expect(screen.getByText(/will not appear on the follow-up list until the owner publishes a policy/)).toBeInTheDocument();
  });

  it("an unknown policy state (null) says nothing about the list", () => {
    show({ policyInForce: null });
    expect(screen.queryByText(/No follow-up policy/)).toBeNull();
  });

  it.each(WHATSAPP_CODES)("the sentence for the code %s from the redirect is shown as an alert, with the controls decided by the gate as before", (notice) => {
    show({ notice });
    expect(screen.getByRole("alert")).toHaveTextContent(WHATSAPP_SENTENCES[notice]);
  });

  it("not_from_here sends the person to Copy text", () => {
    show({ notice: "not_from_here" });
    expect(screen.getByRole("alert")).toHaveTextContent("Press the button on this page again, or press Copy text.");
  });
});

describe("WhatsappActions: the 'I sent it on WhatsApp' button", () => {
  const sent = { action: async () => undefined, touchId: "55555555-5555-4555-8555-555555555555" };
  const showSent = (over: Partial<WhatsappView> = {}) => render(<WhatsappActions tenantId={T} quoteId={Q} view={view(over)} sent={sent} />);

  it("is shown with the controls when the channel is open", () => {
    showSent();
    expect(screen.getByRole("button", { name: "I sent it on WhatsApp" })).toBeInTheDocument();
    expect(screen.getByText(/another message sent to this lead/)).toBeInTheDocument();
  });

  it("is also shown when the text is too long for a link (the person pastes it, then records it)", () => {
    showSent({ fits: false });
    expect(screen.getByRole("button", { name: "I sent it on WhatsApp" })).toBeInTheDocument();
  });

  it("is shown with the no-policy note: recording still works, the list stays empty until a policy exists", () => {
    showSent({ policyInForce: false });
    expect(screen.getByRole("button", { name: "I sent it on WhatsApp" })).toBeInTheDocument();
    expect(screen.getByText(/No follow-up policy is in force\./)).toBeInTheDocument();
  });

  it.each([["expired", { expired: true, gate: "unread" as const }], ["unread", { gate: "unread" as const }], ["consent", { gate: "consent" as const }], ["contact", { gate: "contact" as const }], ["key", { gate: "key" as const }], ["erased", { gate: "erased" as const }], ["unkeyed", { gate: "unkeyed" as const }]])("is NOT shown when the quote is %s", (_name, over) => {
    showSent(over);
    expect(screen.queryByRole("button", { name: "I sent it on WhatsApp" })).toBeNull();
  });

  it("is not shown when the page gave no action", () => {
    show();
    expect(screen.queryByRole("button", { name: "I sent it on WhatsApp" })).toBeNull();
  });
});
