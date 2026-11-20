import { parsePlan, parseSuggestionHeading, parseSuggestions } from "@/lib/api/jobs-parse";
import { previewSample, type SampleType } from "@/lib/screens/preview";

import { MOCK_APPROVAL, MOCK_CUSTOM_JOB, WIRE_PLANS, WIRE_SUGGESTIONS_GENERIC, WIRE_SUGGESTIONS_TEXTILES } from "./fixtures";
import { MOCK_JOBS } from "./mock";
import { localize, personaOf } from "./sample-fixtures";
import type { JobPlan, JobStarted, JobTested, PlanInput, SearchPatch, Suggestion, SuggestionList } from "./plan";
import type { JobKind } from "./types";

/**
 * JOBS=mock: the made-up planner and suggestions of the demo shop (Neelambari Silks), the ones in mocks/jobs sheets 02 and 03. Nothing is called, sent or stored. Every number here is a placeholder from the mock (the real ones are the API's); the plans are the contract's
 * wire shape (lib/jobs/fixtures.ts) read by the REAL parser. The planner reads only the two examples of the mock (silk-saree buyers, yesterday's missed calls); anything else is "could not tell who you mean".
 */
/** The made-up plans of one business: the saree shop's own fixtures, or another sample business's words swapped in (lib/jobs/sample-fixtures.ts), parsed once per business. */
type Plans = { all: Record<keyof typeof WIRE_PLANS, JobPlan>; byKind: Partial<Record<JobKind, JobPlan>> };
const MADE = new Map<string, Plans>();
function plansOf(type: SampleType | null): Plans {
  const key = type ?? "saree";
  const made = MADE.get(key);
  if (made) return made;
  const p = personaOf(type);
  const all = Object.fromEntries(Object.entries(WIRE_PLANS).map(([k, w]) => [k, parsePlan(localize(w, p))])) as Record<keyof typeof WIRE_PLANS, JobPlan>;
  const plans: Plans = { all, byKind: { speed_to_lead: all.speed_to_lead, followups: all.followups, store_visits: all.store_visits, offers: all.offers } };
  MADE.set(key, plans);
  return plans;
}
const PLANS = plansOf(null).all;
const SILK_WHATSAPP = PLANS.silk_whatsapp;
const BY_KIND = plansOf(null).byKind;

/**
 * The sentence of a job TEMPLATE card ("Use this" asks for the plan of the card's own sentence, exactly as if it had been typed): the mock planner knows the five kinds by the words their sentences use (English and Telugu), and answers with that kind's plan.
 * The Lead Finder and custom ideas have no made-up plan, so they are "could not tell who you mean". Mock only: the real planner reads the sentence itself.
 */
