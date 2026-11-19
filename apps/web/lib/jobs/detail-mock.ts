import type { JobDetail, JobFaq, JobFindsOut, JobResults, JobSays, JobSetting, TestChannel } from "./detail";
import { MOCK_JOBS } from "./mock";
import type { Job, JobKind } from "./types";

/**
 * JOBS=mock: the made-up pages of the demo shop's jobs (Neelambari Silks), the ones in mocks/jobs sheets 04 and 09. Nothing is sent or stored: a change only changes the screen the person is on.
 * What the real API would compose (the words a customer hears, with the business name, the job's own name and the AI disclosure) is composed here by `composeSays`.
 */
export const MOCK_BUSINESS = "Neelambari Silks";

const FROM = ["08:00", "08:30", "09:00", "09:30", "10:00", "10:30", "11:00"];
const TO = ["17:00", "18:00", "19:00", "20:00", "21:00"];
const LANGS = ["customer", "en", "te", "hi", "kn"];
const choice = (key: string, value: string, options: readonly string[], more = false): JobSetting => ({ key, type: "choice", value, options, more });
const toggle = (key: string, on: boolean, more = true): JobSetting => ({ key, type: "toggle", value: on ? "on" : "off", options: ["on", "off"], more });
const language = (): JobSetting => choice("language", "customer", LANGS);

const SETTINGS: Partial<Record<JobKind, () => JobSetting[]>> = {
  speed_to_lead: () => [
    choice("response", "right_away", ["right_away", "after_5", "after_15", "after_60"]),
    choice("from_hour", "09:30", FROM),
    choice("to_hour", "19:00", TO),
    choice("retries", "3", ["1", "2", "3", "5"]),
    language(),
    choice("never_day", "none", ["none", "sunday", "weekend"], true),
    choice("recent_days", "7", ["7", "14", "30"], true),
    choice("call_from", "business_number", ["business_number", "my_number"], true),
    toggle("notify_visit", true),
    toggle("stop_after", true),
  ],
  answer_calls: () => [choice("answer_after", "25", ["15", "25", "40"]), language(), choice("call_from", "business_number", ["business_number", "my_number"], true)],
  followups: () => [choice("wait_days", "1", ["1", "2", "3"]), choice("from_hour", "10:00", FROM), choice("to_hour", "19:00", TO), language(), choice("never_day", "sunday", ["none", "sunday", "weekend"], true), toggle("stop_after", true)],
  store_visits: () => [choice("remind_before", "day_before", ["day_before", "hours_3", "both"]), choice("from_hour", "10:00", FROM), choice("to_hour", "19:00", TO), language(), toggle("notify_visit", true)],
  offers: () => [choice("send_at", "10:00", ["10:00", "11:00", "17:00", "18:00"]), language(), choice("recent_days", "7", ["7", "14", "30"], true)],
  researcher: () => [choice("radius", "20", ["10", "20", "50"])],
};
const GENERIC = (): JobSetting[] => [choice("from_hour", "09:30", FROM), choice("to_hour", "19:00", TO), language()];

const FINDS: Partial<Record<JobKind, [string, boolean][]>> = {
  speed_to_lead: [["occasion", true], ["budget", true], ["visit_time", true], ["fabric", false]],
  followups: [["price_asked", true], ["decision_time", true], ["budget", false]],
  store_visits: [["confirm_coming", true], ["coming_with", false]],
  answer_calls: [["call_reason", true], ["callback_time", true], ["caller_name", true]],
  offers: [["offer_interest", true], ["decision_time", false]],
  researcher: [["shop_size", true], ["what_they_sell", true]],
};

const FAQS: Partial<Record<JobKind, [string, string][]>> = {
  speed_to_lead: [
    ["Do you open on Sundays?", "Yes, from 10 am to 8 pm. We are closed on Tuesdays."],
    ["Can I see the sarees before I buy?", "Yes, come to the store and we will show you everything. You can also get photos on WhatsApp."],
  ],
  answer_calls: [["Where is the shop?", "Begum Bazaar, near the main gate. A map link is on our WhatsApp."]],
  followups: [["Can I return a saree?", "Yes, within 7 days with the bill, if it is not worn or washed."]],
};

