import { describe, expect, it } from "vitest";

import { CHECK_CODES, FIX_CODES, LIMITS, applyFix, canSend, fillName, fixAll, fromEditable, nameParts, runChecks, toEditable, warnings, type CheckCode, type Draft, type Message } from "./meta-checks";

const draft = (body: string, extra: Partial<Draft> = {}): Draft => ({ header: null, body, footer: null, buttons: [], ...extra });
/** A message that passes every check. */
const GOOD: Message = {
  category: "utility",
  drafts: { te: draft("నమస్కారం {name} గారు, మీ blouse రెడీ అయింది. రేపు వచ్చి తీసుకోండి."), en: draft("Hello {name}, your blouse is ready for pickup. Please collect it tomorrow.") },
};
const withEn = (m: Message, en: Partial<Draft>, category = m.category): Message => ({ category, drafts: { te: m.drafts.te, en: { ...m.drafts.en, ...en } } });
const withBoth = (m: Message, f: (d: Draft) => Partial<Draft>, category = m.category): Message => ({ category, drafts: { te: { ...m.drafts.te, ...f(m.drafts.te) }, en: { ...m.drafts.en, ...f(m.drafts.en) } } });
const byCode = (m: Message, code: CheckCode) => runChecks(m).find((r) => r.code === code)!;

