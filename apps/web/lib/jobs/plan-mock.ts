import { parsePlan, parseSuggestionHeading, parseSuggestions } from "@/lib/api/jobs-parse";

import { MOCK_APPROVAL, MOCK_CUSTOM_JOB, WIRE_PLANS, WIRE_SUGGESTIONS_GENERIC, WIRE_SUGGESTIONS_TEXTILES } from "./fixtures";
import { MOCK_JOBS } from "./mock";
import type { JobPlan, JobStarted, JobTested, PlanInput, Suggestion, SuggestionList } from "./plan";
import type { JobKind } from "./types";

/**
 * JOBS=mock: the made-up planner and suggestions of the demo shop (Neelambari Silks), the ones in mocks/jobs sheets 02 and 03. Nothing is called, sent or stored. Every number here is a placeholder from the mock (the real ones are the API's); the plans are the contract's
 * wire shape (lib/jobs/fixtures.ts) read by the REAL parser. The planner reads only the two examples of the mock (silk-saree buyers, yesterday's missed calls); anything else is "could not tell who you mean".
 */
const PLANS = Object.fromEntries(Object.entries(WIRE_PLANS).map(([k, w]) => [k, parsePlan(w)])) as Record<keyof typeof WIRE_PLANS, JobPlan>;
const SILK_CALL = PLANS.silk_call;
const SILK_WHATSAPP = PLANS.silk_whatsapp;
const MISSED = PLANS.missed;
const UNCLEAR = PLANS.unclear;

const BY_KIND: Partial<Record<JobKind, JobPlan>> = { speed_to_lead: PLANS.speed_to_lead, followups: PLANS.followups, store_visits: PLANS.store_visits, offers: PLANS.offers };

/**
 * The sentence of a job TEMPLATE card ("Use this" asks for the plan of the card's own sentence, exactly as if it had been typed): the mock planner knows the five kinds by the words their sentences use (English and Telugu), and answers with that kind's plan.
 * The Lead Finder and custom ideas have no made-up plan, so they are "could not tell who you mean". Mock only: the real planner reads the sentence itself.
 */
function byTemplateAsk(said: string): JobPlan | null {
  if (/(festival|diwali|wedding|new collection|new batch|listing|stock|price list|దీపావళి|పండుగ|పెళ్లిళ్ల|కలెక్షన్)/.test(said)) return BY_KIND.offers ?? null;
  if (/(visit|appointment|book |demo class|site |విజిట్|అపాయింట్)/.test(said)) return BY_KIND.store_visits ?? null;
  if (/(follow up|follow-up|remind|quiet|went quiet|reorder|ఫాలో|గుర్తు)/.test(said)) return BY_KIND.followups ?? null;
  if (/(answer .*calls|cannot pick up|can't pick up|ఎత్త)/.test(said)) return MISSED;
  if (/(new .*enquir|right away|వెంటనే|ఎంక్వైరీ)/.test(said)) return BY_KIND.speed_to_lead ?? null;
  return null;
}

/** What the mock planner answers: the two examples of the mocks (and the WhatsApp version of the first, by its plan id), the four suggested jobs by kind, and for anything else the "could not tell who you mean" plan (no Start). */
export function mockPlan(input: PlanInput): JobPlan {
  if ("kind" in input) return BY_KIND[input.kind] ?? UNCLEAR;
  if ("as" in input) return input.planId === SILK_CALL.planId ? SILK_WHATSAPP : UNCLEAR;
  const said = input.text.toLowerCase();
  if (/(missed|మిస్డ్|मिस्ड|ಮಿಸ್ಡ್)/.test(said)) return MISSED;
  if (/(silk|saree|sari|సిల్క్|చీర|सिल्क|साड़ी|ಸಿಲ್ಕ್|ಸೀರೆ)/.test(said) && /(bought|buyers|purchase|purchased|buy|కొన్న|खरीद|ಕೊಂಡ)/.test(said)) return SILK_CALL;
  return byTemplateAsk(said) ?? UNCLEAR;
}

/** The saree shop's four (mock sheet 03), and the plain three for every other business type. */
export const MOCK_SUGGESTIONS_TEXTILES: readonly Suggestion[] = parseSuggestions(WIRE_SUGGESTIONS_TEXTILES);
export const MOCK_SUGGESTIONS_GENERIC: readonly Suggestion[] = parseSuggestions(WIRE_SUGGESTIONS_GENERIC);
/**
 * A saree and fabric shop, told by what its business type switches on (no business type is named in code): the product catalogue and quotes, and not the by-area, by-weight materials of a building-materials shop.
 * Mock only: the real API chooses the suggestions (and the heading) by the business itself.
 */
export const sellsSarees = (modules: readonly string[] | null): boolean => modules !== null && modules.includes("catalogue") && modules.includes("quotes") && !modules.includes("materials");
export const mockSuggestions = (modules: readonly string[] | null): SuggestionList =>
  sellsSarees(modules) ? { items: [...MOCK_SUGGESTIONS_TEXTILES], heading: parseSuggestionHeading(WIRE_SUGGESTIONS_TEXTILES) } : { items: [...MOCK_SUGGESTIONS_GENERIC], heading: parseSuggestionHeading(WIRE_SUGGESTIONS_GENERIC) };

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
