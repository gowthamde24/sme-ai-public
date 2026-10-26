import { formatRupeesShort } from "@/lib/money";

import { TASK_LANGS, TASK_TEMPLATES, type PlanOut, type Progress, type ReportOut, type ReportRow, type TaskContactOut, type TaskLang, type TaskOut, type TaskStatus, type TaskTemplateId, type TemplateOut, type TemplatesOut, type TranscriptLine } from "./types";

/**
 * The test mode of "Ask Vijaya to do it" (TASK_SCREENS=mock; night 4, job DR part B): a deterministic fake of the tasks API for review and the pictures. Nothing is sent, dialled or stored on a server. The browser keeps ONE small cookie
 * (lib/tasks/source.ts) with the few facts of each task below (`MockTask`); everything else is DERIVED from them and the clock: the plan (a template chosen by keywords in English, Telugu, Hindi, Kannada, Tamil and Malayalam, and twelve
 * synthetic people with names made from fixed lists), the progress (the fake dialler finishes one person every two seconds after the approval), the report (a fixed table; a supplier price enquiry gets "Cheapest: ..." as the short answer). Pure:
 * no cookie, no clock of its own (the caller gives `now`, in milliseconds). The wording the mock makes is plain English apart from the short answer, and every result says `simulated`.
 */
export type MockStatus = "needs_answer" | "planned" | "active" | "paused" | "cancelled";
/** Everything a mock task keeps. `el` = milliseconds the fake dialler has run before `si`; `si` = when it last started (null while it is not running). */
export type MockTask = {
  id: string;
  /** The instruction, cut to 200 characters (the cookie is small). */
  ins: string;
  lang: TaskLang;
  tpl: TaskTemplateId;
  st: MockStatus;
  /** Created, approved (ms since 1970). */
  ca: number;
  ap: number | null;
  el: number;
  si: number | null;
  /** The people left out (their numbers in the list, 0 to 11). */
  ex: number[];
  /** The spending cap in paise the owner set, or null for the default (the estimate plus 20 percent). */
  cap: number | null;
  pr: "cap" | "owner" | null;
  /** The answer to the one question, if it was asked. */
  ans: string | null;
};

export const MS_PER_CONTACT = 2000;
const PEOPLE = 12;
const CALL_PAISE = 250;
const MESSAGE_PAISE = 50;
export const INS_KEEP = 200;

function fnv(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}
const hex = (n: number, len: number): string => n.toString(16).padStart(len, "0").slice(-len);

