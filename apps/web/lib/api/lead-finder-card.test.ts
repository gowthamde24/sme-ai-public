import { describe, expect, it } from "vitest";

import { ApiContractError } from "./client";
import { parseChatCard, readChatCard } from "./lead-finder-card";
import { S1, SEARCH_DONE, SEARCH_PLACES, SEARCH_PLANNED } from "./lead-finder-fixtures";

describe("the chat's Lead Finder card (contract section 1b)", () => {
  it("reads the plan card with who may OK it, from the turn's event (with its `type`) or a history message (without)", () => {
    expect(parseChatCard({ type: "lead_finder", search: SEARCH_PLANNED, can_approve: true })).toMatchObject({ canApprove: true, search: { id: S1, state: "planned", query: "saree shops", area: "Jayanagar Bengaluru", maxResults: 20, provider: "fixture", searchesLeftToday: 5 } });
    expect(parseChatCard({ search: SEARCH_PLANNED, can_approve: false }).canApprove).toBe(false);
  });
  it("reads a result card's counts and Google's attribution", () => {
    expect(parseChatCard({ search: SEARCH_DONE, can_approve: true }).search.counts).toMatchObject({ new: 18, needs_owner: 11, skipped: 7 });
    expect(parseChatCard({ search: SEARCH_PLACES, can_approve: true }).search.attribution).toBe("Google Maps");
  });
  it("refuses a card that is not the contract's shape; the lenient reader gives null instead (the sentence stands without the card)", () => {
    const bad = [null, "x", {}, { search: SEARCH_PLANNED }, { search: SEARCH_PLANNED, can_approve: "yes" }, { search: { ...SEARCH_PLANNED, state: "running" }, can_approve: true }, { search: { ...SEARCH_PLANNED, id: "nope" }, can_approve: true }, { search: { ...SEARCH_PLANNED, max_results: 500 }, can_approve: true }];
    for (const b of bad) {
      expect(() => parseChatCard(b)).toThrow(ApiContractError);
      expect(readChatCard(b)).toBeNull();
    }
  });
});