function byTemplateAsk(said: string, plans: Plans): JobPlan | null {
  if (/(festival|diwali|wedding|new collection|new batch|listing|stock|price list|arrival|admissions open|దీపావళి|పండుగ|పెళ్లిళ్ల|కలెక్షన్)/.test(said)) return plans.byKind.offers ?? null;
  if (/(visit|appointment|book |test drive|demo class|site |విజిట్|అపాయింట్)/.test(said)) return plans.byKind.store_visits ?? null;
  if (/(follow up|follow-up|remind|quiet|went quiet|reorder|ఫాలో|గుర్తు)/.test(said)) return plans.byKind.followups ?? null;
  if (/(answer .*calls|cannot pick up|can't pick up|ఎత్త)/.test(said)) return plans.all.missed;
  if (/(new .*enquir|right away|వెంటనే|ఎంక్వైరీ)/.test(said)) return plans.byKind.speed_to_lead ?? null;
  return null;
}

/** What the mock planner answers: the two examples of the mocks (and the WhatsApp version of the first, by its plan id), the four suggested jobs by kind, and for anything else the "could not tell who you mean" plan (no Start). */
export function mockPlan(input: PlanInput, type: SampleType | null = previewSample()): JobPlan {
  const plans = plansOf(type);
  const { missed: MISSED, unclear: UNCLEAR, silk_call: SILK, silk_whatsapp: SILK_WA } = plans.all;
  if ("kind" in input) return plans.byKind[input.kind] ?? UNCLEAR;
  if ("as" in input) return input.planId === SILK.planId ? SILK_WA : UNCLEAR;
  const said = ("templateId" in input ? input.ask : input.text).toLowerCase(); // a template card is planned from its own sentence, exactly as if it had been typed
  if (/(missed|మిస్డ్|मिस्ड|ಮಿಸ್ಡ್)/.test(said)) return MISSED;
  if (/(silk|saree|sari|సిల్క్|చీర|सिल्क|साड़ी|ಸಿಲ್ಕ್|ಸೀರೆ)/.test(said) && /(bought|buyers|purchase|purchased|buy|కొన్న|खरीद|ಕೊಂಡ)/.test(said)) return SILK;
  return byTemplateAsk(said, plans) ?? UNCLEAR;
}

/** The saree shop's four (mock sheet 03), and the plain three for every other business type. */
export const MOCK_SUGGESTIONS_TEXTILES: readonly Suggestion[] = parseSuggestions(WIRE_SUGGESTIONS_TEXTILES);
export const MOCK_SUGGESTIONS_GENERIC: readonly Suggestion[] = parseSuggestions(WIRE_SUGGESTIONS_GENERIC);
/**
 * A saree and fabric shop, told by what its business type switches on (no business type is named in code): the product catalogue and quotes, and not the by-area, by-weight materials of a building-materials shop.
 * Mock only: the real API chooses the suggestions (and the heading) by the business itself.
 */
export const sellsSarees = (modules: readonly string[] | null): boolean => modules !== null && modules.includes("catalogue") && modules.includes("quotes") && !modules.includes("materials");
export const mockSuggestions = (modules: readonly string[] | null, type: SampleType | null = previewSample()): SuggestionList => {
  // a SAMPLE business (the staging picker) is told by its own word, not by modules: the saree shop gets its four, the others the plain three with their own names
  if (type !== null && type !== "saree") return { items: parseSuggestions(localize(WIRE_SUGGESTIONS_GENERIC, personaOf(type))), heading: parseSuggestionHeading(WIRE_SUGGESTIONS_GENERIC) };
  return type === "saree" || sellsSarees(modules) ? { items: [...MOCK_SUGGESTIONS_TEXTILES], heading: parseSuggestionHeading(WIRE_SUGGESTIONS_TEXTILES) } : { items: [...MOCK_SUGGESTIONS_GENERIC], heading: parseSuggestionHeading(WIRE_SUGGESTIONS_GENERIC) };
};

/**
 * Starting in the mock: an existing made-up job of the same kind (or one made-up job for a typed plan); nothing starts. The festival offer goes only after the Owner's OK, so starting it answers
 * `409 approval_needed` as the API does: the person is told it waits for their OK.
 */
export function mockStartedFor(kind: JobKind | null): JobStarted {
  if (kind === "offers") return { approval: { ...MOCK_APPROVAL } };
  return { jobId: kind ? (MOCK_JOBS.find((j) => j.kind === kind)?.id ?? MOCK_CUSTOM_JOB) : MOCK_CUSTOM_JOB };
}
export const mockStartPlan = (planId: string): JobStarted => {
  const kind = (Object.entries(BY_KIND) as [JobKind, JobPlan][]).find(([, p]) => p.planId === planId)?.[0] ?? null;
  return mockStartedFor(kind);
};
/** The test button in the mock: nothing is called or sent, so no free minutes are used. */
export const mockTest = (planId: string): JobTested => {
  const whatsapp = [SILK_WHATSAPP, ...Object.values(BY_KIND)].some((p) => p.planId === planId && p.says[0]?.channel === "whatsapp");
  return { channel: whatsapp ? "whatsapp" : "call", mock: true, minutesUsed: 0 };
};

/**
 * A Lead Finder (researcher) plan in the contract's wire shape (1.1 part 1, T9): no `says`, no call cost, `search {area, results, fit_bar}`, `cost.searches {left, per_month}`, who.basis `none`. Mock only, and NO mock planner returns it (a Lead Finder card still answers
 * "could not tell who you mean" in JOBS=mock, as before); it is here so the real parser, the plan card and `PATCH /jobs/plan/{id}` have one fixture to be tested with. `left: 0` adds the `search_limit` blocker.
 */
export const WIRE_RESEARCHER_PLAN = (over: { area?: string; results?: number; fit_bar?: number; left?: number } = {}): Record<string, unknown> => ({
  plan_id: "plan-researcher",
  expires_in_minutes: 30,
  title: "Find new customers: saree shops and boutiques",
  who: { total: 0, eligible: 0, excluded: [], basis: { code: "none", params: {} } },
  says: [],
  when: { start: "after_ok", from: "10:00", to: "18:00", days: ["mon", "tue", "wed", "thu", "fri", "sat"], pace_per_hour: 0 },
  finds_out: [],
  cost: { searches: { left: over.left ?? 2, per_month: 3 } },
  primary: "start",
  alternatives: [],
  search: { area: over.area ?? "Vijayawada", results: over.results ?? 10, fit_bar: over.fit_bar ?? 70 },
  blockers: (over.left ?? 2) === 0 ? [{ code: "search_limit" }] : [],
});

/** `PATCH /jobs/plan/{id} {search}` in the mock: the Lead Finder plan above with the change applied (the same plan id). */
export const mockSearchPlan = (planId: string, patch: SearchPatch): JobPlan =>
  parsePlan({ ...WIRE_RESEARCHER_PLAN({ area: patch.area, results: patch.results, fit_bar: patch.fitBar }), plan_id: planId });
