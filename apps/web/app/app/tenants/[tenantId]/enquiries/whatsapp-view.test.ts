import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiAuthError, ApiRequestError } from "@/lib/api/client";
import { MAX_LINK_TEXT_ENCODED } from "@/lib/whatsapp/limit";

const fetchLeadFollowup = vi.fn();
const fetchLeadContactId = vi.fn();
vi.mock("@/lib/api/followups", () => ({ fetchLeadFollowup: (...a: unknown[]) => fetchLeadFollowup(...a) }));
vi.mock("@/lib/api/lead-contact", () => ({ fetchLeadContactId: (...a: unknown[]) => fetchLeadContactId(...a) }));

import { loadWhatsappView } from "./whatsapp-view";

const T = "22222222-2222-2222-2222-222222222222";
const L = "33333333-3333-3333-3333-333333333333";
const C = "cccccccc-cccc-4ccc-8ccc-ccccccccccc1";
const NOW = new Date("2026-10-08T06:00:00Z");
const quote = (over: Record<string, unknown> = {}) => ({ id: "q", lead_id: L, valid_until: "2026-10-21", ...over }) as never;
const text = (t = "Approved quote\nTotal") => ({ text: t }) as never;
const gate = (blocked: string | null, over: Record<string, unknown> = {}) => ({ channel: "whatsapp", channels: [], gate: { blocked, stopped: null, policy_in_force: true }, ...over });
afterEach(() => vi.clearAllMocks());

describe("loadWhatsappView", () => {
  it("an open gate: open, with the policy state, the fit, and nothing else", async () => {
    fetchLeadFollowup.mockResolvedValue(gate(null));
    expect(await loadWhatsappView("tok", T, quote(), text(), undefined, NOW)).toEqual({
      leadId: L, expired: false, validUntil: "2026-10-21", fits: true, gate: "open", policyInForce: true, consentContactId: null, notice: null,
    });
    expect(fetchLeadFollowup).toHaveBeenCalledWith("tok", T, L, "whatsapp");
    expect(fetchLeadContactId).not.toHaveBeenCalled();
  });

  it("an expired quote reads nothing at all", async () => {
    const v = await loadWhatsappView("tok", T, quote({ valid_until: "2026-10-07" }), text(), undefined, NOW);
    expect(v.expired).toBe(true);
    expect(fetchLeadFollowup).not.toHaveBeenCalled();
  });

  it.each(["contact", "key", "erased", "unkeyed"])("the gate word %s is passed on and the contact is not looked up", async (word) => {
    fetchLeadFollowup.mockResolvedValue(gate(word));
    expect((await loadWhatsappView("tok", T, quote(), text(), undefined, NOW)).gate).toBe(word);
    expect(fetchLeadContactId).not.toHaveBeenCalled();
  });

  it("consent looks up the contact, only to link to its consent page", async () => {
    fetchLeadFollowup.mockResolvedValue(gate("consent"));
    fetchLeadContactId.mockResolvedValue(C);
    const v = await loadWhatsappView("tok", T, quote(), text(), undefined, NOW);
    expect(v.gate).toBe("consent");
    expect(v.consentContactId).toBe(C);
  });

  it("consent with a contact that cannot be read still shows the gate", async () => {
    fetchLeadFollowup.mockResolvedValue(gate("consent"));
    fetchLeadContactId.mockRejectedValue(new Error("down"));
    const v = await loadWhatsappView("tok", T, quote(), text(), undefined, NOW);
    expect(v.gate).toBe("consent");
    expect(v.consentContactId).toBeNull();
  });

  it("an unknown gate word, an answer for another channel, or a failed read is unread, never passed on", async () => {
    fetchLeadFollowup.mockResolvedValue(gate("brand-new-word"));
    expect((await loadWhatsappView("tok", T, quote(), text(), undefined, NOW)).gate).toBe("unread");
    fetchLeadFollowup.mockResolvedValue(gate(null, { channel: "email" }));
    expect((await loadWhatsappView("tok", T, quote(), text(), undefined, NOW)).gate).toBe("unread");
    fetchLeadFollowup.mockRejectedValue(new ApiRequestError(500, "boom", "x"));
    expect((await loadWhatsappView("tok", T, quote(), text(), undefined, NOW)).gate).toBe("unread");
  });

  it("an expired session is the one error that is passed on", async () => {
    fetchLeadFollowup.mockRejectedValue(new ApiAuthError());
    await expect(loadWhatsappView("tok", T, quote(), text(), undefined, NOW)).rejects.toBeInstanceOf(ApiAuthError);
    fetchLeadFollowup.mockResolvedValue(gate("consent"));
    fetchLeadContactId.mockRejectedValue(new ApiAuthError());
    await expect(loadWhatsappView("tok", T, quote(), text(), undefined, NOW)).rejects.toBeInstanceOf(ApiAuthError);
  });

  it("fits follows the encoded length against the limit", async () => {
    fetchLeadFollowup.mockResolvedValue(gate(null));
    expect((await loadWhatsappView("tok", T, quote(), text("a".repeat(MAX_LINK_TEXT_ENCODED)), undefined, NOW)).fits).toBe(true);
    expect((await loadWhatsappView("tok", T, quote(), text("a".repeat(MAX_LINK_TEXT_ENCODED + 1)), undefined, NOW)).fits).toBe(false);
  });

  it("reads the notice as a closed code and ignores any other value", async () => {
    fetchLeadFollowup.mockResolvedValue(gate(null));
    expect((await loadWhatsappView("tok", T, quote(), text(), "expired", NOW)).notice).toBe("expired");
    for (const bad of ["EXPIRED", "<script>", "919876543210", ["x"], undefined]) expect((await loadWhatsappView("tok", T, quote(), text(), bad as string, NOW)).notice).toBeNull();
  });

  it("carries no phone number, no name and no text", async () => {
    fetchLeadFollowup.mockResolvedValue(gate(null));
    const v = await loadWhatsappView("tok", T, quote(), text("SECRET TEXT"), undefined, NOW);
    expect(JSON.stringify(v)).not.toContain("SECRET");
  });
});
