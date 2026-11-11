import { describe, expect, it } from "vitest";

import { appDict } from "@/i18n/app";
import { parseAvailability } from "@/lib/api/lead-finder";
import { withModuleWords } from "@/lib/packs/module-words";

import { audienceModules, audienceOf, isChatCardWord, politeSentence } from "./types";

/**
 * A school's Lead Finder finds ORGANISATIONS (C1, 5 Nov: availability `audience: "organisations"`): apartment associations, companies, coaching centres and vendors near the school. Every Lead Finder word a school can see is
 * rendered here with the organisation variants on top, and none may talk about parents, families, retailers, shops, stock or buying. The parts a school never sees (the draft quote, the stock sentence, the call's quote
 * suggestion: ProspectList `businesses={false}`) are left out on purpose.
 */
const HIDDEN_FOR_ORGANISATIONS = /^lf\.(qd\.|pc\.quote|pc\.price\.none$|pc\.moq$|pc\.said$|instock$)/;
const ALSO = ["nav.item.retailers", "agent.lead_finder", "today.kind.prospect", "today.kind.prospect.row", "today.step.prospect", "today.step.prospect.row", "today.prospect.more", "today.prospect.more.sum", "today.upsell.title", "today.upsell.sum", "tier.inc.finder", "tier.inc.finder.off", "lf.err.individuals"];
const visible = (dict: Record<string, string>) => Object.keys(dict).filter((k) => !k.includes("@") && (((k.startsWith("lf.") && !HIDDEN_FOR_ORGANISATIONS.test(k)) || k.startsWith("tier.upsell.")) || ALSO.includes(k)));
const schoolWords = (lang: "en" | "te") => {
  const dict = appDict(lang) as Record<string, string>;
  const words = withModuleWords({ ...dict }, audienceModules("organisations"));
  return Object.fromEntries(visible(dict).map((k) => [k, words[k]]));
};

describe("the Lead Finder for a school: organisations only", () => {
  it("reads the API's audience; absent or unknown is businesses, except the school fallback (a pack with `programmes`)", () => {
    expect(parseAvailability({ available: true, source: "fixture", reason: "ok", audience: "organisations" }).audience).toBe("organisations");
    expect(parseAvailability({ available: true, source: "fixture", reason: "ok", audience: "businesses" }).audience).toBe("businesses");
    const none = parseAvailability({ available: true, source: "fixture", reason: "ok" });
    const odd = parseAvailability({ available: true, source: "fixture", reason: "ok", audience: "families" });
    expect(none).toEqual({ available: true, source: "fixture", reason: "ok" });
    expect(odd.audience).toBeUndefined();
    expect(audienceOf(none, ["today", "contacts"])).toBe("businesses");
    expect(audienceOf(odd, null)).toBe("businesses");
    expect(audienceOf(none, ["today", "programmes", "fees"])).toBe("organisations");
    expect(audienceOf({ audience: "businesses" }, ["programmes"])).toBe("businesses"); // the API's word wins
    expect(audienceOf(null, ["programmes"])).toBe("organisations");
  });
  it("every word a school can see says organisations: no parents, families, retailers, shops, stock or buying (English)", () => {
    const en = schoolWords("en");
    expect(Object.keys(en).length).toBeGreaterThan(100);
    const bad = Object.entries(en).filter(([, v]) => /parent|famil|retailer|shop|stock|\bbuy/i.test(v));
    expect(bad).toEqual([]);
    expect(en["nav.item.retailers"]).toBe("Find organisations");
    expect(en["lf.find.label"]).toBe("Find organisations near your school in …");
    expect(en["lf.sub"]).toMatch(/^Apartment associations, companies, coaching centres and vendors near your school/);
    expect(en["tier.upsell.title"]).toBe("Finding organisations near the school is part of AI Workforce");
  });
  it("Telugu has its own words for each of them (none is the English left as it is)", () => {
    const en = schoolWords("en");
    const te = schoolWords("te");
    const same = Object.keys(en).filter((k) => te[k] === en[k] || !/[ఀ-౿]/.test(te[k]));
    expect(same).toEqual([]);
    expect(te["nav.item.retailers"]).toBe("సంస్థలను వెతకండి");
    // the organisation variant really replaced the business words in Telugu too
    expect(te["lf.find.label"]).not.toBe((appDict("te") as Record<string, string>)["lf.find.label"]);
  });
  it("a business keeps its own words (no organisation word leaks)", () => {
    const dict = appDict("en") as Record<string, string>;
    expect(withModuleWords({ ...dict }, audienceModules("businesses"))["lf.find.label"]).toBe("Find new retailers in …");
  });
  it("the chat card's words carry their organisation variants", () => {
    expect(isChatCardWord("lf.chat.card@organisations")).toBe(true);
    expect(isChatCardWord("lf.plan.max.n@organisations")).toBe(true);
    expect(isChatCardWord("lf.qd.make@organisations")).toBe(false);
  });
});

describe("the API's polite sentence (individuals_not_allowed, C1 #319): shown as it is; ours only when it gave none", () => {
  it.each([
    ["The Lead Finder looks for organisations only.", "The Lead Finder looks for organisations only."],
    ["లీడ్ ఫైండర్ సంస్థలను మాత్రమే వెతుకుతుంది.", "లీడ్ ఫైండర్ సంస్థలను మాత్రమే వెతుకుతుంది."],
    ["  ", null],
    ["", null],
    [undefined, null],
    ["x".repeat(401), null],
  ])("%j -> %j", (text, out) => {
    expect(politeSentence(text)).toBe(out);
  });
});