const RESULTS: Partial<Record<JobKind, JobResults>> = {
  speed_to_lead: {
    days: 7,
    numbers: [{ key: "called", value: 38 }, { key: "picked_up", value: 27 }, { key: "visits", value: 9 }],
    items: [
      { customer: "Ravi Kumar", status: "done", detailCode: "visit_booked", params: { visit_at: "2026-11-21T10:30:00Z" }, at: "2026-11-19T04:20:00Z" },
      { customer: "Padma", status: "waiting", detailCode: "call_at", params: { call_at: "2026-11-20T04:00:00Z" }, at: "2026-11-19T03:50:00Z" },
      { customer: "Anitha", status: "instead", detailCode: "number_off", params: {}, at: "2026-11-18T09:10:00Z" },
    ],
  },
  answer_calls: {
    days: 7,
    numbers: [{ key: "answered", value: 14 }, { key: "callbacks", value: 5 }],
    items: [
      { customer: "Lakshmi", status: "done", detailCode: "answered_noted", params: {}, at: "2026-11-19T04:02:00Z" },
      { customer: "Venkat", status: "noanswer", detailCode: "call_back_asked", params: {}, at: "2026-11-18T10:30:00Z" },
    ],
  },
  followups: {
    days: 7,
    numbers: [{ key: "followed", value: 21 }, { key: "replied", value: 8 }],
    items: [
      { customer: "Sravani Reddy", status: "failed", detailCode: "asked_price", params: { days: 2 }, at: "2026-11-19T03:42:00Z" },
      { customer: "Padma", status: "failed", detailCode: "asked_item", params: { item: "the blue Pochampally saree", days: 3 }, at: "2026-11-19T03:42:00Z" },
    ],
  },
  store_visits: {
    days: 7,
    numbers: [{ key: "reminders", value: 17 }, { key: "came", value: 11 }],
    items: [{ customer: "Lakshmi", status: "done", detailCode: "reminder_sent", params: { visit_at: "2026-11-20T05:30:00Z" }, at: "2026-11-19T03:30:00Z" }],
  },
  offers: { days: 7, numbers: [{ key: "ready", value: 38 }], items: [] },
  researcher: { days: 7, numbers: [{ key: "shops", value: 12 }, { key: "contacted", value: 3 }], items: [{ customer: "Sri Lakshmi Textiles", status: "done", detailCode: "shop_contacted", params: {}, at: "2026-11-17T08:00:00Z" }] },
};

const EMPTY_RESULTS: JobResults = { days: 7, numbers: [], items: [] };
const TEST: Partial<Record<JobKind, TestChannel>> = { speed_to_lead: "call", answer_calls: "call", followups: "message", store_visits: "message", offers: "message" };
const EFFECT_INPUTS: Partial<Record<JobKind, Record<string, string | number>>> = {
  speed_to_lead: { who: "Ravi", event_at: "20:15" },
  followups: { who: "Padma", event_at: "16:00" },
  store_visits: { who: "Lakshmi", booked_at: "11:00", event_at: "16:00" },
};

