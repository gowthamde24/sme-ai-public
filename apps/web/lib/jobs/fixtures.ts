/**
 * THE FIXTURES of the Jobs screens: every made-up answer of JOBS=mock (the demo shop, Neelambari Silks) is built HERE, in the WIRE shape of C1's FINAL 1.0 contract (snake_case JSON exactly as the API sends it). The mock modules
 * (mock.ts, detail-mock.ts, plan-mock.ts, dnc-mock.ts) only run these through the REAL parsers (lib/api/jobs-parse.ts, lib/api/do-not-call.ts), and lib/jobs/fixtures.test.ts parses EVERY fixture here, so a contract change
 * breaks one test and the demo can never show a shape the API does not send. Nothing here is sent or stored, and no number or price in it is real: they are placeholders of the mock.
 */
export type Wire = Record<string, unknown>;

export const MOCK_BUSINESS = "Neelambari Silks";
export const MOCK_ASSISTANT = "Asha";
const jobId = (n: number) => `66666666-6666-4666-8666-6666666666${String(n).padStart(2, "0")}`;
/** The id of the made-up job a typed plan "starts" in the mock (nothing starts). */
export const MOCK_CUSTOM_JOB = jobId(8);
/** The approval a made-up start waits for (the offer goes only after the Owner's OK). */
export const MOCK_APPROVAL = { id: "approval-offer-1", kind: "offer" } as const;

/** The day codes of the contract (`when.days`: mon..sun). */
const ALL_DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
const MON_SAT = ALL_DAYS.slice(0, 6);

/* ---- jobs (section 1) and Today (section 3) ---- */
type JobIn = { n: number; kind: string; name?: string | null; enabled?: boolean; status: string; result: { code: string; params?: Wire }; needs?: number; last?: string | null; fix?: { code: string; count: number } | null; gate?: string | null; speaks?: Wire };
export const wireJob = (j: JobIn): Wire => ({
  id: jobId(j.n),
  kind: j.kind,
  custom_name: j.name ?? null,
  enabled: j.enabled ?? true,
  status: j.status,
  result: { code: j.result.code, params: j.result.params ?? {} },
  needs_you: j.needs ?? 0,
  last_run_at: j.last ?? null,
  fix: j.fix ?? null,
  plan_gate: j.gate ? { code: j.gate } : null,
  ...(j.speaks ? { speaks: j.speaks } : {}),
});

/** The six made-up jobs of the demo shop (the ones in mocks/jobs). `payment_reminders` is v1.1: the API sends no job of that kind in v1, so the demo has none (the web still accepts the word). */
export const WIRE_JOBS: readonly Wire[] = [
  wireJob({ n: 1, kind: "speed_to_lead", status: "running", result: { code: "calls_today", params: { called: 6, picked_up: 4, visits: 2 } }, last: "2026-11-19T04:20:00Z" }),
  wireJob({ n: 2, kind: "answer_calls", status: "running", result: { code: "answered_today", params: { answered: 3, missed: 1, messages: 2 } }, last: "2026-11-19T04:02:00Z" }),
  wireJob({ n: 3, kind: "followups", status: "failed", result: { code: "template_needed", params: { count: 2 } }, needs: 2, last: "2026-11-19T03:42:00Z", fix: { code: "template_needed", count: 2 } }),
  wireJob({ n: 4, kind: "offers", status: "waiting", result: { code: "offer_ready", params: { customers: 38 } }, needs: 1 }),
  wireJob({ n: 5, kind: "store_visits", name: "Priya", status: "done", result: { code: "reminders_today", params: { sent: 3, confirmed: 2 } }, last: "2026-11-19T03:30:00Z", speaks: { language: "te", voice: "Janvi", number: "shop" } }),
  wireJob({ n: 6, kind: "researcher", status: "running", result: { code: "search_left", params: { left: 1, per_month: 1, last_search_at: "2026-11-12T08:00:00Z" } }, last: "2026-11-12T08:00:00Z" }),
];

