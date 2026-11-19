import { MOCK_JOBS } from "./mock";
import type { JobPlan, JobStarted, JobTested, PlanChannel, PlanInput, Suggestion, SuggestionList } from "./plan";
import type { JobKind } from "./types";

/**
 * JOBS=mock: the made-up planner and suggestions of the demo shop (Neelambari Silks), the ones in mocks/jobs sheets 02 and 03. Nothing is called, sent or stored. Every number here is a placeholder from the mock (the real ones are the API's):
 * the planner reads only the two examples of the mock (silk-saree buyers, yesterday's missed calls); anything else is "could not tell who you mean".
 */
const BUSINESS = "Neelambari Silks";
const INCLUDED = 60;

const plan = (p: Partial<JobPlan> & Pick<JobPlan, "planId" | "title" | "who" | "says" | "when" | "findsOut" | "cost">): JobPlan => ({ primary: "start", alternatives: [], blockers: [], expiresInMinutes: 30, ...p });
const line = (channel: PlanChannel, text: string) => [{ language: "en", channel, text }];

const SILK_CALL = plan({
  planId: "plan-silk-call",
  title: "Ask last month’s silk buyers how they liked it",
  who: { basis: { code: "bought_calls", params: { item: "a silk saree" } }, total: 42, eligible: 38, excluded: [{ code: "no_call_consent", count: 4 }] },
  says: line("call", `Namaskaram Lakshmi garu, this is the AI assistant of ${BUSINESS}. How did you like the Kanchipuram saree you bought last month?`),
  when: { fromHour: 10, toHour: 18, days: ["tomorrow", "sat"], pacePerHour: 7 },
  findsOut: ["liked_it", "would_change", "new_arrivals"],
  cost: { minutes: 34, minutesIncluded: INCLUDED, rupees: null },
  alternatives: [{ kind: "whatsapp", count: 3 }],
});
const SILK_WHATSAPP = plan({
  planId: "plan-silk-whatsapp",
  title: "Ask last month’s silk buyers how they liked it, on WhatsApp",
  who: { basis: { code: "bought_whatsapp", params: { item: "a silk saree" } }, total: 4, eligible: 3, excluded: [{ code: "stopped", count: 1 }] },
  says: line("whatsapp", `Namaskaram Lakshmi garu, this is the AI assistant of ${BUSINESS}. How did you like the Kanchipuram saree you bought last month? Reply STOP to stop these messages.`),
  when: { fromHour: 10, toHour: 18, days: ["tomorrow"], pacePerHour: 20 },
  findsOut: ["liked_it", "would_change"],
  cost: { minutes: 0, minutesIncluded: INCLUDED, rupees: null },
});
const MISSED = plan({
  planId: "plan-missed",
  title: "Call back yesterday’s missed calls",
  who: { basis: { code: "missed_calls", params: {} }, total: 6, eligible: 6, excluded: [] },
  says: line("call", `Namaskaram Ravi garu, this is the AI assistant of ${BUSINESS}. We saw your call yesterday. How can we help you?`),
  when: { fromHour: 10, toHour: 18, days: ["today"], pacePerHour: 6 },
  findsOut: ["what_they_wanted", "visit_interest"],
  cost: { minutes: 5, minutesIncluded: INCLUDED, rupees: null },
});
const UNCLEAR = plan({
  planId: "plan-unclear",
  title: "",
  who: { basis: { code: "none", params: {} }, total: 0, eligible: 0, excluded: [] },
  says: [],
  when: { fromHour: 10, toHour: 18, days: [], pacePerHour: 0 },
  findsOut: [],
  cost: { minutes: 0, minutesIncluded: INCLUDED, rupees: null },
  blockers: ["unclear_who"],
  expiresInMinutes: null,
});

const BY_KIND: Partial<Record<JobKind, JobPlan>> = {
  speed_to_lead: plan({
    planId: "plan-kind-speed_to_lead",
    title: "Call every new enquiry right away",
    who: { basis: { code: "new_enquiries", params: {} }, total: 14, eligible: 14, excluded: [] },
    says: line("call", `Namaskaram, this is the AI assistant of ${BUSINESS}. Thank you for asking about our silk sarees. Which occasion is it for?`),
    when: { fromHour: 10, toHour: 18, days: ["every_day"], pacePerHour: 10 },
    findsOut: ["occasion", "budget", "visit_interest"],
    cost: { minutes: 18, minutesIncluded: INCLUDED, rupees: null },
  }),
  followups: plan({
    planId: "plan-kind-followups",
    title: "Follow up on price questions and promises",
    who: { basis: { code: "price_questions", params: {} }, total: 5, eligible: 5, excluded: [] },
    says: line("whatsapp", `Namaskaram Sravani garu, this is the AI assistant of ${BUSINESS}. The green Kanchipuram saree is ₹18,500. Shall I keep it for you? Reply STOP to stop these messages.`),
    when: { fromHour: 10, toHour: 18, days: ["tomorrow"], pacePerHour: 20 },
    findsOut: ["still_interested", "visit_interest"],
    cost: { minutes: 0, minutesIncluded: INCLUDED, rupees: null },
  }),
  store_visits: plan({
    planId: "plan-kind-store_visits",
    title: "Book and remind store visits",
    who: { basis: { code: "visits_promised", params: {} }, total: 3, eligible: 3, excluded: [] },
    says: line("whatsapp", `Reminder from the AI assistant of ${BUSINESS}: tomorrow 11 am, Begum Bazaar. See you! Reply STOP to stop these messages.`),
    when: { fromHour: 10, toHour: 18, days: ["every_day"], pacePerHour: 20 },
    findsOut: ["coming"],
    cost: { minutes: 0, minutesIncluded: INCLUDED, rupees: null },
  }),
  offers: plan({
    planId: "plan-kind-offers",
    title: "Send the wedding-season offer to customers who said yes",
    who: { basis: { code: "offer_yes", params: {} }, total: 38, eligible: 38, excluded: [] },
    says: line("whatsapp", `This is the AI assistant of ${BUSINESS}. Wedding season offer: free blouse stitching on silk sarees till 30 November. Reply STOP to stop these messages.`),
    when: { fromHour: 10, toHour: 18, days: ["after_ok"], pacePerHour: 20 },
    findsOut: ["interested"],
    cost: { minutes: 0, minutesIncluded: INCLUDED, rupees: null },
  }),
};

