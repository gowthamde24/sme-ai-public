import { describe, expect, it } from "vitest";

import { cleanFactText, needsSecondFactor, parseFact, parseFacts, parseSource, parseSources } from "./knowledge";
import { EMPTY, draftFrom, factOf, idFrom, kindOf, parse as parseMock, sourceOf } from "./knowledge-mock";
import { PRICE_OR_PROMISE, cleanLine, parseEdit, parsePlaybook, playbookPutBody } from "./playbook";
import { applyFilter, filterHref, mockLeads, parseFilter, NO_FILTER } from "./leads";
import { MOCK_TEMPLATES, parseTemplates, toPackSummary } from "./templates";
import { markHot } from "./leads-source";

const U = "44444444-4444-4444-8444-444444444444";

describe("the nine lead templates (night 4, part A1)", () => {
  it("the made-up nine each have the four languages, a goal, an accent and a prop, and are not validated", () => {
    expect(MOCK_TEMPLATES).toHaveLength(9);
    for (const t of MOCK_TEMPLATES) {
      for (const l of ["en", "te", "hi", "kn"]) {
        expect(t.names[l], `${t.packId} ${l}`).toBeTruthy();
        expect(t.summary[l]).toBeTruthy();
        expect(t.goalLabel[l]).toBeTruthy();
      }
      expect(t.validated).toBe(false);
      expect(t.accent).toBe("leads_orange");
      expect(toPackSummary(t)).toMatchObject({ packId: t.packId, status: "preview", validated: false });
    }
    expect(MOCK_TEMPLATES.map((t) => t.packId)).toEqual([...MOCK_TEMPLATES.map((t) => t.packId)].sort());
  });
  it("reads the API's list and refuses what is not the contract", () => {
    const row = { pack_id: "gym", version: 1, names: { en: "Gym", te: "జిమ్" }, summary: { en: "x" }, goal: { code: "trial", label: { en: "Trial" } }, question_count: 4, accent: "leads_orange", owl_prop: "dumbbell", validated: false };
    expect(parseTemplates({ templates: [row] })[0]).toMatchObject({ packId: "gym", goalCode: "trial", questionCount: 4, owlProp: "dumbbell" });
    expect(() => parseTemplates({ templates: [{ ...row, names: { te: "x" } }] })).toThrow();
    expect(() => parseTemplates({ templates: [{ ...row, pack_id: "Bad Id" }] })).toThrow();
    expect(() => parseTemplates(null)).toThrow();
  });
});