describe("runChecks", () => {
  it("returns exactly one result for each closed code, in a fixed order", () => {
    expect(runChecks(GOOD).map((r) => r.code)).toEqual([...CHECK_CODES]);
  });
  it("a good message is all ok and can be sent", () => {
    expect(warnings(runChecks(GOOD))).toEqual([]);
    expect(canSend(GOOD)).toBe(true);
  });
  it("every result carries the key of its plain sentence and no braces", () => {
    for (const m of [GOOD, withEn(GOOD, { body: "READY now {name}" })]) for (const r of runChecks(m)) expect(r.key).toMatch(/^jobs\.tb\.check\.[a-z_]+\.(ok|warn)(_[a-z_]+)?$/);
  });

  it("category: a promotion written as an order update warns, and one tap makes it a promotion", () => {
    const m = withEn(GOOD, { body: "Hello {name}, our new collection has arrived at the shop. Come and see it." });
    const r = byCode(m, "category");
    expect(r).toMatchObject({ status: "warn", fix: "to_marketing", langs: ["en"] });
    expect(applyFix(m, "to_marketing").category).toBe("marketing");
    expect(byCode(GOOD, "category")).toMatchObject({ status: "ok", key: "jobs.tb.check.category.ok_utility" });
    expect(byCode({ ...GOOD, category: "marketing" }, "category").key).toBe("jobs.tb.check.category.ok_marketing");
  });

  it("price promise: a price, a percentage or an offer word in an order update warns with the word; the fix takes it out", () => {
    for (const [text, word] of [["Hello {name}, your order is ready, with a discount of today.", "discount"], ["Hello {name}, pay only ₹500 and collect it.", "₹500"], ["Hello {name}, 20% off for you, collect it.", "20% off"]] as const) {
      const m = withEn(GOOD, { body: text });
      const r = byCode(m, "price_promise");
      expect(r, text).toMatchObject({ status: "warn", fix: "remove_price_words", params: { word } });
      const fixed = applyFix(m, "remove_price_words");
      expect(byCode(fixed, "price_promise").status).toBe("ok");
      expect(fixed.drafts.en.body).not.toContain(word);
    }
    // the Telugu word counts too
    expect(byCode({ ...GOOD, drafts: { ...GOOD.drafts, te: draft("నమస్కారం {name} గారు, మీకు డిస్కౌంట్ ఉంది") } }, "price_promise")).toMatchObject({ status: "warn", langs: ["te"] });
    // a promotion may talk about offers and prices
    expect(byCode({ ...withEn(GOOD, { body: "Hello {name}, 20% off today." }), category: "marketing" }, "price_promise")).toMatchObject({ status: "ok", key: "jobs.tb.check.price_promise.ok_marketing" });
  });

  it("capitals: a shouted word warns and is put to lower case, a sentence start keeps its capital, STOP and UPI are left alone", () => {
    const m = withEn(GOOD, { body: "READY for you {name}. Pay by UPI. Reply STOP to stop." });
    expect(byCode(m, "capitals")).toMatchObject({ status: "warn", fix: "lowercase_caps", params: { word: "READY", to: "ready" } });
    const fixed = applyFix(m, "lowercase_caps");
    expect(fixed.drafts.en.body).toBe("Ready for you {name}. Pay by UPI. Reply STOP to stop.");
    expect(byCode(fixed, "capitals").status).toBe("ok");
    expect(applyFix(withEn(GOOD, { body: "Hello {name}, your blouse is READY today." }), "lowercase_caps").drafts.en.body).toBe("Hello {name}, your blouse is ready today.");
    expect(byCode(withEn(GOOD, { body: "Hello {name}, pay by UPI. Reply STOP to opt out." }), "capitals").status).toBe("ok");
  });

  it("name edge: a name first or last warns; the fixes add a greeting or a closing word, in each language", () => {
    const first = withBoth(GOOD, (d) => ({ body: `{name}${d.body.slice(d.body.indexOf(" "))}` }));
    const r = byCode(first, "name_edge");
    expect(r).toMatchObject({ status: "warn", key: "jobs.tb.check.name_edge.warn_start", fix: "greet_first" });
    expect(r.langs).toEqual(["te", "en"]);
    const fixed = applyFix(first, "greet_first");
    expect(fixed.drafts.en.body.startsWith("Hello {name}")).toBe(true);
    expect(fixed.drafts.te.body.startsWith("నమస్కారం {name}")).toBe(true);
    expect(byCode(fixed, "name_edge").status).toBe("ok");

    const last = withEn(GOOD, { body: "Your blouse is ready for pickup, {name}" });
    expect(byCode(last, "name_edge")).toMatchObject({ status: "warn", key: "jobs.tb.check.name_edge.warn_end", fix: "close_last" });
    const closed = applyFix(last, "close_last");
    expect(closed.drafts.en.body).toBe("Your blouse is ready for pickup, {name}. Thank you.");
    expect(byCode(closed, "name_edge").status).toBe("ok");
  });

  it("length: header, message and footer limits warn with the numbers, and have no one-tap fix", () => {
    const body = withEn(GOOD, { body: "Hello {name}, " + "a".repeat(LIMITS.body) });
    expect(byCode(body, "length")).toMatchObject({ status: "warn", fix: null, params: { part: "body", max: LIMITS.body } });
    expect(byCode(withEn(GOOD, { header: "h".repeat(LIMITS.header + 1) }), "length").params).toMatchObject({ part: "header", n: LIMITS.header + 1 });
    expect(byCode(withEn(GOOD, { footer: "f".repeat(LIMITS.footer + 1) }), "length").params).toMatchObject({ part: "footer" });
    expect(byCode(withEn(GOOD, { body: "a".repeat(LIMITS.body).replace(/^./, "H") + " {name} x" }), "length").status).toBe("warn");
    expect(byCode(withEn(GOOD, { header: "h".repeat(LIMITS.header) }), "length").status).toBe("ok");
    expect(canSend(body)).toBe(false);
  });

  it("emoji: more than three, or three the same in a row, warns; the fix keeps the first two", () => {
    const m = withEn(GOOD, { body: "Hello {name} 🎉🎉🎉🎉 your blouse is ready 🙏" });
    expect(byCode(m, "emoji")).toMatchObject({ status: "warn", fix: "trim_emoji", params: { max: LIMITS.emoji } });
    const fixed = applyFix(m, "trim_emoji");
    expect(fixed.drafts.en.body).toBe("Hello {name} 🎉🎉 your blouse is ready");
    expect(byCode(fixed, "emoji").status).toBe("ok");
    expect(byCode(withEn(GOOD, { body: "Hello {name} 🎉🎉🎉 ok" }), "emoji").status).toBe("warn");
    expect(byCode(withEn(GOOD, { body: "Hello {name} 🎉 your blouse is ready 🙏" }), "emoji").status).toBe("ok");
  });

  it("emoji: the check counts every field (header, body, footer, buttons), so the fix trims to three IN ALL, earliest field first, and one fix is enough", () => {
    const m = withEn(GOOD, { header: "Sale 🎉🎊", body: "Hello {name} 🙏✨ your blouse is ready", footer: "🎁", buttons: ["OK 👍"] });
    expect(byCode(m, "emoji")).toMatchObject({ status: "warn", fix: "trim_emoji", params: { n: 6, max: LIMITS.emoji }, langs: ["en"] });
    const fixed = applyFix(m, "trim_emoji");
    expect(fixed.drafts.en).toEqual({ header: "Sale 🎉🎊", body: "Hello {name} 🙏 your blouse is ready", footer: null, buttons: ["OK"] });
    expect(byCode(fixed, "emoji").status).toBe("ok");
    // two in the header and two in the body: four warns, and the fix used to leave each field as it was
    const four = withEn(GOOD, { header: "Hi 🎉🎊", body: "Hello {name} 🙏✨ ready" });
    expect(byCode(four, "emoji").status).toBe("warn");
    expect(byCode(applyFix(four, "trim_emoji"), "emoji").status).toBe("ok");
    expect(applyFix(four, "trim_emoji").drafts.en.header).toBe("Hi 🎉🎊");
    expect(applyFix(four, "trim_emoji").drafts.en.body).toBe("Hello {name} 🙏 ready");
    expect(byCode(fixAll(four), "emoji").status).toBe("ok");
    // three the same in a row is only two after the fix
    expect(applyFix(withEn(GOOD, { body: "Hello {name} 🎉🎉🎉 ok" }), "trim_emoji").drafts.en.body).toBe("Hello {name} 🎉🎉 ok");
  });

  it("opt-out: only the real STOP reply line counts; 'bus stop' and 'stop by' do not", () => {
    const promo: Message = { ...GOOD, category: "marketing" };
    for (const text of ["Hello {name}, new sarees near the bus stop.", "Hello {name}, stop by the shop today.", "Hello {name}. Do not STOP by late.", "STOP the bus"]) {
      expect(byCode(withEn(promo, { footer: text }), "opt_out").langs, text).toEqual(["te", "en"]);
    }
    for (const line of ["Reply STOP if you do not want these messages.", "Reply STOP to opt out", "reply STOP to unsubscribe", "Send STOP to stop", "Neelambari Silks · Reply STOP to opt out"]) {
      expect(byCode(withEn(promo, { footer: line }), "opt_out").langs, line).toEqual(["te"]);
    }
    expect(byCode(withBoth(promo, () => ({ footer: "ఈ మెసేజ్‌లు వద్దంటే STOP అని రిప్లై ఇవ్వండి." })), "opt_out").status).toBe("ok");
    // the fix line is the real one, and a promotion with only a lower-case "stop" gets it
    const bus = withBoth(promo, () => ({ footer: "Near the bus stop" }));
    expect(byCode(bus, "opt_out").status).toBe("warn");
    expect(byCode(fixAll(bus), "opt_out").status).toBe("ok");
    expect(fixAll(bus).drafts.en.footer).toBe("Near the bus stop · Reply STOP to opt out");
  });

  it("opt-out: a promotion needs a STOP line (footer, message or button), an order update does not; the fix adds the footer line", () => {
    const promo: Message = { ...GOOD, category: "marketing" };
    expect(byCode(promo, "opt_out")).toMatchObject({ status: "warn", fix: "add_opt_out" });
    const fixed = applyFix(promo, "add_opt_out");
    expect(fixed.drafts.en.footer).toBe("Reply STOP to opt out");
    expect(fixed.drafts.te.footer).toContain("STOP");
    expect(byCode(fixed, "opt_out").status).toBe("ok");
    expect(byCode(withEn(promo, { body: "Hello {name}, new sarees. Reply STOP to stop." }), "opt_out").langs).toEqual(["te"]);
    expect(byCode(withEn(promo, { footer: "Reply STOP to unsubscribe" }), "opt_out").langs).toEqual(["te"]);
    expect(byCode(GOOD, "opt_out")).toMatchObject({ status: "ok", key: "jobs.tb.check.opt_out.ok_not_needed" });
    // an existing footer is kept
    expect(applyFix(withEn(promo, { footer: "Neelambari Silks" }), "add_opt_out").drafts.en.footer).toBe("Neelambari Silks · Reply STOP to opt out");
  });

  it("buttons: a button over 25 letters, or more than three, warns with no fix", () => {
    const long = withEn(GOOD, { buttons: ["a".repeat(LIMITS.button + 1)] });
    expect(byCode(long, "buttons")).toMatchObject({ status: "warn", fix: null, key: "jobs.tb.check.buttons.warn_long" });
    const many = withEn(GOOD, { buttons: ["a", "b", "c", "d"] });
    expect(byCode(many, "buttons")).toMatchObject({ status: "warn", key: "jobs.tb.check.buttons.warn_many", params: { n: 4, max: 3 } });
    expect(byCode(withEn(GOOD, { buttons: ["I will come today", "Call the shop"] }), "buttons").status).toBe("ok");
  });

  it("the same in both: an empty draft, or a different number of names, warns", () => {
    expect(byCode(withEn(GOOD, { body: "  " }), "same_in_both")).toMatchObject({ status: "warn", key: "jobs.tb.check.same_in_both.warn_empty", params: { lang: "en" } });
    expect(byCode(withEn(GOOD, { body: "Hello, your blouse is ready for pickup." }), "same_in_both")).toMatchObject({ status: "warn", key: "jobs.tb.check.same_in_both.warn_name", fix: null });
    expect(byCode(GOOD, "same_in_both").status).toBe("ok");
  });

  it("every check code can be ok and can warn, and every fix code is the fix of some warning", () => {
    const bad: Message = {
      category: "utility",
      drafts: { te: draft("ఆఫర్ ఉంది", { buttons: ["a", "b", "c", "d"] }), en: draft("{name} READY, new collection, 50% off 🎉🎉🎉🎉", { footer: "f".repeat(70) }) },
    };
    const warned = new Set(runChecks(bad).filter((r) => r.status === "warn").map((r) => r.code));
    expect([...warned].sort()).toEqual([...CHECK_CODES].filter((c) => c !== "opt_out").sort());
    const fixes = new Set(runChecks({ ...bad, category: "marketing" }).concat(runChecks(bad), runChecks(withEn(GOOD, { body: "Bye {name}" }))).map((r) => r.fix).filter(Boolean));
    expect([...fixes].sort()).toEqual([...FIX_CODES].sort());
    expect(runChecks(GOOD).every((r) => r.status === "ok")).toBe(true);
  });
});

