import { describe, expect, it } from "vitest";

import { parseTodayBriefing } from "./today-briefing";

describe("the small Today briefing read (C1's contract, 19 Nov)", () => {
  it("reads integers and keeps null as 'not known or not for you' (0 is known and zero)", () => {
    expect(parseTodayBriefing({ needs_you: 2, new_leads: 35, visits_today: 0, unread_chats: null, followups_due: 3, quotes_waiting: 1, live_calls: 0, as_of: "2026-11-19T07:00:00Z" })).toEqual({ needsYou: 2, newLeads: 35, visitsToday: 0, unreadChats: null, followupsDue: 3, quotesWaiting: 1, liveCalls: 0 });
  });
  it("refuses anything that is not a count: a string, a fraction, a negative, a huge number", () => {
    expect(parseTodayBriefing({ needs_you: "2", new_leads: 1.5, visits_today: -1, unread_chats: 10_000_000 })).toEqual({ needsYou: null, newLeads: null, visitsToday: null, unreadChats: null, followupsDue: null, quotesWaiting: null, liveCalls: null });
  });
  it("is null for an answer that is not an object", () => {
    expect(parseTodayBriefing(null)).toBeNull();
    expect(parseTodayBriefing([1])).toBeNull();
    expect(parseTodayBriefing("x")).toBeNull();
  });
});