/** What a customer hears or reads, in the words the API would compose: the job's name (when the owner gave one) and "the AI assistant of {business}" are always there. */
const INTRO: Record<string, (name: string | null, business: string) => string> = {
  en: (n, b) => `Namaskaram Ravi garu, this is ${n ? `${n}, ` : ""}the AI assistant of ${b}.`,
  te: (n, b) => `నమస్కారం రవి గారు, నేను ${n ? `${n}, ` : ""}${b} AI అసిస్టెంట్‌ని.`,
  hi: (n, b) => `नमस्ते रवि जी, मैं ${n ? `${n}, ` : ""}${b} का AI असिस्टेंट हूँ।`,
  kn: (n, b) => `ನಮಸ್ಕಾರ ರವಿ ಅವರೇ, ನಾನು ${n ? `${n}, ` : ""}${b} ನ AI ಅಸಿಸ್ಟೆಂಟ್.`,
};
const BODY: Partial<Record<JobKind, Record<string, string>>> = {
  speed_to_lead: { en: "You asked about our silk sarees. Which occasion is it for?", te: "మీరు మా సిల్క్ చీరల గురించి అడిగారు. ఏ సందర్భం కోసం?", hi: "आपने हमारी सिल्क साड़ियों के बारे में पूछा था। किस मौके के लिए चाहिए?", kn: "ನೀವು ನಮ್ಮ ರೇಷ್ಮೆ ಸೀರೆಗಳ ಬಗ್ಗೆ ಕೇಳಿದ್ದೀರಿ. ಯಾವ ಸಂದರ್ಭಕ್ಕೆ?" },
  answer_calls: { en: "The shop could not take your call. How can I help you?", te: "షాప్ వాళ్ళు మీ కాల్ ఎత్తలేకపోయారు. నేను ఎలా సహాయం చేయగలను?" },
  followups: { en: "You asked about a price. Shall I send you the details?", te: "మీరు ధర గురించి అడిగారు. వివరాలు పంపమంటారా?" },
  store_visits: { en: "A reminder: your visit is tomorrow at 11 am.", te: "గుర్తు చేస్తున్నాను: మీ విజిట్ రేపు ఉదయం 11 గంటలకు." },
  offers: { en: "We have a festival offer for you. Would you like to hear it?", te: "మీ కోసం పండుగ ఆఫర్ ఉంది. చెప్పమంటారా?" },
};
export function composeSays(kind: JobKind, name: string | null, business: string): JobSays[] {
  const body = BODY[kind];
  if (!body) return [];
  const channel = kind === "speed_to_lead" || kind === "answer_calls" ? "call" : "whatsapp";
  return Object.entries(body).map(([lang, text]) => ({ language: lang, channel, text: `${INTRO[lang](name, business)} ${text}` }));
}

export const WHAT_CODE: Record<JobKind, string> = {
  speed_to_lead: "speed_to_lead",
  answer_calls: "answer_calls",
  followups: "followups",
  store_visits: "store_visits",
  offers: "offers",
  researcher: "researcher",
  payment_reminders: "custom",
  custom: "custom",
};

/** The made-up page of one job; null for an id that is not one of the mock jobs. A generic page answers for the kinds without a hand-made one. */
export function mockJobDetail(jobId: string, now: number = Date.now()): JobDetail | null {
  const base = MOCK_JOBS.find((j) => j.id === jobId);
  if (!base) return null;
  // "Last run 9 minutes ago": the made-up run is always minutes before the page is drawn
  const job: Job = base.lastRunAt ? { ...base, lastRunAt: new Date(now - (base.kind === "researcher" ? 7 * 86_400_000 : 9 * 60_000)).toISOString() } : base;
  const kind = job.kind;
  const finds: JobFindsOut[] = (FINDS[kind] ?? []).map(([key, enabled]) => ({ key, enabled }));
  const faqs: JobFaq[] = (FAQS[kind] ?? []).map(([question, answer], i) => ({ id: `faq-${kind}-${i + 1}`, question, answer }));
  const failure =
    job.status === "failed" && job.fix
      ? { code: job.fix.code, params: { n: job.fix.count }, items: (RESULTS[kind]?.items ?? []).filter((i) => i.status === "failed").map((i) => ({ customer: i.customer, detailCode: i.detailCode, params: i.params, at: i.at })) }
      : null;
  return {
    job,
    business: MOCK_BUSINESS,
    whatCode: WHAT_CODE[kind],
    says: composeSays(kind, job.customName, MOCK_BUSINESS),
    settings: (SETTINGS[kind] ?? GENERIC)(),
    effectInputs: EFFECT_INPUTS[kind] ?? null,
    findsOut: finds,
    faqs,
    results: RESULTS[kind] ?? EMPTY_RESULTS,
    failure,
    test: TEST[kind] ?? null,
  };
}
