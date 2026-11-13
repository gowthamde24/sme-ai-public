import { describe, expect, it } from "vitest";

import type { TimelineItem } from "@/lib/api/customer-timeline";

import { outcomeCard } from "./outcome-card";

const Q = "11111111-aaaa-4aaa-8aaa-000000000001";
const row = (over: Partial<TimelineItem> & { detail?: TimelineItem["detail"] }): TimelineItem => ({ kind: "quote", at: "2026-11-12T10:00:00Z", text: "Quote 12", target: { type: "quote", id: Q }, detail: {}, ...over });
const call = (over: Partial<Parameters<typeof outcomeCard>[0]> = {}) => ({ category: null, captured: {}, correction: null, ...over });

describe("the outcome card of a call", () => {
  it("a draft quote is waiting for the owner, with its total in paise", () => {
    expect(outcomeCard(call(), [row({ detail: { status: "draft", total_paise: 4_500_000 } })])).toEqual({ kind: "quote", quoteId: Q, type: "quote", state: "waiting", totalPaise: 4_500_000 });
  });
  it("an approved quote is approved; a rejected one is 'other'; a material quote keeps its type", () => {
    expect(outcomeCard(call(), [row({ detail: { status: "approved" } })])).toMatchObject({ state: "approved", totalPaise: null });
    expect(outcomeCard(call(), [row({ detail: { status: "rejected" } })])).toMatchObject({ state: "other" });
    expect(outcomeCard(call(), [row({ target: { type: "material_quote", id: Q }, detail: { status: "draft" } })])).toMatchObject({ type: "material_quote", state: "waiting" });
  });
  it("a quote row with an odd id or a bad total is not trusted", () => {
    expect(outcomeCard(call(), [row({ target: { type: "quote", id: "not-an-id" } })])).toEqual({ kind: "none" });
    expect(outcomeCard(call(), [row({ detail: { status: "draft", total_paise: -5 } })])).toMatchObject({ totalPaise: null });
  });
  it("a booked visit comes from the category, the captured facts or the timeline", () => {
    expect(outcomeCard(call({ category: "visit_booked" }), null)).toEqual({ kind: "visit", day: null, at: null });
    expect(outcomeCard(call({ captured: { visit_day: "Saturday", visit_at: "2026-11-14T06:30:00Z" } }), [])).toEqual({ kind: "visit", day: "Saturday", at: "2026-11-14T06:30:00Z" });
    expect(outcomeCard(call(), [row({ kind: "visit", target: { type: "visit", id: Q }, detail: { status: "booked", starts_at: "2026-11-15T05:00:00Z" } })])).toEqual({ kind: "visit", day: null, at: "2026-11-15T05:00:00Z" });
    expect(outcomeCard(call(), [row({ kind: "visit", target: { type: "visit", id: Q }, detail: { status: "cancelled" } })])).toEqual({ kind: "none" });
  });
  it("the owner's correction counts as much as what the assistant captured", () => {
    expect(outcomeCard(call({ correction: { summary: null, note: null, correctedAt: "2026-11-12T10:00:00Z", captured: { visit_day: "Sunday" } } }), null)).toMatchObject({ kind: "visit", day: "Sunday" });
  });
  it("a caller who asked to be called later is a call back; otherwise there is no card", () => {
    expect(outcomeCard(call({ category: "call_back_later" }), null)).toEqual({ kind: "callback", at: null });
    expect(outcomeCard(call(), null)).toEqual({ kind: "none" });
  });
});