/** More made-up jobs for the JOBS PAGE only (Today keeps the six above): two named jobs of kind `custom` with their own voice and number (the Jobs page has no fixed number of jobs), one of them Off. `speaks` is C1's contract 1.1 (assumed). */
export const WIRE_JOBS_EXTRA: readonly Wire[] = [
  wireJob({ n: 9, kind: "custom", name: "Ravi", status: "running", result: { code: "answered_today", params: { answered: 2, missed: 0, messages: 1 } }, last: "2026-11-19T04:10:00Z", speaks: { language: "en", voice: "Arjun", number: "second" } }),
  wireJob({ n: 10, kind: "custom", name: "Diwali calls", enabled: false, status: "paused", result: { code: "paused_on", params: { since: "2026-11-14T05:00:00Z" } }, speaks: { language: "te", voice: "Janvi", number: "shop" } }),
];

/** Jobs the demo does not show but the contract allows: every other result code, and every plan gate. (Not `payment_reminders`: it is v1.1; its word is tested to be tolerated, lib/api/jobs.test.ts.) They are here so the parser test covers them. */
export const WIRE_JOB_VARIANTS: readonly Wire[] = [
  wireJob({ n: 21, kind: "followups", status: "running", result: { code: "not_sent_window", params: { count: 3, opens_at: "2026-11-20T03:30:00Z" } } }),
  wireJob({ n: 22, kind: "speed_to_lead", status: "waiting", result: { code: "needs_approval", params: { count: 2 } }, needs: 2 }),
  wireJob({ n: 23, kind: "answer_calls", status: "failed", enabled: true, result: { code: "minutes_used" }, gate: "minutes_used" }),
  wireJob({ n: 24, kind: "store_visits", status: "paused", enabled: false, result: { code: "no_whatsapp" }, gate: "no_whatsapp" }),
  wireJob({ n: 25, kind: "speed_to_lead", status: "paused", enabled: false, result: { code: "no_number" }, gate: "no_number" }),
  wireJob({ n: 26, kind: "offers", status: "paused", enabled: false, result: { code: "offer_ready", params: { customers: 38 } }, gate: "billing_blocked" }),
  wireJob({ n: 27, kind: "researcher", status: "running", result: { code: "search_left", params: { left: 1, per_month: 1, last_search_at: null } } }),
  wireJob({ n: 29, kind: "followups", enabled: false, status: "paused", result: { code: "paused_on", params: { since: "2026-11-14T05:00:00Z" } } }),
  wireJob({ n: 28, kind: "custom", name: "Diwali calls", status: "running", result: { code: "a_code_the_web_has_no_words_for", params: { n: 1 } } }),
];

/** `GET /jobs/today`. */
export const wireToday = (): Wire => ({
  jobs: [...WIRE_JOBS],
  // `{id, code, kind, at, target {type, id}}` and nothing else
  needs_you: [
    { id: "approval-offer-1", code: "needs_approval", kind: "offer", at: "2026-11-19T03:10:00Z", target: { type: "approval", id: "approval-offer-1" } },
    { id: "template-1", code: "template_needed", kind: "template", at: "2026-11-19T03:42:00Z", target: { type: "message", id: "message-1" } },
  ],
  assistant: { name: MOCK_ASSISTANT },
});

/* ---- ONE job's page (sections 1, 3, 6, 7 and 9) ---- */
const FROM = ["08:00", "08:30", "09:00", "09:30", "10:00", "10:30", "11:00"];
const TO = ["17:00", "18:00", "19:00", "20:00", "21:00"];
const LANGS = ["customer", "en", "te", "hi", "kn"];
type SettingIn = { setting: Wire; more: boolean };
const choice = (key: string, value: string, options: readonly string[], more = false): SettingIn => ({ setting: { key, type: "choice", value, options }, more });
/** A toggle: its value is a BOOLEAN on the wire and it has no `options`. */
const toggle = (key: string, on: boolean, more = true): SettingIn => ({ setting: { key, type: "toggle", value: on }, more });
const language = (more = false): SettingIn => choice("language", "customer", LANGS, more);

