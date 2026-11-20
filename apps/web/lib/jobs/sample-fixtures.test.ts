import { describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ store: undefined as unknown }));
vi.mock("next/dist/server/app-render/work-unit-async-storage.external", () => ({ workUnitAsyncStorage: { getStore: () => h.store } }));

import { parseFestivals, parseNewJobSheet } from "@/lib/api/job-templates";
import { MOCK_PAGE_JOBS, mockPageJobs, mockToday } from "@/lib/jobs/mock";
import { mockJobDetail } from "@/lib/jobs/detail-mock";
import { mockPlan, mockSuggestions } from "@/lib/jobs/plan-mock";
import { wireSell, wireUnderstood } from "@/lib/sell/fixtures";
import { parseSellList } from "@/lib/api/what-you-sell";
import { popularOf, shown, textIn } from "@/lib/jobs/templates";
import { SAMPLE_TYPES, type SampleType } from "@/lib/screens/preview";

import { wireFestivals, wireNewJobSheet } from "./template-fixtures";
import { PERSONAS, localize, personaOf } from "./sample-fixtures";

/** Everything a person can read on the Jobs screens of one sample business, as one text. */
function everything(type: SampleType): string {
  const parts: unknown[] = [mockPageJobs(type), mockToday(type), mockSuggestions(null, type)];
  for (const j of MOCK_PAGE_JOBS) parts.push(mockJobDetail(j.id, 0, type));
  for (const input of [{ kind: "speed_to_lead" }, { kind: "followups" }, { kind: "store_visits" }, { kind: "offers" }, { text: "Call back yesterday's missed calls" }, { text: "Ask last month's silk saree buyers how they bought" }] as const) parts.push(mockPlan(input, type));
  parts.push(wireSell(PERSONAS[type].sell, type), wireUnderstood(PERSONAS[type].sell, "photos", type), wireFestivals(new Date("2026-11-20T00:00:00Z"), type));
  // the ids of the plans (plan-silk-call) are never shown
  return JSON.stringify(parts).replace(/"plan-silk-[a-z]+"/g, '"plan"');
}
const SAREE_WORDS = /saree|silk|Kanchi|Pochampally|Neelambari|Begum|Textiles|చీర|సిల్క్|साड़ी|सिल्क|ಸೀರೆ|ರೇಷ್ಮೆ/i;

