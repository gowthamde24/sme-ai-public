import { describe, expect, it } from "vitest";

import { checkDescribeInput, parseDraft } from "@/lib/api/jobs-describe";

import { JOB_NAME_MAX, KIND_KEYS, TELL_KINDS, TELL_TEXT_MAX, mockDraft, optionsOf, settingsPatch, startValues, stillUnclear, withMode, type TellDraft } from "./tell";
import { JOB_KINDS } from "./types";

const draft = (over: Partial<TellDraft> = {}): TellDraft => ({ understood: true, templateId: "call_new_enquiries", kind: "speed_to_lead", goal: "answer_every_enquiry", fields: [], unclear: [], nearest: [], unclearWords: null, ...over });

describe("the sentence the model reads", () => {
  it("puts the mode in front as one plain English line and keeps the whole under 1000 characters", () => {
    expect(withMode("  call them  ", "incoming")).toBe("This job answers incoming calls. call them");
    expect(withMode("call them", null)).toBe("call them");
    const long = withMode("x".repeat(2000), "enquiry");
    expect(long.length).toBe(TELL_TEXT_MAX);
    expect(long.startsWith("This job is for new enquiries")).toBe(true);
  });
});

describe("the draft's values", () => {
  it("starts from what the API settled; a yes or no is on/off; what it never heard is empty", () => {
    const d = draft({ fields: [{ key: "when", value: "after_10_min", words: "" }, { key: "thank_you_whatsapp", value: true, words: "" }], unclear: ["language"] });
    expect(startValues(d)).toEqual({ when: "after_10_min", language: "", tries: "", thank_you_whatsapp: "on", from_hour: "", to_hour: "" });
  });
  it("an unclear key stays open until the owner chooses it", () => {
    const d = draft({ unclear: ["language", "tries"] });
    const v = startValues(d);
    expect(stillUnclear(d, v)).toEqual(["language", "tries"]);
    expect(stillUnclear(d, { ...v, language: "te" })).toEqual(["tries"]);
  });
  it("a key that is not one of the kind's settings is never open (nothing to choose)", () => {
    expect(stillUnclear(draft({ unclear: ["nudges"] }), {})).toEqual([]);
  });
  it("the PATCH holds only the keys with a value, as the wire wants them, and drops anything outside the kind's own options", () => {
    expect(settingsPatch("speed_to_lead", { when: "right_away", language: "te", tries: "", thank_you_whatsapp: "off", from_hour: "09:30", to_hour: "22:00" })).toEqual({ when: "right_away", language: "te", thank_you_whatsapp: false, from_hour: "09:30" });
    expect(settingsPatch("followups", { nudges: "nudges_9", gap_days: "days_3", when: "right_away" })).toEqual({ gap_days: "days_3" });
    expect(settingsPatch("answer_calls", { when: "right_away" })).toEqual({});
  });
  it("every kind has its keys and each key has its options (the same closed words as the API's catalogue)", () => {
    for (const kind of JOB_KINDS) for (const key of KIND_KEYS[kind]) expect(optionsOf(kind, key), `${kind}.${key}`).not.toBeNull();
    expect(optionsOf("speed_to_lead", "to_hour")).toContain("21:00");
    expect(optionsOf("speed_to_lead", "to_hour")).not.toContain("21:30");
    expect(optionsOf("store_visits", "to_hour")).toContain("23:30");
    expect(TELL_KINDS).not.toContain("custom");
    expect(JOB_NAME_MAX).toBe(40);
  });
});

describe("the made-up reading (TELL_SCREENS=mock)", () => {
  it("reads a few words and always leaves one thing open for a call job, so the highlight is seen", () => {
    const d = mockDraft("Call everyone who asks about a saree", "enquiry");
    expect(d).toMatchObject({ understood: true, kind: "speed_to_lead", unclear: ["language"] });
    expect(mockDraft("anything", "incoming").kind).toBe("answer_calls");
    expect(mockDraft("remind about the quote", null).kind).toBe("followups");
  });
  it("says it did not understand rather than guess", () => {
    expect(mockDraft("asdf asdf", null)).toMatchObject({ understood: false, kind: null, fields: [] });
    expect(mockDraft("ab", null).understood).toBe(false);
  });
});

describe("the API's draft is read strictly", () => {
  const wire = { understood: true, template_id: "call_new_enquiries", kind: "speed_to_lead", goal: "answer_every_enquiry", fields: [{ key: "when", value: "right_away", words: "When: right away" }], unclear: ["language"], nearest: [], unclear_words: "A few things were not clear from what you said: language. Please choose them yourself." };
  it("parses a good draft", () => {
    expect(parseDraft(wire)).toMatchObject({ understood: true, kind: "speed_to_lead", templateId: "call_new_enquiries", unclear: ["language"], fields: [{ key: "when", value: "right_away" }] });
  });
  it("an unknown kind is not understood; a key that is not a closed word is dropped from the lists; a bad field is left out; a bad `understood` is a contract error", () => {
    expect(parseDraft({ ...wire, kind: "rocket" }).understood).toBe(false);
    expect(parseDraft({ ...wire, unclear: ["language", "Bad Key!", 5] }).unclear).toEqual(["language"]);
    expect(parseDraft({ ...wire, fields: [{ key: "when", value: { x: 1 }, words: "" }, wire.fields[0]] }).fields).toEqual([{ key: "when", value: "right_away", words: "When: right away" }]); // a row that is not the contract's shape is left out (logged), the rest is kept
    expect(() => parseDraft({ ...wire, understood: "yes" })).toThrow();
  });
  it("not understood: no fields, the nearest templates (at most three) are kept", () => {
    const d = parseDraft({ understood: false, template_id: null, kind: null, goal: null, fields: [], unclear: [], nearest: ["a_b", "c_d", "e_f", "g_h"], unclear_words: null });
    expect(d).toMatchObject({ understood: false, kind: null, fields: [], nearest: ["a_b", "c_d", "e_f"] });
  });
  it("the question is checked before it is sent: 3 to 1000 characters, one of four languages", () => {
    expect(checkDescribeInput({ text: " hello there ", language: "te", source: "typed" })).toEqual({ text: "hello there", language: "te", source: "typed" });
    expect(() => checkDescribeInput({ text: "ab", language: "en", source: "typed" })).toThrow();
    expect(() => checkDescribeInput({ text: "x".repeat(1001), language: "en", source: "typed" })).toThrow();
    expect(() => checkDescribeInput({ text: "hello", language: "ta", source: "typed" })).toThrow();
    expect(() => checkDescribeInput({ text: "hello", language: "en", source: "paste" })).toThrow();
  });
});