describe("fixAll", () => {
  it("fixes every fixable warning, also the ones a fix brings up, and leaves a message the checks accept", () => {
    const bad: Message = {
      category: "utility",
      drafts: { te: draft("{name} గారు, మీ blouse రెడీ"), en: draft("{name}, your blouse is READY, our new collection has 20% off 🎉🎉🎉🎉") },
    };
    const fixed = fixAll(bad);
    expect(warnings(runChecks(fixed))).toEqual([]);
    expect(fixed.drafts.en.body.startsWith("Hello {name}")).toBe(true);
  });
  it("leaves what only the owner can change (too long) alone and does not loop", () => {
    const long = withEn(GOOD, { body: "Hello {name}, " + "a".repeat(LIMITS.body) });
    expect(fixAll(long)).toEqual(long);
  });
  it("a fix applied twice changes nothing more", () => {
    const m = withEn(GOOD, { body: "READY {name}" });
    const once = applyFix(m, "lowercase_caps");
    expect(applyFix(once, "lowercase_caps")).toEqual(once);
  });
});

describe("the name chip", () => {
  it("splits the text at every name; the braces are never in a text part", () => {
    const parts = nameParts("Hello {name}, your blouse is ready, {name}.");
    expect(parts).toEqual([{ kind: "text", text: "Hello " }, { kind: "name" }, { kind: "text", text: ", your blouse is ready, " }, { kind: "name" }, { kind: "text", text: "." }]);
    expect(parts.every((p) => p.kind === "name" || !/[{}]/.test(p.text))).toBe(true);
    expect(nameParts("no name")).toEqual([{ kind: "text", text: "no name" }]);
    expect(nameParts("{name}")).toEqual([{ kind: "name" }]);
  });
  it("the preview puts a first name in", () => {
    expect(fillName("Hello {name}, hi {name}", "Lakshmi")).toBe("Hello Lakshmi, hi Lakshmi");
  });
  it("the edit box shows [Name], reads it back, and drops any other braces the person typed", () => {
    expect(toEditable("Hello {name}!")).toBe("Hello [Name]!");
    expect(fromEditable("Hello [Name]! and [name] {x} {{1}}")).toBe("Hello {name}! and {name} x 1");
    expect(fromEditable(toEditable("a {name} b"))).toBe("a {name} b");
  });
});