/** What the mock planner answers: the two examples of the mocks, the four suggested jobs by kind, and for anything else the "could not tell who you mean" plan (no Start). */
export function mockPlan(input: PlanInput): JobPlan {
  if ("kind" in input) return BY_KIND[input.kind] ?? UNCLEAR;
  const said = input.text.toLowerCase();
  if (/(missed|మిస్డ్|मिस्ड|ಮಿಸ್ಡ್)/.test(said)) return MISSED;
  if (/(silk|saree|sari|సిల్క్|చీర|सिल्क|साड़ी|ಸಿಲ್ಕ್|ಸೀರೆ)/.test(said) && /(bought|buyers|purchase|purchased|buy|కొన్న|खरीद|ಕೊಂಡ)/.test(said)) return input.as === "whatsapp" ? SILK_WHATSAPP : SILK_CALL;
  return UNCLEAR;
}

const sug = (kind: JobKind, why: Suggestion["why"], preview: string, title: Suggestion["title"] = null): Suggestion => ({ kind, title, why, preview, ready: true });

/** The saree shop's four (mock sheet 03), and the plain three for every other business type. */
export const MOCK_SUGGESTIONS_TEXTILES: readonly Suggestion[] = [
  sug("speed_to_lead", { code: "enquiries_waited", params: { enquiries: 14, waited: 9 } }, "Thank you for asking about our silk sarees. Which occasion is it for?"),
  sug("followups", { code: "price_waiting", params: { n: 5 } }, "Namaskaram Sravani garu, the green Kanchipuram saree is ₹18,500. Shall I keep it for you?"),
  sug("store_visits", { code: "visits_said", params: { n: 3 } }, `Reminder: tomorrow 11 am, ${BUSINESS}, Begum Bazaar. See you!`),
  sug("offers", { code: "offer_yes", params: { n: 38 } }, "Wedding season offer: free blouse stitching on silk sarees till 30 November.", { code: "offers_wedding" }),
];
export const MOCK_SUGGESTIONS_GENERIC: readonly Suggestion[] = [
  sug("speed_to_lead", { code: "generic_speed", params: {} }, "Thank you for your enquiry. What can we help you with?"),
  sug("followups", { code: "generic_followups", params: {} }, "Hello, we are following up on your question. Can we help you with anything more?"),
  sug("store_visits", { code: "generic_visits", params: {} }, "Reminder: your visit is tomorrow. See you!"),
];
/**
 * A saree and fabric shop, told by what its business type switches on (no business type is named in code): the product catalogue and quotes, and not the by-area, by-weight materials of a building-materials shop.
 * Mock only: the real API chooses the suggestions (and the heading) by the business itself.
 */
export const sellsSarees = (modules: readonly string[] | null): boolean => modules !== null && modules.includes("catalogue") && modules.includes("quotes") && !modules.includes("materials");
export const mockSuggestions = (modules: readonly string[] | null): SuggestionList => (sellsSarees(modules) ? { items: [...MOCK_SUGGESTIONS_TEXTILES], heading: "saree" } : { items: [...MOCK_SUGGESTIONS_GENERIC], heading: null });

const CUSTOM_JOB = "66666666-6666-4666-8666-666666666608";
/** Starting in the mock: an existing made-up job of the same kind (or one made-up job for a typed plan); nothing starts. */
export function mockStartedFor(kind: JobKind | null): JobStarted {
  return { jobId: kind ? (MOCK_JOBS.find((j) => j.kind === kind)?.id ?? CUSTOM_JOB) : CUSTOM_JOB };
}
export const mockStartPlan = (planId: string): JobStarted => {
  const kind = (Object.entries(BY_KIND) as [JobKind, JobPlan][]).find(([, p]) => p.planId === planId)?.[0] ?? null;
  return mockStartedFor(kind);
};
export const mockTest = (planId: string): JobTested => ({ channel: [SILK_WHATSAPP, ...Object.values(BY_KIND)].some((p) => p.planId === planId && p.says[0]?.channel === "whatsapp") ? "whatsapp" : "call", mock: true });