describe("the knowledge base (night 4, part A1)", () => {
  it("a fact is 3 to 500 characters, with no link and no markup; whitespace is tidied", () => {
    expect(cleanFactText("  We are open   9 to 6.  ")).toBe("We are open 9 to 6.");
    for (const bad of ["ab", "x".repeat(501), "see https://x.example", "visit www.x.in", "<b>hi</b>", 5, null]) expect(cleanFactText(bad), String(bad)).toBeNull();
  });
  it("a price, or anything that looks like one, needs the second factor", () => {
    expect(needsSecondFactor("price", "Starts at five lakh")).toBe(true);
    expect(needsSecondFactor("other", "Flats from ₹45 lakh")).toBe(true);
    expect(needsSecondFactor("other", "Rs. 500 per visit")).toBe(true);
    expect(needsSecondFactor("hours", "Open 9 to 6")).toBe(false);
  });
  it("reads sources and facts from the API's shapes", () => {
    const src = { id: "s1", title: "Site", kind: "paste", filename: null, content_type: null, chars: 120, status: "read", created_at: "2026-10-27T10:00:00Z", facts: { draft: 2, approved: 1, rejected: 0 } };
    expect(parseSources({ sources: [src] })[0]).toMatchObject({ id: "s1", chars: 120, facts: { draft: 2, approved: 1 } });
    expect(() => parseSource({ ...src, status: "eaten" })).toThrow();
    const fact = { id: "f1", kind: "hours", text: "Open 9 to 6", status: "draft", edited: false, source_id: "s1", decided_at: null, decided_by_you: false };
    expect(parseFact(fact)).toMatchObject({ kind: "hours", status: "draft", sourceId: "s1" });
    expect(parseFacts({ facts: [fact], next_cursor: null }).facts).toHaveLength(1);
    expect(() => parseFact({ ...fact, kind: "secret" })).toThrow();
  });
  it("the test screens draft facts from sentences, guess the kind, keep ids stable and cap the count", () => {
    const text = "We sell two bedroom flats near Gachibowli. Flats start at ₹45 lakh. We are open Monday to Saturday, 9 am to 6 pm. Call us on WhatsApp for a visit. Short.";
    const src = { id: "s1", title: "t", kind: "paste" as const, filename: null, chars: text.length, createdAt: "2026-10-27T10:00:00Z", text, discarded: false };
    const facts = draftFrom(src, new Set());
    expect(facts.map((f) => f.kind)).toEqual(["location", "price", "hours", "contact"]);
    expect(draftFrom(src, new Set()).map((f) => f.id)).toEqual(facts.map((f) => f.id));
    expect(draftFrom(src, new Set(facts.map((f) => f.id)))).toHaveLength(0);
    expect(kindOf("Refund policy: no refund after booking")).toBe("policy");
    expect(idFrom("a")).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/);
    const state = { sources: [src], facts };
    expect(sourceOf({ ...src, text: null }, facts)).toMatchObject({ status: "drafted", facts: { draft: 4, approved: 0 } });
    expect(factOf(facts[0])).toMatchObject({ status: "draft", decidedByYou: false });
    expect(parseMock({ ...state, facts: [...facts, { ...facts[0], kind: "nope" }] })?.facts).toHaveLength(4);
    expect(parseMock("x")).toBeNull();
    expect(EMPTY.facts).toEqual([]);
  });
});

const body = { goal_ask: { en: "Book a site visit when they are ready." }, questions: [{ field: "budget", ask: { en: "What budget range are you comfortable with?" }, required: true }, { field: "area", ask: { en: "Which area?" }, required: false }], objections: [{ code: "too_expensive", hears: ["too costly"], answer: { en: "I understand." } }], followups: [{ when: "no_answer", after_minutes: 30, channel: "call", max_attempts: 3, message: null }], outcome_reasons: { not_interested: [], interested: [] } };

describe("the lead playbook", () => {
  it("reads the API's playbook, with the template and the defaults, and keeps what the owner may not edit for the save", () => {
    const read = parsePlaybook({ template_pack: "real_estate", saved: false, playbook: body, defaults: body, safety: ["Says it is an AI assistant."], updated_at: null, wording: "draft" });
    expect(read).toMatchObject({ templatePack: "real_estate", saved: false, safety: ["Says it is an AI assistant."] });
    expect(read.playbook?.questions[1]).toEqual({ field: "area", ask: "Which area?", required: false });
    const put = playbookPutBody(read.playbook!, { goalAsk: "Book a visit.", questions: [{ field: "area", ask: "Where?", required: true }] });
    expect(put).toMatchObject({ goal_ask: { en: "Book a visit." }, questions: [{ field: "area", ask: { en: "Where?" }, required: true }], objections: body.objections, followups: body.followups, outcome_reasons: body.outcome_reasons });
    expect(parsePlaybook({ template_pack: null, saved: false, playbook: null, defaults: null, safety: [], updated_at: null }).playbook).toBeNull();
  });
  it("a goal or a question states no price and no promise", () => {
    expect(cleanLine("What is your budget?")).toEqual({ ok: true, text: "What is your budget?" });
    for (const bad of ["It costs ₹5 lakh", "We guarantee a loan", "20% off today", "Rs. 500 only", "We promise delivery"]) expect(cleanLine(bad), bad).toEqual({ ok: false, error: "price_or_promise" });
    expect(PRICE_OR_PROMISE.test("We do not guarantee anything")).toBe(false);
    expect(cleanLine("<b>x</b> hello")).toEqual({ ok: false, error: "invalid" });
    expect(cleanLine("hi")).toEqual({ ok: false, error: "invalid" });
  });
  it("an edit needs 1 to 8 questions, each on one field of the business type, once", () => {
    const q = (field: string) => ({ field, ask: "What do you need exactly?", required: false });
    const allowed = new Set(["need", "budget"]);
    expect(parseEdit({ goalAsk: "Book a visit when ready.", questions: [q("need"), q("budget")] }, allowed)).toMatchObject({ ok: true });
    for (const bad of [{ questions: [] }, { questions: [q("need"), q("need")] }, { questions: [q("secret")] }, { questions: Array.from({ length: 9 }, (_, i) => q(`f${i}`)) }, { goalAsk: "x" }, { questions: [{ field: "need", ask: "It costs ₹5 lakh", required: true }] }]) {
      expect(parseEdit({ goalAsk: "Book a visit when ready.", questions: [q("need")], ...bad }, allowed).ok, JSON.stringify(bad)).toBe(false);
    }
    expect(parseEdit(null, null)).toEqual({ ok: false, error: "invalid" });
  });
});

