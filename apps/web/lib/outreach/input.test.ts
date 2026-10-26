import { describe, expect, it } from "vitest";

import { parseBatchInput, parseRuleInput } from "./input";

const ID = "11111111-1111-4111-8111-111111111111";
const good = { batchId: ID, name: "Meta leads, 27 Oct", goal: "site_visit", channel: "call", language: "te", who: { kind: "source", source: "meta_lead_ads", status: "new", since: null }, questions: ["What is your budget?"], messageText: null, windowDays: 7, maxCallsPerDay: 50, maxTotalMinutes: null };

describe("a batch plan as a form sends it (night 4, part A3)", () => {
  it("accepts a well-formed plan, with closed words and bounded numbers", () => {
    expect(parseBatchInput(good)).toEqual({ ...good, who: { kind: "source", source: "meta_lead_ads", status: "new", since: null } });
    expect(parseBatchInput({ ...good, who: { kind: "contacts", ids: [ID] } })?.who).toEqual({ kind: "contacts", ids: [ID] });
    expect(parseBatchInput({ ...good, language: "ml" })?.language).toBe("ml");
  });
  it("refuses unknown words, markup, too many questions, bad days and caps, a missing id", () => {
    for (const bad of [{ goal: "sell_everything" }, { channel: "sms" }, { language: "xx" }, { name: "<b>x</b>" }, { name: "  " }, { windowDays: 0 }, { windowDays: 15 }, { maxCallsPerDay: -1 }, { maxCallsPerDay: 1.5 }, { batchId: "nope" }, { questions: Array.from({ length: 9 }, () => "A question?") }, { questions: ["<script>"] }, { who: { kind: "source", source: "tv_ads" } }, { who: { kind: "contacts", ids: [] } }, { who: { kind: "source", source: "indiamart", status: "gone" } }, { who: { kind: "source", source: "indiamart", since: "yesterday" } }]) {
      expect(parseBatchInput({ ...good, ...bad }), JSON.stringify(bad)).toBeNull();
    }
    expect(parseBatchInput(null)).toBeNull();
    expect(parseBatchInput([])).toBeNull();
  });
  it("a plan that sends WhatsApp needs its own words; one that only calls does not", () => {
    expect(parseBatchInput({ ...good, channel: "both", messageText: null })).toBeNull();
    expect(parseBatchInput({ ...good, channel: "whatsapp", messageText: "Hello, thank you for your interest." })?.messageText).toBe("Hello, thank you for your interest.");
    expect(parseBatchInput({ ...good, channel: "call", messageText: "x".repeat(601) })).toBeNull();
  });
});

const rule = { ruleId: ID, source: "meta_lead_ads", action: "call_within_minutes", withinMinutes: 2, goal: "general", channel: "call", language: "en", questions: [], messageText: null, maxCallsPerDay: 50, maxTotalMinutes: null };

describe("a standing rule as a form sends it", () => {
  it("accepts the 'call within 2 minutes' rule and refuses minutes outside 1 to 120", () => {
    expect(parseRuleInput(rule)).toEqual(rule);
    expect(parseRuleInput({ ...rule, withinMinutes: 0 })).toBeNull();
    expect(parseRuleInput({ ...rule, withinMinutes: 121 })).toBeNull();
    expect(parseRuleInput({ ...rule, withinMinutes: 1.5 })).toBeNull();
  });
  it("is only for places where leads arrive by themselves (not a file upload) and only the three actions", () => {
    expect(parseRuleInput({ ...rule, source: "excel_upload" })).toBeNull();
    expect(parseRuleInput({ ...rule, source: "website_form" })?.source).toBe("website_form");
    expect(parseRuleInput({ ...rule, action: "email_first" })).toBeNull();
  });
  it("a rule that messages first needs its words", () => {
    expect(parseRuleInput({ ...rule, action: "whatsapp_first", channel: "whatsapp", messageText: null })).toBeNull();
    expect(parseRuleInput({ ...rule, action: "whatsapp_then_call", channel: "both", messageText: "Hi, we will call you shortly." })?.action).toBe("whatsapp_then_call");
  });
});
