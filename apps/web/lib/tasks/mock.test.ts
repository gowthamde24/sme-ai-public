import { describe, expect, it } from "vitest";

import { answerMockTask, approveMock, deriveContacts, deriveReport, deriveTask, detectLanguage, indexOfContact, mockTemplates, MS_PER_CONTACT, moveMock, newMockTask, parseMockJar, parseMockTask, peopleOf, planSha, settle, templateOf } from "./mock";

const ID = "33333333-3333-4333-8333-333333333333";
const T0 = Date.UTC(2026, 9, 28, 5, 0, 0);

describe("the test mode finds the template by words in six languages", () => {
  it.each([
    ["Call my cement suppliers and ask the price per bag", "supplier_price_enquiry"],
    ["నా సరఫరాదారులను అడగండి, ధర ఎంత", "supplier_price_enquiry"],
    ["सप्लायर से भाव पूछो", "supplier_price_enquiry"],
    ["ಬೆಲೆ ಕೇಳಿ", "supplier_price_enquiry"],
    ["விலை கேளுங்கள்", "supplier_price_enquiry"],
    ["വില ചോദിക്കൂ", "supplier_price_enquiry"],
    ["Remind everyone with pending dues", "payment_reminder"],
    ["बकाया पेमेंट याद दिलाओ", "payment_reminder"],
    ["Confirm tomorrow's appointments", "confirm_appointments"],
    ["Ask for feedback from last week's customers", "collect_feedback"],
    ["Invite them to the festival offer", "offer_invite"],
    ["Call the old leads again", "reengage_old_leads"],
    ["Call the new leads from today", "call_new_leads"],
    ["కొత్త లీడ్స్ కి కాల్ చేయండి", "call_new_leads"],
    ["Do something nice", "custom"],
  ])("%s -> %s", (text, id) => {
    expect(templateOf(text)).toBe(id);
  });
  it("tells the language from the script", () => {
    expect([detectLanguage("hello"), detectLanguage("తెలుగు"), detectLanguage("हिन्दी"), detectLanguage("ಕನ್ನಡ"), detectLanguage("தமிழ்"), detectLanguage("മലയാളം")]).toEqual(["en", "te", "hi", "kn", "ta", "ml"]);
  });
  it("offers the seven templates, the payment reminder not for a school", () => {
    const t = mockTemplates().templates;
    expect(t).toHaveLength(7);
    expect(t.find((x) => x.id === "payment_reminder")?.needs_pack).toBe("not education");
    expect(t.find((x) => x.id === "offer_invite")?.promotional).toBe(true);
  });
});