/** The settings of a kind: at most 4 in `main`, the rest under More choices (`more`). The contract has no `area` on a Setting: the list it is in says where it goes. */
const SETTINGS: Record<string, () => SettingIn[]> = {
  speed_to_lead: () => [
    choice("response", "right_away", ["right_away", "after_5", "after_15", "after_60"]),
    choice("from_hour", "09:30", FROM),
    choice("to_hour", "19:00", TO),
    choice("retries", "3", ["1", "2", "3", "5"]),
    language(true),
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
const GENERIC = (): SettingIn[] => [choice("from_hour", "09:30", FROM), choice("to_hour", "19:00", TO), language()];
const settingsOf = (ins: readonly SettingIn[]): Wire => ({ main: ins.filter((i) => !i.more).map((i) => i.setting), more: ins.filter((i) => i.more).map((i) => i.setting) });

const FINDS: Record<string, [string, boolean][]> = {
  speed_to_lead: [["occasion", true], ["budget", true], ["visit_time", true], ["fabric", false]],
  followups: [["price_asked", true], ["decision_time", true], ["budget", false]],
  store_visits: [["confirm_coming", true], ["coming_with", false]],
  answer_calls: [["call_reason", true], ["callback_time", true], ["caller_name", true]],
  offers: [["offer_interest", true], ["decision_time", false]],
  researcher: [["shop_size", true], ["what_they_sell", true]],
};

const FAQS: Record<string, [string, string][]> = {
  speed_to_lead: [
    ["Do you open on Sundays?", "Yes, from 10 am to 8 pm. We are closed on Tuesdays."],
    ["Can I see the sarees before I buy?", "Yes, come to the store and we will show you everything. You can also get photos on WhatsApp."],
  ],
  answer_calls: [["Where is the shop?", "Begum Bazaar, near the main gate. A map link is on our WhatsApp."]],
  followups: [["Can I return a saree?", "Yes, within 7 days with the bill, if it is not worn or washed."]],
};

type Results = { days: number; numbers: Wire; items: Wire[] };
const rItem = (customer: string, status: string, detail_code: string, params: Wire, at: string): Wire => ({ customer, status, detail_code, params, at });
const RESULTS: Record<string, Results> = {
  speed_to_lead: {
    days: 7,
    numbers: { called: 38, picked_up: 27, visits: 9 },
    items: [
      rItem("Ravi Kumar", "done", "visit_booked", { visit_at: "2026-11-21T10:30:00Z" }, "2026-11-19T04:20:00Z"),
      rItem("Padma", "waiting", "call_at", { call_at: "2026-11-20T04:00:00Z" }, "2026-11-19T03:50:00Z"),
      rItem("Anitha", "instead", "number_off", {}, "2026-11-18T09:10:00Z"),
    ],
  },
  answer_calls: { days: 7, numbers: { answered: 14, callbacks: 5 }, items: [rItem("Lakshmi", "done", "answered_noted", {}, "2026-11-19T04:02:00Z"), rItem("Venkat", "noanswer", "call_back_asked", {}, "2026-11-18T10:30:00Z")] },
  followups: {
    days: 7,
    numbers: { followed: 21, replied: 8 },
    items: [rItem("Sravani Reddy", "failed", "asked_price", { days: 2 }, "2026-11-19T03:42:00Z"), rItem("Padma", "failed", "asked_item", { item: "the blue Pochampally saree", days: 3 }, "2026-11-19T03:42:00Z")],
  },
  store_visits: { days: 7, numbers: { reminders: 17, came: 11 }, items: [rItem("Lakshmi", "done", "reminder_sent", { visit_at: "2026-11-20T05:30:00Z" }, "2026-11-19T03:30:00Z")] },
  offers: { days: 7, numbers: { ready: 38 }, items: [] },
  // the researcher's free-search state sits in `numbers` too (contract section 9): whole numbers, a date and a flag
  researcher: { days: 7, numbers: { shops: 12, contacted: 3, per_month: 1, left: 1, last_search_at: "2026-11-12T08:00:00Z", weekly: false }, items: [rItem("Sri Lakshmi Textiles", "done", "shop_contacted", {}, "2026-11-17T08:00:00Z")] },
};
const EMPTY_RESULTS: Results = { days: 7, numbers: {}, items: [] };

/** Which test button a job has (`test_channel`): `call` or `whatsapp`; none for a job that does not talk to customers. */
const TEST: Record<string, string> = { speed_to_lead: "call", answer_calls: "call", followups: "whatsapp", store_visits: "whatsapp", offers: "whatsapp" };
const EFFECT_INPUTS: Record<string, Wire> = {
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
const BODY: Record<string, Record<string, string>> = {
  speed_to_lead: { en: "You asked about our silk sarees. Which occasion is it for?", te: "మీరు మా సిల్క్ చీరల గురించి అడిగారు. ఏ సందర్భం కోసం?", hi: "आपने हमारी सिल्क साड़ियों के बारे में पूछा था। किस मौके के लिए चाहिए?", kn: "ನೀವು ನಮ್ಮ ರೇಷ್ಮೆ ಸೀರೆಗಳ ಬಗ್ಗೆ ಕೇಳಿದ್ದೀರಿ. ಯಾವ ಸಂದರ್ಭಕ್ಕೆ?" },
  answer_calls: { en: "The shop could not take your call. How can I help you?", te: "షాప్ వాళ్ళు మీ కాల్ ఎత్తలేకపోయారు. నేను ఎలా సహాయం చేయగలను?" },
  followups: { en: "You asked about a price. Shall I send you the details?", te: "మీరు ధర గురించి అడిగారు. వివరాలు పంపమంటారా?" },
  store_visits: { en: "A reminder: your visit is tomorrow at 11 am.", te: "గుర్తు చేస్తున్నాను: మీ విజిట్ రేపు ఉదయం 11 గంటలకు." },
  offers: { en: "We have a festival offer for you. Would you like to hear it?", te: "మీ కోసం పండుగ ఆఫర్ ఉంది. చెప్పమంటారా?" },
};
export function composeSays(kind: string, name: string | null, business: string): Wire[] {
  const body = BODY[kind];
  if (!body) return [];
  const channel = kind === "speed_to_lead" || kind === "answer_calls" ? "call" : "whatsapp";
  return Object.entries(body).map(([lang, text]) => ({ language: lang, channel, text: `${INTRO[lang](name, business)} ${text}` }));
}


export const WHAT_CODE: Record<string, string> = {
  speed_to_lead: "speed_to_lead",
  answer_calls: "answer_calls",
  followups: "followups",
  store_visits: "store_visits",
  offers: "offers",
  researcher: "researcher",
  payment_reminders: "custom",
  custom: "custom",
};

/**
 * The made-up page of one job as the API would send it (`GET /jobs/{id}`); null for an id that is not one of the mock jobs. A generic page answers for the kinds without a hand-made one. `now` makes "Last run 9 minutes ago" true whenever the page is drawn.
 * A failed job carries its `failure {code, params, items[]}`.
 */
export function wireJobDetail(id: string, now: number = Date.now()): Wire | null {
  const base = [...WIRE_JOBS, ...WIRE_JOBS_EXTRA].find((j) => j.id === id);
  if (!base) return null;
  const kind = base.kind as string;
  const last = base.last_run_at ? new Date(now - (kind === "researcher" ? 7 * 86_400_000 : 9 * 60_000)).toISOString() : null;
  const ins = (SETTINGS[kind] ?? GENERIC)();
  const value = (key: string, fallback: string): string => String((ins.find((i) => i.setting.key === key)?.setting.value as string | undefined) ?? fallback);
  const results = RESULTS[kind] ?? EMPTY_RESULTS;
  const fix = base.fix as { code: string; count: number } | null;
  const failed = base.status === "failed" && fix;
  const talks = composeSays(kind, (base.custom_name as string | null) ?? null, MOCK_BUSINESS);
  return {
    ...base,
    last_run_at: last,
    business_name: MOCK_BUSINESS,
    what_it_does: { code: WHAT_CODE[kind] ?? "custom" },
    says: talks,
    // `when` is read-only input for the "what it will do" line (its days are the same codes as a plan's); the hours the owner changes are the settings
    when: { from_hour: value("from_hour", "09:30"), to_hour: value("to_hour", "19:00"), days: [...ALL_DAYS], pace_per_hour: 10 },
    settings: settingsOf(ins),
    effect: EFFECT_INPUTS[kind] ? { inputs: EFFECT_INPUTS[kind] } : null,
    finds_out: (FINDS[kind] ?? []).map(([key, enabled]) => ({ key, enabled })),
    faqs: (FAQS[kind] ?? []).map(([question, answer], i) => ({ id: `faq-${kind}-${i + 1}`, question, answer })),
    results,
    failure: failed ? { code: fix.code, params: { count: fix.count }, items: results.items.filter((i) => i.status === "failed").map((i) => ({ customer: i.customer, detail_code: i.detail_code, params: i.params, at: i.at })) } : null,
    test_channel: TEST[kind] ?? null,
    // the month so far (the plan card's `cost` is the per-plan estimate)
    cost: { minutes_used: 8, minutes_included: 60, rupees: null },
  };
}

/* ---- the test buttons (section 3): `{placed: true, minutes_used: n}` ---- */
export const WIRE_TEST_CALL: Wire = { placed: true, minutes_used: 1 };
export const WIRE_TEST_MESSAGE: Wire = { placed: true, minutes_used: 0 };

/* ---- plans (section 4) ---- */
type PlanIn = {
  id: string;
  title: string;
  basis: { code: string; params?: Wire };
  total: number;
  eligible: number;
  excluded?: { code: string; count: number }[];
  says?: { channel: "call" | "whatsapp"; text: string };
  when: { start: "today" | "tomorrow" | "after_ok"; from: string; to: string; days: readonly string[]; pace: number };
  finds: [string, string][];
  minutes: number;
  primary?: string;
  alternatives?: { kind: string; count: number }[];
  blockers?: string[];
  expires?: number | null;
};
const planWire = (p: PlanIn): Wire => ({
  plan_id: p.id,
  expires_in_minutes: p.expires === undefined ? 30 : p.expires,
  title: p.title,
  who: { total: p.total, eligible: p.eligible, excluded: p.excluded ?? [], basis: { code: p.basis.code, params: p.basis.params ?? {} } },
  says: p.says ? [{ language: "en", channel: p.says.channel, text: p.says.text }] : [],
  when: { start: p.when.start, from: p.when.from, to: p.when.to, days: [...p.when.days], pace_per_hour: p.when.pace },
  finds_out: p.finds.map(([key, text]) => ({ key, text })),
  cost: { minutes: p.minutes, minutes_included: 60, minutes_used: 8, rupees: null },
  primary: p.primary ?? "start",
  alternatives: p.alternatives ?? [],
  blockers: (p.blockers ?? []).map((code) => ({ code })),
});

export const WIRE_PLANS: Record<string, Wire> = {
  silk_call: planWire({
    id: "plan-silk-call",
    title: "Ask last month’s silk buyers how they liked it",
    basis: { code: "bought_calls", params: { days: 30, count: 42 } },
    total: 42,
    eligible: 38,
    excluded: [{ code: "no_consent", count: 4 }],
    says: { channel: "call", text: `Namaskaram Lakshmi garu, this is the AI assistant of ${MOCK_BUSINESS}. How did you like the Kanchipuram saree you bought last month?` },
    when: { start: "tomorrow", from: "10:00", to: "18:00", days: MON_SAT, pace: 7 },
    finds: [["liked_it", "Did they like it"], ["would_change", "Anything they would change"], ["new_arrivals", "Would they like to see new arrivals"]],
    minutes: 34,
    alternatives: [{ kind: "whatsapp", count: 3 }],
  }),
  /** The WhatsApp version of the plan above (`POST /jobs/plan {as: "whatsapp", plan_id}`). */
  silk_whatsapp: planWire({
    id: "plan-silk-whatsapp",
    title: "Ask last month’s silk buyers how they liked it, on WhatsApp",
    basis: { code: "consented_messages", params: { days: 30, count: 4 } },
    total: 4,
    eligible: 3,
    excluded: [{ code: "stopped", count: 1 }],
    says: { channel: "whatsapp", text: `Namaskaram Lakshmi garu, this is the AI assistant of ${MOCK_BUSINESS}. How did you like the Kanchipuram saree you bought last month? Reply STOP to stop these messages.` },
    when: { start: "tomorrow", from: "10:00", to: "18:00", days: MON_SAT, pace: 20 },
    finds: [["liked_it", "Did they like it"], ["would_change", "Anything they would change"]],
    minutes: 0,
  }),
  missed: planWire({
    id: "plan-missed",
    title: "Call back yesterday’s missed calls",
    basis: { code: "enquired_calls", params: { days: 30, count: 6 } },
    total: 6,
    eligible: 6,
    says: { channel: "call", text: `Namaskaram Ravi garu, this is the AI assistant of ${MOCK_BUSINESS}. We saw your call yesterday. How can we help you?` },
    when: { start: "today", from: "10:00", to: "18:00", days: MON_SAT, pace: 6 },
    finds: [["what_they_wanted", "What they wanted"], ["visit_interest", "Would they like to visit the store"]],
    minutes: 5,
  }),
  /** "I could not tell who you mean": a 200 with a blocker, never a 422. */
  unclear: planWire({ id: "plan-unclear", title: "", basis: { code: "none", params: { days: 30, count: 0 } }, total: 0, eligible: 0, when: { start: "today", from: "10:00", to: "18:00", days: [], pace: 0 }, finds: [], minutes: 0, blockers: ["unclear_who"], expires: null }),
  speed_to_lead: planWire({
    id: "plan-kind-speed_to_lead",
    title: "Call every new enquiry right away",
    basis: { code: "enquired_calls", params: { days: 30, count: 14 } },
    total: 14,
    eligible: 14,
    says: { channel: "call", text: `Namaskaram, this is the AI assistant of ${MOCK_BUSINESS}. Thank you for asking about our silk sarees. Which occasion is it for?` },
    when: { start: "today", from: "10:00", to: "18:00", days: ALL_DAYS, pace: 10 },
    finds: [["occasion", "Which occasion it is for"], ["budget", "Their budget"], ["visit_interest", "Would they like to visit the store"]],
    minutes: 18,
  }),
  followups: planWire({
    id: "plan-kind-followups",
    title: "Follow up on price questions and promises",
    basis: { code: "consented_messages", params: { days: 30, count: 5 } },
    total: 5,
    eligible: 5,
    says: { channel: "whatsapp", text: `Namaskaram Sravani garu, this is the AI assistant of ${MOCK_BUSINESS}. The green Kanchipuram saree is ₹18,500. Shall I keep it for you? Reply STOP to stop these messages.` },
    when: { start: "tomorrow", from: "10:00", to: "18:00", days: MON_SAT, pace: 20 },
    finds: [["still_interested", "Are they still interested"], ["visit_interest", "Would they like to visit the store"]],
    minutes: 0,
  }),
  store_visits: planWire({
    id: "plan-kind-store_visits",
    title: "Book and remind store visits",
    basis: { code: "consented_messages", params: { days: 30, count: 3 } },
    total: 3,
    eligible: 3,
    says: { channel: "whatsapp", text: `Reminder from the AI assistant of ${MOCK_BUSINESS}: tomorrow 11 am, Begum Bazaar. See you! Reply STOP to stop these messages.` },
    when: { start: "today", from: "10:00", to: "18:00", days: ALL_DAYS, pace: 20 },
    finds: [["coming", "Are they coming"]],
    minutes: 0,
  }),
  offers: planWire({
    id: "plan-kind-offers",
    title: "Send the wedding-season offer to customers who said yes",
    basis: { code: "said_yes_offer", params: { days: 30, count: 38 } },
    total: 38,
    eligible: 38,
    says: { channel: "whatsapp", text: `This is the AI assistant of ${MOCK_BUSINESS}. Wedding season offer: free blouse stitching on silk sarees till 30 November. Reply STOP to stop these messages.` },
    when: { start: "after_ok", from: "10:00", to: "18:00", days: MON_SAT, pace: 20 },
    finds: [["interested", "Are they interested"]],
    minutes: 0,
  }),
};

/** Plans the demo does not show: a named list, a plan that cannot start for want of a number or of free minutes, and "send those 3 a WhatsApp instead" as the first choice. */
export const WIRE_PLAN_VARIANTS: Record<string, Wire> = {
  named_list: planWire({
    id: "plan-named",
    title: "Call Ravi and Padma about the visit",
    basis: { code: "named_list", params: { days: 30, count: 2 } },
    total: 2,
    eligible: 2,
    says: { channel: "call", text: `Namaskaram, this is the AI assistant of ${MOCK_BUSINESS}. Your visit is tomorrow at 11 am.` },
    when: { start: "tomorrow", from: "09:00", to: "21:00", days: MON_SAT, pace: 5 },
    finds: [["coming", "Are they coming"]],
    minutes: 2,
  }),
  whatsapp_first: planWire({
    id: "plan-whatsapp-first",
    title: "Ask last month’s silk buyers how they liked it",
    basis: { code: "bought_calls", params: { days: 30, count: 10 } },
    total: 10,
    eligible: 0,
    excluded: [{ code: "no_consent", count: 7 }, { code: "no_proof_of_request", count: 3 }],
    says: { channel: "call", text: `Namaskaram, this is the AI assistant of ${MOCK_BUSINESS}. How did you like the saree?` },
    when: { start: "tomorrow", from: "09:30", to: "19:00", days: MON_SAT, pace: 7 },
    finds: [],
    minutes: 0,
    primary: "send_whatsapp",
    alternatives: [{ kind: "whatsapp", count: 6 }],
  }),
  no_number: planWire({ id: "plan-no-number", title: "Call every new enquiry right away", basis: { code: "enquired_calls", params: { days: 30, count: 3 } }, total: 3, eligible: 3, when: { start: "today", from: "10:00", to: "18:00", days: ALL_DAYS, pace: 10 }, finds: [], minutes: 3, blockers: ["no_number"] }),
  minutes_used: planWire({ id: "plan-minutes-used", title: "Call every new enquiry right away", basis: { code: "enquired_calls", params: { days: 30, count: 3 } }, total: 3, eligible: 3, when: { start: "today", from: "10:00", to: "18:00", days: ALL_DAYS, pace: 10 }, finds: [], minutes: 3, blockers: ["minutes_used"] }),
};

/** `GET /jobs/suggestions`: the saree shop's four (mock sheet 03). */
const sug = (kind: string, why: { code: string; params: Wire }, preview: string, title: { code: string } | null = null, ready = true): Wire => ({ kind, title, why, preview, ready });
export const WIRE_SUGGESTIONS_TEXTILES: Wire = {
  heading: "saree",
  items: [
    sug("speed_to_lead", { code: "enquiries_waited", params: { enquiries: 14, waited: 9 } }, "Thank you for asking about our silk sarees. Which occasion is it for?"),
    sug("followups", { code: "price_waiting", params: { n: 5 } }, "Namaskaram Sravani garu, the green Kanchipuram saree is ₹18,500. Shall I keep it for you?"),
    sug("store_visits", { code: "visits_said", params: { n: 3 } }, `Reminder: tomorrow 11 am, ${MOCK_BUSINESS}, Begum Bazaar. See you!`),
    sug("offers", { code: "offer_yes", params: { n: 38 } }, "Wedding season offer: free blouse stitching on silk sarees till 30 November.", { code: "offers_wedding" }),
  ],
};
/** The plain three for every other business type (no heading). */
export const WIRE_SUGGESTIONS_GENERIC: Wire = {
  items: [
    sug("speed_to_lead", { code: "generic_speed", params: {} }, "Thank you for your enquiry. What can we help you with?"),
    sug("followups", { code: "generic_followups", params: {} }, "Hello, we are following up on your question. Can we help you with anything more?"),
    sug("store_visits", { code: "generic_visits", params: {} }, "Reminder: your visit is tomorrow. See you!"),
  ],
};
/** A suggestion whose prerequisite is missing: `ready: false` and `why` says what (no Start). */
export const WIRE_SUGGESTIONS_NOT_READY: Wire = { items: [sug("speed_to_lead", { code: "no_number", params: {} }, "Thank you for your enquiry.", null, false), sug("followups", { code: "no_whatsapp", params: {} }, "Hello, we are following up.", null, false)] };

/* ---- the Do-Not-Call list (section 6) ---- */
const dncId = (n: number) => `77777777-7777-4777-8777-7777777777${String(n).padStart(2, "0")}`;
type DncIn = { n: number; masked: string; reason: string; at: string; by?: string | null; lifted?: { at: string; how: string }[] };
/** An entry on the list is `state: "active"` with no history; one that came off the list (`lifted`) is only sent for `?include=lifted`, with its history. */
const dnc = (e: DncIn): Wire => ({ id: dncId(e.n), phone_masked: e.masked, reason: e.reason, at: e.at, state: e.lifted ? "lifted" : "active", added_by: e.by ?? null, history: e.lifted ?? [] });
export const WIRE_DNC: readonly Wire[] = [
  dnc({ n: 1, masked: "+91 98480 ••• 21", reason: "stop_whatsapp", at: "2026-11-12T08:10:00Z" }),
  dnc({ n: 2, masked: "+91 99890 ••• 07", reason: "asked_on_call", at: "2026-11-09T11:40:00Z" }),
  dnc({ n: 3, masked: "+91 90000 ••• 64", reason: "added_by_owner", at: "2026-11-02T05:05:00Z", by: "Ramesh" }),
  dnc({ n: 4, masked: "+91 70937 ••• 18", reason: "stop_whatsapp", at: "2026-10-28T13:30:00Z" }),
  // a legal or complaint rule: it stays, and there is no Remove
  dnc({ n: 5, masked: "+91 63000 ••• 90", reason: "other", at: "2026-10-20T09:00:00Z" }),
];
/** `GET /do-not-call?include=lifted` also returns the numbers that came off the list (the customer asked for contact again), each with its history: every closed `how`. */
export const WIRE_DNC_LIFTED: readonly Wire[] = [
  dnc({ n: 6, masked: "+91 88850 ••• 33", reason: "stop_whatsapp", at: "2026-10-12T10:00:00Z", lifted: [{ at: "2026-11-05T09:30:00Z", how: "customer_message" }] }),
  dnc({ n: 7, masked: "+91 94400 ••• 52", reason: "asked_on_call", at: "2026-10-03T07:20:00Z", lifted: [{ at: "2026-11-06T10:15:00Z", how: "owner_recorded_yes" }] }),
  dnc({ n: 8, masked: "+91 81250 ••• 76", reason: "stop_whatsapp", at: "2026-09-21T12:00:00Z", lifted: [{ at: "2026-11-08T16:45:00Z", how: "form_tick" }] }),
];
/** The mock shows 128 numbers in all (the mock's own count), the ones above being the newest. */
export const MOCK_DNC_COUNT = 128;
export const wireDncPage = (items: readonly Wire[] = WIRE_DNC): Wire => ({ items: [...items], count: MOCK_DNC_COUNT, next_cursor: null });