// ---- the template, found by keywords ---------------------------------------------------------------------------------------
const KEYWORDS: readonly (readonly [TaskTemplateId, RegExp])[] = [
  ["supplier_price_enquiry", /supplier|price|rate\b|quotation|per bag|ధర|సరఫరా|भाव|सप्लायर|कीमत|दाम|ಬೆಲೆ|ಪೂರೈಕೆ|விலை|വില/i],
  ["payment_reminder", /payment|pending|\bdues?\b|outstanding|balance|బకాయి|చెల్లింపు|बकाया|भुगतान|पेमेंट|ಬಾಕಿ|ಪಾವತಿ|நிலுவை|பணம்|കുടിശ്ശിക|പേയ്മെന്റ്/i],
  ["confirm_appointments", /appointment|confirm|reschedule|అపాయింట్|నిర్ధారణ|अपॉइंटमेंट|पुष्टि|ಅಪಾಯಿಂಟ್|ದೃಢ|நியமனம்|உறுதி|അപ്പോയിന്റ്|സ്ഥിരീകരി/i],
  ["collect_feedback", /feedback|review|how was|అభిప్రాయం|ఫీడ్‌బ్యాక్|फीडबैक|प्रतिक्रिया|ಅಭಿಪ್ರಾಯ|ಫೀಡ್‌ಬ್ಯಾಕ್|கருத்து|അഭിപ്രായം/i],
  ["offer_invite", /offer|invite|event|festival|\bsale\b|discount|ఆఫర్|ఆహ్వానం|ऑफर|आमंत्रण|न्योता|ಆಫರ್|ಆಹ್ವಾನ|சலுகை|அழைப்பு|ഓഫർ|ക്ഷണം/i],
  ["reengage_old_leads", /old lead|re-?engage|inactive|went cold|not bought|last year|పాత|पुराने|पुराना|ಹಳೆಯ|பழைய|പഴയ/i],
  ["call_new_leads", /new lead|new enquir|enquiries|call new|today'?s lead|కొత్త|नए|नई|ಹೊಸ|புதிய|പുതിയ/i],
];
export function templateOf(text: string): TaskTemplateId {
  for (const [id, re] of KEYWORDS) if (re.test(text)) return id;
  return "custom";
}

/** The language of the customers when the owner did not choose: the script of the instruction. */
export function detectLanguage(text: string): TaskLang {
  const count = (re: RegExp) => (text.match(re) ?? []).length;
  const scores: [TaskLang, number][] = [["te", count(/[ఀ-౿]/g)], ["hi", count(/[ऀ-ॿ]/g)], ["kn", count(/[ಀ-೿]/g)], ["ta", count(/[஀-௿]/g)], ["ml", count(/[ഀ-ൿ]/g)]];
  const best = scores.reduce((a, b) => (b[1] > a[1] ? b : a));
  return best[1] > 0 ? best[0] : "en";
}

export function newMockTask(id: string, instruction: string, language: TaskLang | null, now: number): MockTask {
  const ins = instruction.trim().slice(0, INS_KEEP);
  const tpl = templateOf(ins);
  return { id, ins, lang: language ?? detectLanguage(ins), tpl, st: tpl === "custom" ? "needs_answer" : "planned", ca: now, ap: null, el: 0, si: null, ex: [], cap: null, pr: null, ans: null };
}

/** Answering the one question: the template is looked for again in the instruction and the answer together. Still nothing found = planned with nobody (the "nobody found" case). */
export function answerMockTask(m: MockTask, answer: string): MockTask {
  const ans = answer.trim().slice(0, 120);
  return { ...m, ans, tpl: templateOf(`${m.ins} ${ans}`), st: "planned" };
}

// ---- the people -------------------------------------------------------------------------------------------------------------
const FIRST = ["Ravi", "Lakshmi", "Suresh", "Anitha", "Mahesh", "Kavitha", "Naresh", "Padma", "Ramesh", "Swathi", "Venkat", "Divya"];
const LAST = ["Kumar", "Reddy", "Naidu", "Rao", "Sharma", "Prasad", "Goud", "Varma", "Chowdary", "Patel", "Singh", "Menon"];
const SHOPS = ["Sri Venkateswara Traders", "Lakshmi Cement Depot", "Balaji Building Supplies", "Anjaneya Agencies", "Sai Ram Hardware", "Krishna Traders", "Ganesh Materials", "Durga Enterprises", "Padmavathi Stores", "Vasavi Distributors", "Hanuman Suppliers", "Sri Rama Traders"];
const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export type MockPerson = { index: number; contactId: string; rowId: string; name: string; last4: string };
export function peopleOf(m: Pick<MockTask, "tpl">): MockPerson[] {
  if (m.tpl === "custom") return [];
  const out: MockPerson[] = [];
  for (let i = 0; i < PEOPLE; i++) {
    out.push({
      index: i,
      contactId: `c0ffee00-0000-4000-8000-${hex(i + 1, 12)}`,
      rowId: `7a5c0000-0000-4000-8000-${hex(i + 1, 12)}`,
      name: m.tpl === "supplier_price_enquiry" ? SHOPS[i] : `${FIRST[i]} ${LAST[(i * 5 + 3) % LAST.length]}`,
      last4: String(1000 + (fnv(`phone:${i}`) % 9000)),
    });
  }
  return out;
}
/** Which person a contact id belongs to (null for an id the mock never made). */
export function indexOfContact(contactId: string): number | null {
  const m = /^c0ffee00-0000-4000-8000-([0-9a-f]{12})$/i.exec(contactId);
  if (!m) return null;
  const n = parseInt(m[1], 16) - 1;
  return n >= 0 && n < PEOPLE ? n : null;
}

// ---- what each template plans -----------------------------------------------------------------------------------------------
type Recipe = { label: string; channel: "call" | "whatsapp" | "both"; goal: string; questions: { key: string; text: string; type: "text" | "amount" | "date" | "yesno" }[]; message: string | null; promotional: boolean; example: string };
const RECIPES: Record<Exclude<TaskTemplateId, "custom">, Recipe> = {
  call_new_leads: { label: "Call new leads", channel: "call", goal: "Call the people who asked about us in the last days and find out what they need.", questions: [{ key: "interested", text: "Are you still looking for this?", type: "yesno" }, { key: "best_time", text: "When is a good time to talk?", type: "text" }], message: null, promotional: false, example: "Call everyone who enquired this week and ask what they need and when to call again." },
  reengage_old_leads: { label: "Re-engage old leads", channel: "both", goal: "Ask the people who went quiet if they still want to buy.", questions: [{ key: "still_interested", text: "Are you still interested?", type: "yesno" }, { key: "reason", text: "What stopped you?", type: "text" }], message: "Hello, we spoke some time ago. Are you still looking? Reply YES and we will call you.", promotional: false, example: "Call the leads that went quiet last month and ask if they are still interested." },
  confirm_appointments: { label: "Confirm appointments", channel: "both", goal: "Confirm tomorrow's visits and offer another time to anyone who cannot come.", questions: [{ key: "coming", text: "Can you come as planned?", type: "yesno" }, { key: "new_time", text: "If not, what time suits you?", type: "text" }], message: "Hello, this is a reminder of your visit tomorrow. Reply YES to confirm.", promotional: false, example: "Confirm tomorrow's appointments and offer another time to anyone who cannot come." },
  collect_feedback: { label: "Collect feedback", channel: "both", goal: "Ask customers how their last order or visit went.", questions: [{ key: "rating", text: "How was it, from 1 to 5?", type: "text" }, { key: "comment", text: "Anything we should do better?", type: "text" }], message: "Thank you for your order. How was it? Reply with a number from 1 to 5.", promotional: false, example: "Ask last week's customers how it went and note anything they want changed." },
  payment_reminder: { label: "Payment reminder", channel: "both", goal: "Remind the people with a pending payment, politely, and note when they will pay.", questions: [{ key: "pay_date", text: "When will you be able to pay?", type: "date" }], message: "Hello, a gentle reminder about your pending payment. Please tell us when you can pay.", promotional: false, example: "Remind customers with pending payments and ask when they will pay." },
  supplier_price_enquiry: { label: "Supplier price enquiry", channel: "call", goal: "Ask each supplier today's price and when they can deliver.", questions: [{ key: "price_per_bag", text: "What is your price per bag today?", type: "amount" }, { key: "delivery_day", text: "Which day can you deliver?", type: "text" }], message: null, promotional: false, example: "Call my cement suppliers, ask the price per bag and the delivery day, and tell me the cheapest." },
  offer_invite: { label: "Offer or event invite", channel: "whatsapp", goal: "Invite the people who agreed to offers. WhatsApp only for now.", questions: [], message: "Hello, you are invited to our festival offer. Reply YES for details.", promotional: true, example: "Invite customers who agreed to offers to our festival sale on Saturday." },
};
export const RECIPE_IDS = Object.keys(RECIPES) as Exclude<TaskTemplateId, "custom">[];

export function mockTemplates(): TemplatesOut {
  return {
    templates: RECIPE_IDS.map((id): TemplateOut => ({ id, label: RECIPES[id].label, channel_default: RECIPES[id].channel, needs_pack: id === "payment_reminder" ? "not education" : null, promotional: RECIPES[id].promotional, example_instruction: RECIPES[id].example })),
  };
}

// ---- the plan, the progress and the report, derived ---------------------------------------------------------------------------
/** The hash the approval must send back: it changes when the instruction, the language, the template or the people left out change. */
export function planSha(m: MockTask): string {
  const base = `${m.id}|${m.ins}|${m.lang}|${m.tpl}|${m.ans ?? ""}|${[...m.ex].sort((a, b) => a - b).join(",")}`;
  let out = "";
  for (let i = 0; i < 8; i++) out += hex(fnv(`${i}:${base}`), 8);
  return out;
}

function includedOf(m: MockTask): MockPerson[] {
  const out = new Set(m.ex);
  return peopleOf(m).filter((p) => !out.has(p.index));
}
function perPerson(m: MockTask): { calls: number; messages: number; paise: number } {
  if (m.tpl === "custom") return { calls: 0, messages: 0, paise: 0 };
  const ch = RECIPES[m.tpl].channel;
  const calls = ch === "whatsapp" ? 0 : 1;
  const messages = ch === "call" ? 0 : 1;
  return { calls, messages, paise: calls * CALL_PAISE + messages * MESSAGE_PAISE };
}
function estimateOf(m: MockTask) {
  const n = includedOf(m).length;
  const per = perPerson(m);
  return { contacts: n, calls: n * per.calls, messages: n * per.messages, minutes: n * per.calls * 2, cost_paise: n * per.paise, basis: "fake rates" };
}
const defaultCap = (costPaise: number): number => Math.round(costPaise * 1.2);

function indiaDate(ms: number): string {
  return new Date(ms + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
}
const asked: Record<TaskLang, string> = {
  en: "Who should Vijaya contact, and about what?",
  te: "విజయ ఎవరిని సంప్రదించాలి, దేని గురించి?",
  hi: "विजया किससे संपर्क करे, और किस बारे में?",
  kn: "ವಿಜಯ ಯಾರನ್ನು ಸಂಪರ್ಕಿಸಬೇಕು, ಯಾವುದರ ಬಗ್ಗೆ?",
  ta: "Who should Vijaya contact, and about what?",
  ml: "Who should Vijaya contact, and about what?",
};

function planOf(m: MockTask): PlanOut | null {
  if (m.st === "needs_answer") return null;
  const people = peopleOf(m);
  if (m.tpl === "custom") {
    return { channel: "call", goal: m.ins, questions: [], script_notes: "", message_text: null, window: { date: indiaDate(m.ca), from_minute: 600, to_minute: 1140 }, follow_up: { kind: "none", after_hours: 24 }, contacts_total: 0, contacts_sample: [], unmatched: [], notes: ["Nobody in your contacts fits this yet. Say who, or give a list."] };
  }
  const r = RECIPES[m.tpl];
  const notes = r.promotional ? ["Promotional calls are off: WhatsApp only. Only people who agreed to offers are included."] : [];
  return {
    channel: r.channel,
    goal: r.goal,
    questions: r.questions,
    script_notes: "",
    message_text: r.message,
    window: { date: indiaDate(m.ca), from_minute: 600, to_minute: 1140 },
    follow_up: { kind: "whatsapp_summary", after_hours: 24 },
    contacts_total: people.length,
    contacts_sample: people.slice(0, 5).map((p) => ({ contact_id: p.contactId, name: p.name })),
    unmatched: [],
    notes,
  };
}

type Verdict = "positive" | "negative" | "unclear" | "no_answer" | "failed" | "skipped";
function verdictOf(m: MockTask, p: MockPerson): Verdict {
  const r = fnv(`${m.id}:${p.index}`) % 100;
  if (r < 4) return "skipped";
  if (r < 8) return "failed";
  if (r < 22) return "no_answer";
  if (r < 30) return "unclear";
  if (r < 44) return "negative";
  return "positive";
}

type Run = { n: number; finished: number; capped: boolean; running: boolean; over: boolean; activeMs: number };
function runOf(m: MockTask, now: number): Run {
  const included = includedOf(m);
  const n = included.length;
  const per = perPerson(m).paise;
  const cap = m.cap ?? defaultCap(estimateOf(m).cost_paise);
  const activeMs = m.st === "active" && m.si !== null ? m.el + Math.max(0, now - m.si) : m.el;
  let finished = Math.min(n, Math.floor(activeMs / MS_PER_CONTACT));
  let capped = false;
  if (per > 0 && m.st === "active") {
    const room = Math.floor(cap / per);
    if (room < n && finished >= room) {
      finished = Math.max(0, room);
      capped = true;
    }
  }
  const over = n > 0 && finished >= n;
  return { n, finished, capped, running: m.st === "active" && !capped && !over, over, activeMs };
}

function statusOf(m: MockTask, r: Run): TaskStatus {
  if (m.st === "needs_answer" || m.st === "planned" || m.st === "cancelled" || m.st === "paused") return m.st;
  if (r.capped) return "paused";
  if (r.over) return "done";
  return r.activeMs < 1000 ? "approved" : "running";
}

function progressOf(m: MockTask, r: Run): Progress {
  const included = includedOf(m);
  const done = included.slice(0, r.finished).map((p) => verdictOf(m, p));
  const count = (f: (v: Verdict) => boolean) => done.filter(f).length;
  const failed = count((v) => v === "failed");
  const skipped = count((v) => v === "skipped");
  const doneN = r.finished - failed - skipped;
  const positive = count((v) => v === "positive");
  const reached = count((v) => v === "positive" || v === "negative" || v === "unclear");
  const waitingStatus = m.st === "planned" || m.st === "needs_answer";
  const inProgress = r.running && r.finished < r.n ? 1 : 0;
  return { total: peopleOf(m).length, excluded: m.ex.length, waiting: waitingStatus ? r.n : Math.max(0, r.n - r.finished - inProgress), in_progress: inProgress, done: doneN, failed, skipped, reached, positive };
}

export function deriveTask(m: MockTask, now: number): TaskOut {
  const r = runOf(m, now);
  const status = statusOf(m, r);
  const est = estimateOf(m);
  const plan = planOf(m);
  const pause = status === "paused" ? (r.capped ? "cap" : (m.pr ?? "owner")) : null;
  const per = perPerson(m).paise;
  const approved = m.ap !== null && m.st !== "planned" && m.st !== "needs_answer";
  return {
    id: m.id,
    status,
    instruction: m.ins,
    language: m.lang,
    template: m.tpl,
    question: status === "needs_answer" ? asked[m.lang] : null,
    plan,
    estimate: plan ? est : null,
    cap_paise: plan ? (m.cap ?? defaultCap(est.cost_paise)) : null,
    spent_paise: r.finished * per,
    pause_reason: pause,
    progress: progressOf(m, r),
    plan_sha256: plan ? planSha(m) : null,
    simulated: true,
    wording: "draft",
    created_at: new Date(m.ca).toISOString(),
    approved_at: approved && m.ap !== null ? new Date(m.ap).toISOString() : null,
    finished_at: status === "done" && m.si !== null ? new Date(m.si + Math.max(0, r.n * MS_PER_CONTACT - m.el)).toISOString() : status === "cancelled" ? new Date(m.ap ?? m.ca).toISOString() : null,
  };
}

/** After any action: a task that has run into its cap is stored as paused for the cap, so a later raise of the cap does not make it run on by itself (it waits for Resume, like the real one). */
export function settle(m: MockTask, now: number): MockTask {
  if (m.st !== "active") return m;
  const r = runOf(m, now);
  if (r.capped) return { ...m, st: "paused", pr: "cap", el: r.finished * MS_PER_CONTACT, si: null };
  return m;
}

/** The mock task after one of the owner's moves, or null when the move is not allowed in its state. */
export function moveMock(m: MockTask, verb: "pause" | "resume" | "cancel" | "run", now: number): MockTask | null {
  const s = settle(m, now);
  const r = runOf(s, now);
  if (verb === "cancel") {
    if (s.st === "cancelled" || (s.st === "active" && r.over)) return null;
    return { ...s, st: "cancelled", el: s.st === "active" ? Math.min(r.activeMs, r.n * MS_PER_CONTACT) : s.el, si: null, pr: null };
  }
  if (verb === "pause") return s.st === "active" && !r.over ? { ...s, st: "paused", pr: "owner", el: r.activeMs, si: null } : null;
  if (verb === "resume") return s.st === "paused" ? { ...s, st: "active", pr: null, si: now } : null;
  return s.st === "active" || s.st === "paused" ? s : null;
}

export function approveMock(m: MockTask, now: number, capPaise: number | null): MockTask {
  return { ...m, st: "active", ap: now, el: 0, si: now, cap: capPaise ?? m.cap };
}

export function deriveContacts(m: MockTask, now: number, status: string | null = null): TaskContactOut[] {
  if (m.st === "needs_answer") return [];
  const r = runOf(m, now);
  const out = new Set(m.ex);
  const included = includedOf(m);
  const rank = new Map(included.map((p, i) => [p.index, i]));
  const rows = peopleOf(m).map((p): TaskContactOut => {
    const i = rank.get(p.index);
    const excluded = out.has(p.index);
    const finished = i !== undefined && i < r.finished;
    const v = finished ? verdictOf(m, p) : null;
    const st: TaskContactOut["status"] = excluded ? "excluded" : v === "failed" ? "failed" : v === "skipped" ? "skipped" : finished ? "done" : i === r.finished && r.running ? "in_progress" : "waiting";
    return { id: p.rowId, contact_id: p.contactId, name: p.name, phone_last4: p.last4, status: st, skip_reason: v === "skipped" ? "stopped_messages" : null, outcome: v, outcome_category: v === "positive" ? "interested" : v === "negative" ? "not_interested" : v === "unclear" ? "unclear" : null, captured: finished ? capturedOf(m, p, v) : null, simulated: true };
  });
  return status ? rows.filter((x) => x.status === status) : rows;
}

function capturedOf(m: MockTask, p: MockPerson, v: Verdict | null): Record<string, string | number | boolean | null> | null {
  if (v !== "positive") return null;
  const h = fnv(`cap:${m.id}:${p.index}`);
  if (m.tpl === "supplier_price_enquiry") return { price_per_bag: 36500 + (h % 40) * 100, delivery_day: DAYS[(h >> 8) % DAYS.length] };
  if (m.tpl === "payment_reminder") return { pay_date: `2026-11-${String(1 + (h % 27)).padStart(2, "0")}` };
  if (m.tpl === "call_new_leads") return { interested: "yes", best_time: ["morning", "afternoon", "evening"][h % 3] };
  if (m.tpl === "confirm_appointments") return { coming: "yes" };
  if (m.tpl === "collect_feedback") return { rating: 3 + (h % 3) };
  if (m.tpl === "reengage_old_leads") return { still_interested: "yes" };
  return null;
}

function transcriptOf(m: MockTask, p: MockPerson, v: Verdict): TranscriptLine[] | null {
  if (v === "skipped" || v === "no_answer" || v === "failed") return null;
  const r = m.tpl === "custom" ? null : RECIPES[m.tpl];
  if (!r || r.channel === "whatsapp") return null;
  const c = capturedOf(m, p, v);
  const lines: TranscriptLine[] = [{ who: "assistant", text: `Hello ${p.name}, I am Vijaya, an AI assistant calling for the shop. ${r.goal}` }];
  if (r.questions[0]) lines.push({ who: "assistant", text: r.questions[0].text });
  if (v === "positive") {
    lines.push({ who: "contact", text: m.tpl === "supplier_price_enquiry" && c ? `It is ${formatRupeesShort(Number(c.price_per_bag))} a bag.` : "Yes, that is fine." });
    if (m.tpl === "supplier_price_enquiry" && c) lines.push({ who: "assistant", text: r.questions[1].text }, { who: "contact", text: `${String(c.delivery_day)}.` });
  } else if (v === "negative") lines.push({ who: "contact", text: "No, not now." });
  else lines.push({ who: "contact", text: "Hmm, I am not sure. Can you call later?" });
  lines.push({ who: "assistant", text: "Thank you for your time." });
  return lines;
}

const COUNT_WORDS: Record<"en" | "te" | "hi" | "kn", (reached: number, n: number, positive: number, negative: number, none: number) => string> = {
  en: (r, n, p, ng, none) => `${r} of ${n} reached. ${p} interested, ${ng} said no, ${none} did not answer.`,
  te: (r, n, p, ng, none) => `${n} మందిలో ${r} మందితో మాట్లాడాం. ${p} మంది ఆసక్తి చూపారు, ${ng} మంది వద్దన్నారు, ${none} మంది ఫోన్ ఎత్తలేదు.`,
  hi: (r, n, p, ng, none) => `${n} में से ${r} से बात हुई। ${p} ने रुचि दिखाई, ${ng} ने मना किया, ${none} ने फोन नहीं उठाया।`,
  kn: (r, n, p, ng, none) => `${n} ಜನರಲ್ಲಿ ${r} ಜನರ ಜೊತೆ ಮಾತಾಡಿದೆವು. ${p} ಜನ ಆಸಕ್ತಿ ತೋರಿದರು, ${ng} ಜನ ಬೇಡ ಅಂದರು, ${none} ಜನ ಕರೆ ಎತ್ತಲಿಲ್ಲ.`,
};
const CHEAPEST_WORDS: Record<"en" | "te" | "hi" | "kn", (name: string, price: string, day: string) => string> = {
  en: (n, p, d) => `Cheapest: ${n} ${p}/bag, delivery ${d}`,
  te: (n, p, d) => `తక్కువ ధర: ${n} ${p}/బస్తా, డెలివరీ ${d}`,
  hi: (n, p, d) => `सबसे सस्ता: ${n} ${p}/बैग, डिलीवरी ${d}`,
  kn: (n, p, d) => `ಅತಿ ಕಡಿಮೆ ಬೆಲೆ: ${n} ${p}/ಚೀಲ, ಡೆಲಿವರಿ ${d}`,
};

export function deriveReport(m: MockTask, now: number): ReportOut | null {
  if (m.st === "needs_answer" || m.st === "planned") return null;
  const r = runOf(m, now);
  const status = statusOf(m, r);
  const included = includedOf(m);
  const rows: ReportRow[] = included.slice(0, r.finished).map((p) => {
    const v = verdictOf(m, p);
    const rec = m.tpl === "custom" ? null : RECIPES[m.tpl];
    const messaged = rec !== null && rec.channel !== "call";
    return { contact_id: p.contactId, name: p.name, phone_last4: p.last4, outcome: v, category: v === "positive" ? "interested" : v === "negative" ? "not_interested" : v === "unclear" ? "unclear" : null, captured: capturedOf(m, p, v), transcript: transcriptOf(m, p, v), recording_url: null, simulated: true, message_status: messaged && v !== "skipped" ? (fnv(`ms:${m.id}:${p.index}`) % 5 === 0 ? "needs_approval" : "queued") : v === "skipped" ? "blocked" : null };
  });
  const verdicts = rows.map((x) => x.outcome);
  const num = (k: string) => verdicts.filter((v) => v === k).length;
  const positive = num("positive");
  const negative = num("negative");
  const unclear = num("unclear");
  const lang = (["en", "te", "hi", "kn"] as const).find((l) => l === m.lang) ?? "en";
  let short = COUNT_WORDS[lang](positive + negative + unclear, r.n, positive, negative, num("no_answer"));
  let kind: ReportOut["short_answer_kind"] = "counts";
  if (m.tpl === "supplier_price_enquiry") {
    const priced = rows.filter((x) => typeof x.captured?.price_per_bag === "number").sort((a, b) => Number(a.captured?.price_per_bag) - Number(b.captured?.price_per_bag));
    if (priced.length > 0) {
      short = CHEAPEST_WORDS[lang](priced[0].name, formatRupeesShort(Number(priced[0].captured?.price_per_bag)), String(priced[0].captured?.delivery_day ?? ""));
      kind = "cheapest";
    }
  }
  return {
    task_id: m.id,
    status,
    short_answer: short,
    short_answer_kind: kind,
    totals: { contacts: r.n, reached: positive + negative + unclear, positive, negative, unclear, no_answer: num("no_answer"), spent_paise: r.finished * perPerson(m).paise },
    rows,
    simulated: true,
    wording: "draft",
  };
}

// ---- the cookie -------------------------------------------------------------------------------------------------------------
const STATES: readonly MockStatus[] = ["needs_answer", "planned", "active", "paused", "cancelled"];
const num = (v: unknown, max = Number.MAX_SAFE_INTEGER): number | null => (typeof v === "number" && Number.isSafeInteger(v) && v >= 0 && v <= max ? v : null);

export function parseMockTask(v: unknown): MockTask | null {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return null;
  const x = v as Record<string, unknown>;
  const lang = TASK_LANGS.find((l) => l === x.lang);
  const tpl = TASK_TEMPLATES.find((t) => t === x.tpl);
  const st = STATES.find((s) => s === x.st);
  const ca = num(x.ca);
  const el = num(x.el);
  if (typeof x.id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(x.id) || typeof x.ins !== "string" || x.ins.length > INS_KEEP || !lang || !tpl || !st || ca === null || el === null) return null;
  const ap = x.ap === null ? null : num(x.ap);
  const si = x.si === null ? null : num(x.si);
  const cap = x.cap === null ? null : num(x.cap, 1_000_000_000);
  if ((x.ap !== null && ap === null) || (x.si !== null && si === null) || (x.cap !== null && cap === null)) return null;
  if (!Array.isArray(x.ex) || x.ex.length > PEOPLE || x.ex.some((i) => num(i, PEOPLE - 1) === null)) return null;
  const pr = x.pr === "cap" || x.pr === "owner" ? x.pr : x.pr === null ? null : undefined;
  if (pr === undefined) return null;
  const ans = x.ans === null ? null : typeof x.ans === "string" && x.ans.length <= 120 ? x.ans : undefined;
  if (ans === undefined) return null;
  return { id: x.id, ins: x.ins, lang, tpl, st, ca, ap, el, si, ex: [...new Set(x.ex as number[])], cap, pr, ans };
}

/** How many tasks the cookie keeps (the newest). */
export const MOCK_KEEP = 5;
export function parseMockJar(v: unknown): MockTask[] | null {
  if (!Array.isArray(v) || v.length > MOCK_KEEP * 2) return null;
  const out = v.map(parseMockTask);
  return out.every((t): t is MockTask => t !== null) ? out : null;
}