describe("a task in the test mode is derived from a few facts", () => {
  const planned = newMockTask(ID, "Call my cement suppliers and ask the price per bag", null, T0);
  it("plans twelve people, an estimate of the system's own and a hash to approve", () => {
    const t = deriveTask(planned, T0);
    expect(t).toMatchObject({ status: "planned", template: "supplier_price_enquiry", language: "en", simulated: true, wording: "draft", spent_paise: 0, approved_at: null });
    expect(t.plan?.contacts_total).toBe(12);
    expect(t.plan?.contacts_sample).toHaveLength(5);
    expect(t.plan?.window).toEqual({ date: "2026-10-28", from_minute: 600, to_minute: 1140 });
    expect(t.estimate).toEqual({ contacts: 12, calls: 12, messages: 0, minutes: 24, cost_paise: 3000, basis: "fake rates" });
    expect(t.cap_paise).toBe(3600);
    expect(t.plan_sha256).toBe(planSha(planned));
    expect(t.plan_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(deriveTask(planned, T0 + 99_999)).toEqual(t);
  });
  it("changes the hash when somebody is left out", () => {
    expect(planSha({ ...planned, ex: [2] })).not.toBe(planSha(planned));
    const left = deriveTask({ ...planned, ex: [2, 3] }, T0);
    expect(left.progress).toMatchObject({ total: 12, excluded: 2, waiting: 10 });
    expect(left.estimate?.contacts).toBe(10);
  });
  it("finishes one person every two seconds after the approval, and is done after twelve", () => {
    const run = approveMock(planned, T0, null);
    expect(deriveTask(run, T0 + 500).status).toBe("approved");
    const mid = deriveTask(run, T0 + 3 * MS_PER_CONTACT + 100);
    expect(mid.status).toBe("running");
    expect(mid.progress.done + mid.progress.failed + mid.progress.skipped).toBe(3);
    expect(mid.progress.in_progress).toBe(1);
    expect(mid.spent_paise).toBe(3 * 250);
    expect(mid.approved_at).toBe(new Date(T0).toISOString());
    const done = deriveTask(run, T0 + 13 * MS_PER_CONTACT);
    expect(done.status).toBe("done");
    expect(done.progress.waiting + done.progress.in_progress).toBe(0);
    expect(done.finished_at).toBe(new Date(T0 + 12 * MS_PER_CONTACT).toISOString());
  });
  it("stops at the cap, stays paused when the cap is raised until Resume, then goes on", () => {
    const run = approveMock(planned, T0, 1000); // 4 calls of 250
    const t = T0 + 20 * MS_PER_CONTACT;
    expect(deriveTask(run, t)).toMatchObject({ status: "paused", pause_reason: "cap", spent_paise: 1000 });
    const stored = settle(run, t);
    expect(stored).toMatchObject({ st: "paused", pr: "cap", si: null });
    const raised = { ...stored, cap: 5000 };
    expect(deriveTask(raised, t + 60_000)).toMatchObject({ status: "paused", pause_reason: "cap" });
    const resumed = moveMock(raised, "resume", t + 60_000)!;
    const later = deriveTask(resumed, t + 60_000 + 3 * MS_PER_CONTACT);
    expect(later.status).toBe("running");
    expect(later.progress.done + later.progress.failed + later.progress.skipped).toBe(7);
  });
  it("pauses, resumes and cancels, and refuses a move that does not fit the state", () => {
    const run = approveMock(planned, T0, null);
    const paused = moveMock(run, "pause", T0 + 5 * MS_PER_CONTACT)!;
    expect(deriveTask(paused, T0 + 99 * MS_PER_CONTACT)).toMatchObject({ status: "paused", pause_reason: "owner" });
    expect(moveMock(paused, "pause", T0)).toBeNull();
    expect(moveMock(planned, "resume", T0)).toBeNull();
    const cancelled = moveMock(paused, "cancel", T0 + 6 * MS_PER_CONTACT)!;
    expect(deriveTask(cancelled, T0 + 99 * MS_PER_CONTACT).status).toBe("cancelled");
    expect(moveMock(cancelled, "cancel", T0)).toBeNull();
    expect(moveMock(run, "cancel", T0 + 40 * MS_PER_CONTACT)).toBeNull(); // already done
  });
});

describe("the one question and the 'nobody found' case", () => {
  const vague = newMockTask(ID, "Do something nice", "te", T0);
  it("asks ONE question in the task's language and has no plan yet", () => {
    const t = deriveTask(vague, T0);
    expect(t).toMatchObject({ status: "needs_answer", plan: null, estimate: null, plan_sha256: null, cap_paise: null });
    expect(t.question).toContain("విజయ");
    expect(deriveContacts(vague, T0)).toEqual([]);
    expect(deriveReport(vague, T0)).toBeNull();
  });
  it("plans again from the answer", () => {
    const t = deriveTask(answerMockTask(vague, "my suppliers, ask the price"), T0);
    expect(t).toMatchObject({ status: "planned", template: "supplier_price_enquiry" });
    expect(t.plan?.contacts_total).toBe(12);
  });
  it("stores a plan with nobody in it when the answer does not help", () => {
    const t = deriveTask(answerMockTask(vague, "just do it"), T0);
    expect(t).toMatchObject({ status: "planned", template: "custom" });
    expect(t.plan).toMatchObject({ contacts_total: 0, contacts_sample: [] });
    expect(t.plan?.notes[0]).toMatch(/Nobody/);
    expect(t.progress.total).toBe(0);
  });
});

describe("the report is a fixed table", () => {
  const run = approveMock(newMockTask(ID, "Call my cement suppliers and ask the price per bag", null, T0), T0, null);
  it("answers 'Cheapest' for a supplier price enquiry, with the lowest price among the people reached", () => {
    const r = deriveReport(run, T0 + 13 * MS_PER_CONTACT)!;
    expect(r.status).toBe("done");
    expect(r.rows).toHaveLength(12);
    expect(r.short_answer_kind).toBe("cheapest");
    const priced = r.rows.filter((x) => typeof x.captured?.price_per_bag === "number").sort((a, b) => Number(a.captured?.price_per_bag) - Number(b.captured?.price_per_bag));
    expect(priced.length).toBeGreaterThan(0);
    expect(r.short_answer).toMatch(new RegExp(`^Cheapest: ${priced[0].name} ₹\\d{3}/bag, delivery \\w+day$`));
    expect(r.totals.contacts).toBe(12);
    expect(r.totals.reached).toBe(r.totals.positive + r.totals.negative + r.totals.unclear);
    expect(r.totals.spent_paise).toBe(12 * 250);
    expect(r.rows.every((x) => x.simulated && x.recording_url === null)).toBe(true);
    expect(r.rows.some((x) => x.transcript && x.transcript.length > 2)).toBe(true);
    expect(deriveReport(run, T0 + 13 * MS_PER_CONTACT)).toEqual(r);
  });
  it("answers with counts for the other templates, in the task's language", () => {
    const other = approveMock(newMockTask(ID, "Remind everyone with pending dues", "hi", T0), T0, null);
    const r = deriveReport(other, T0 + 13 * MS_PER_CONTACT)!;
    expect(r.short_answer_kind).toBe("counts");
    expect(r.short_answer).toContain("12 में से");
    expect(deriveReport({ ...other, lang: "en" }, T0 + 13 * MS_PER_CONTACT)!.short_answer).toMatch(/^\d+ of 12 reached\./);
  });
  it("lists every person with a status that follows the progress", () => {
    const rows = deriveContacts(run, T0 + 3 * MS_PER_CONTACT + 10);
    expect(rows).toHaveLength(12);
    expect(rows.filter((x) => x.status === "in_progress")).toHaveLength(1);
    expect(rows.filter((x) => x.status === "waiting")).toHaveLength(8);
    expect(deriveContacts({ ...run, ex: [1] }, T0).find((x) => x.status === "excluded")?.contact_id).toBe(peopleOf(run)[1].contactId);
    expect(deriveContacts(run, T0 + 3 * MS_PER_CONTACT + 10, "waiting")).toHaveLength(8);
  });
  it("finds the person a contact id belongs to", () => {
    expect(indexOfContact(peopleOf(run)[4].contactId)).toBe(4);
    expect(indexOfContact("c0ffee00-0000-4000-8000-0000000000ff")).toBeNull();
    expect(indexOfContact("nope")).toBeNull();
  });
});

describe("what the cookie may hold", () => {
  const ok = newMockTask(ID, "Call my suppliers", null, T0);
  it("round-trips and refuses anything else", () => {
    expect(parseMockTask(JSON.parse(JSON.stringify(ok)))).toEqual(ok);
    expect(parseMockJar([ok])).toEqual([ok]);
    expect(parseMockJar("x")).toBeNull();
    expect(parseMockJar(Array.from({ length: 11 }, () => ok))).toBeNull();
    for (const bad of [{ ...ok, id: "x" }, { ...ok, lang: "fr" }, { ...ok, st: "flying" }, { ...ok, ex: [99] }, { ...ok, ex: "1" }, { ...ok, el: -1 }, { ...ok, ins: "x".repeat(201) }, { ...ok, cap: "5" }, { ...ok, pr: "weather" }, null, 5]) expect(parseMockTask(bad)).toBeNull();
  });
  it("stays well under the cookie limit for five tasks", () => {
    const five = Array.from({ length: 5 }, (_, i) => ({ ...newMockTask(ID.replace("3333", `33${i}${i}`), "x".repeat(200), "te", T0 + i), ex: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] }));
    expect(JSON.stringify(five).length).toBeLessThan(3500);
  });
});