describe("the leads of Lead Desk", () => {
  const now = new Date("2026-10-27T10:00:00Z");
  const leads = mockLeads(now, {}, [], U);
  it("fourteen made-up leads, the same each time, every source a real tag", () => {
    expect(leads).toHaveLength(14);
    expect(mockLeads(now, {}, [], U)).toEqual(leads);
    expect(new Set(leads.map((l) => l.source))).toEqual(new Set(["meta_lead_ads", "indiamart", "website_form", "excel_upload", "justdial"]));
    expect(mockLeads(now, { [leads[1].id]: U }, [], U)[1].ownerUserId).toBe(U);
    expect(mockLeads(now, { [leads[0].id]: null }, [], U)[0].ownerUserId).toBeNull();
  });
  it("filters by source, state, mine and hot, and only on words it knows", () => {
    expect(parseFilter({ source: "indiamart", status: "new", mine: "1", hot: "1" })).toEqual({ source: "indiamart", status: "new", mine: true, hot: true });
    expect(parseFilter({ source: "tv", status: "gone", mine: "yes" })).toEqual(NO_FILTER);
    expect(parseFilter({ source: ["justdial"] }).source).toBe("justdial");
    expect(applyFilter(leads, { ...NO_FILTER, source: "indiamart" }, U).every((l) => l.source === "indiamart")).toBe(true);
    expect(applyFilter(leads, { ...NO_FILTER, mine: true }, U).every((l) => l.ownerUserId === U)).toBe(true);
    expect(applyFilter(leads, { ...NO_FILTER, hot: true }, U)).toEqual([]);
    expect(filterHref("/b", { ...NO_FILTER, source: "indiamart", hot: true })).toBe("/b/lead-desk?source=indiamart&hot=1");
    expect(filterHref("/b", NO_FILTER)).toBe("/b/lead-desk");
  });
  it("a lead is hot when an open hand-off names it (by lead, by contact, or in the test screens by name); an acted one does not", () => {
    const h = (over: object) => ({ id: "h", leadId: null, contactId: "c", contactName: "Ravi K.", summary: "s", assignedTo: U, notifiedAt: "x", reminderSentAt: null, actedAt: null, ...over });
    const real = [{ ...leads[0], contactId: "c1" }, { ...leads[1], contactId: "c2" }];
    expect(markHot(real, [h({ contactId: "c2", contactName: "Zed" })], false).map((l) => l.hot)).toEqual([false, true]);
    expect(markHot(real, [h({ leadId: real[0].id, contactId: "other", contactName: "Zed" })], false).map((l) => l.hot)).toEqual([true, false]);
    expect(markHot(leads, [h({})], true).filter((l) => l.hot).map((l) => l.name)).toEqual(["Ravi K."]);
    expect(markHot(leads, [h({ actedAt: "now" })], true).some((l) => l.hot)).toBe(false);
  });
});