describe("the sample businesses of the staging picker", () => {
  it("the closed list is the four of the owner's request, and the saree shop is the demo the mock always was", () => {
    expect(SAMPLE_TYPES).toEqual(["saree", "realestate", "school", "cars"]);
    expect(Object.values(PERSONAS).map((p) => p.business)).toEqual(["Neelambari Silks", "Sri Sai Homes", "Vidya Bharathi School", "Sai Auto Motors"]);
    expect(personaOf(null)).toBe(PERSONAS.saree);
    expect(localize({ a: "Priya" }, PERSONAS.saree)).toEqual({ a: "Priya" });
    expect(mockPageJobs(null)).toBe(MOCK_PAGE_JOBS);
    expect(mockPageJobs("saree")).toBe(MOCK_PAGE_JOBS);
  });
  it.each(["realestate", "school", "cars"] as const)("%s: its own name, assistant and job names everywhere, and not one saree word left", (type) => {
    const p = PERSONAS[type];
    const text = everything(type);
    expect(text).toContain(p.business);
    expect(text).toContain(p.jobNames.visits);
    expect(text).toContain(p.jobNames.a);
    expect(text).toContain(p.jobNames.b);
    expect(mockToday(type).assistantName).toBe(p.assistant);
    expect(text).not.toMatch(SAREE_WORDS);
    expect(text).not.toContain("Neelambari");
  });
  it("the jobs list keeps the same eight jobs and ids for every business, only the names change", () => {
    const names = (t: SampleType) => mockPageJobs(t).map((j) => j.customName);
    expect(mockPageJobs("cars").map((j) => j.id)).toEqual(MOCK_PAGE_JOBS.map((j) => j.id));
    expect(names("saree")).toEqual([null, null, null, null, "Priya", null, "Ravi", "Diwali calls"]);
    expect(names("realestate")).toEqual([null, null, null, null, "Kiran", null, "Suresh", "New flat calls"]);
    expect(names("school")).toEqual([null, null, null, null, "Anitha", null, "Rajesh", "Admission calls"]);
    expect(names("cars")).toEqual([null, null, null, null, "Rohit", null, "Vamsi", "Diwali calls"]);
  });
  it("a customer called Ravi Kumar is not renamed with the job called Ravi", () => {
    expect(JSON.stringify(mockJobDetail(MOCK_PAGE_JOBS[0].id, 0, "cars"))).toContain("Ravi Kumar");
  });
  it.each(SAMPLE_TYPES)("%s: the New job sheet reads that business type's real jobs.json, with its own sample item, and shows no price and no 'free' in a customer message", (type) => {
    const p = PERSONAS[type];
    const sheet = parseNewJobSheet(wireNewJobSheet(undefined, type));
    expect(sheet.businessType.pack).toBe(p.pack);
    expect(textIn(sheet.businessType.name, "en")).toBe(p.name.en);
    expect(sheet.sampleItem?.en).toBe(p.item.en);
    expect(popularOf(sheet.own).length).toBeGreaterThanOrEqual(3);
    expect(sheet.others.some((o) => o.pack === p.pack)).toBe(false);
    for (const t of shown(sheet.own)) for (const msg of [t.whatsapp?.en, t.call?.en]) if (msg) expect(msg, t.id).not.toMatch(/₹|\bRs\.?\b|\bfree\b|\bdiscount\b/i);
  });
  it("the default sheet is exactly what it was (the saree shop, its own pack textiles, four other ideas); a sample business also lists the school and the car showroom", () => {
    const sheet = parseNewJobSheet(wireNewJobSheet());
    expect(sheet.businessType.pack).toBe("textiles");
    expect(sheet.others.map((o) => o.pack)).toEqual(["clinic", "coaching", "real_estate", "wholesale_b2b"]);
    expect(parseNewJobSheet(wireNewJobSheet(undefined, "saree")).others.map((o) => o.pack)).toEqual(["clinic", "coaching", "real_estate", "wholesale_b2b", "education", "auto_dealer"]);
    expect(parseNewJobSheet(wireNewJobSheet(undefined, "cars")).others.map((o) => o.pack)).toEqual(["textiles", "clinic", "coaching", "real_estate", "wholesale_b2b", "education"]);
  });
  it("the festival hint is the business's own (a school has the new academic year)", () => {
    expect(parseFestivals(wireFestivals(new Date("2026-11-20T00:00:00Z"), "school"))[0]).toMatchObject({ season: "new_year", name: { en: "New academic year" } });
    expect(parseFestivals(wireFestivals(new Date("2026-11-20T00:00:00Z"), "cars"))[0]).toMatchObject({ season: "diwali" });
    expect(parseFestivals(wireFestivals(new Date("2026-11-20T00:00:00Z")))[0].name.en).toBe("Diwali");
  });
  it("What you sell: the sample items of the business (cars, 2BHK, Class 10 admission) through the real parsers", () => {
    const names = (style: Parameters<typeof wireSell>[0], type: SampleType) => parseSellList(wireSell(style, type), style).map((e) => e.name);
    expect(names("products", "cars")).toEqual(["Compact SUV", "Family sedan", "City hatchback", "7-seat family car"]);
    expect(names("properties", "realestate")[0]).toBe("2BHK in Kondapur");
    expect(names("courses", "school")[0]).toBe("Class 10 admission");
    expect(names("products", "saree")[0]).toBe("Kanjivaram silk saree");
    expect(PERSONAS.cars.sell).toBe("products");
    expect(PERSONAS.realestate.sell).toBe("properties");
    expect(PERSONAS.school.sell).toBe("courses");
  });
  it("the suggested jobs: the saree shop its four, every other business the plain three with its own words", () => {
    expect(mockSuggestions(null, "saree").items).toHaveLength(4);
    expect(mockSuggestions(null, "cars").items).toHaveLength(3);
  });
  it("every plan card of a sample business is a plan the real parser accepts and 'use this' on a template card answers one", () => {
    const sheet = parseNewJobSheet(wireNewJobSheet(undefined, "cars"));
    const answered = shown(sheet.own).filter((t) => t.kind !== "researcher").map((t) => mockPlan({ templateId: t.id, ask: t.ask.en }, "cars"));
    expect(answered.filter((p) => p.blockers.length === 0).length).toBeGreaterThanOrEqual(3);
    for (const p of answered) for (const s of p.says) expect(s.text).not.toMatch(/₹|\bfree\b/i);
  });
});
