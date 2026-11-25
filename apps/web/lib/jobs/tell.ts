import { JOB_KINDS, type JobKind } from "./types";

/**
 * "Tell your assistant what to do" (TELL_SCREENS; owner 29 Nov 2026; C1's `POST /jobs/describe`, docs/contracts/jobs-describe.md). The owner says the job; the API answers a DRAFT (a template, its kind and the setting values it could settle, and the
 * keys it could not). Nothing is created or switched on by the reading. The shapes and closed words of the screen live here; the call is lib/api/jobs-describe.ts; the made-up reading of the mock screen is `mockDraft` below.
 */
export const TELL_TEXT_MIN = 3;
export const TELL_TEXT_MAX = 1000;
/** The longest a job's own name may be (`PATCH /jobs/{id}` name, 40 characters). */
export const JOB_NAME_MAX = 40;

/** The three things a job is for (the three boxed choices). The API has no `mode` field: the choice is told to the model as one short English line in front of what the owner wrote (see `withMode`). */
export const TELL_MODES = ["enquiry", "list", "incoming"] as const;
export type TellMode = (typeof TELL_MODES)[number];
/** Language of what the owner wrote: `any` = the app's own language is sent (the API takes en, te, hi or kn). */
export const TELL_LANGS = ["any", "en", "te", "hi", "kn"] as const;
export type TellLang = (typeof TELL_LANGS)[number];
export const isMode = (v: unknown): v is TellMode => typeof v === "string" && (TELL_MODES as readonly string[]).includes(v);
export const isTellLang = (v: unknown): v is TellLang => typeof v === "string" && (TELL_LANGS as readonly string[]).includes(v);

const MODE_HINT: Record<TellMode, string> = {
  enquiry: "This job is for new enquiries, right when they come in.",
  list: "This job works through a list of people who said yes.",
  incoming: "This job answers incoming calls.",
};
/** What the model reads: the mode as one plain line, then the owner's own words (the whole is still at most 1000 characters; the owner's words are cut last-first, never the line). */
export function withMode(text: string, mode: TellMode | null): string {
  const said = text.trim();
  if (!mode) return said.slice(0, TELL_TEXT_MAX);
  const line = `${MODE_HINT[mode]} `;
  return `${line}${said.slice(0, TELL_TEXT_MAX - line.length)}`;
}

/** One value of the draft: a choice word or a yes/no, with the API's own English sentence for it (never drawn: the screen has its words per key and value). */
export type TellField = { key: string; value: string | boolean; words: string };
export type TellDraft = { understood: boolean; templateId: string | null; kind: JobKind | null; goal: string | null; fields: TellField[]; unclear: string[]; nearest: string[]; unclearWords: string | null };

/** The settings each kind of job has, in the order the draft draws them (the same closed keys as the API's catalogue, docs/contracts/jobs-detail.md). A key the API sends that is not here is not drawn and not sent back. */
export const KIND_KEYS: Readonly<Record<JobKind, readonly string[]>> = {
  speed_to_lead: ["when", "language", "tries", "thank_you_whatsapp", "from_hour", "to_hour"],
  answer_calls: [],
  followups: ["nudges", "gap_days"],
  store_visits: ["from_hour", "to_hour", "slot_minutes"],
  offers: ["weekly_cap"],
  researcher: ["results_per_search", "fit_bar"],
  payment_reminders: [],
  custom: [],
};
const hours = (from: number, last: string): string[] => {
  const out: string[] = [];
  for (let h = from; h <= 23; h += 1) for (const m of [0, 30]) out.push(`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`);
  return out.filter((x) => x <= last);
};
const CALLING_HOURS = hours(9, "21:00");
const SHOP_HOURS = hours(6, "23:30");
/** The choices of a setting (closed, the same words as the API's catalogue); `toggle` = yes or no. The calling hours of a call job run 9:00 to 21:00, a shop's own hours 6:00 to 23:30. */
export function optionsOf(kind: JobKind, key: string): readonly string[] | "toggle" | null {
  if (key === "thank_you_whatsapp") return "toggle";
  if (key === "from_hour" || key === "to_hour") return kind === "store_visits" ? SHOP_HOURS : CALLING_HOURS;
  const table: Record<string, readonly string[]> = {
    when: ["right_away", "after_10_min"],
    language: ["auto", "en", "te", "hi", "kn", "ta", "ml", "mr"],
    tries: ["tries_1", "tries_2", "tries_3"],
    nudges: ["nudges_1", "nudges_2", "nudges_3"],
    gap_days: ["days_2", "days_3", "days_5"],
    slot_minutes: ["minutes_15", "minutes_20", "minutes_30", "minutes_45", "minutes_60", "minutes_90", "minutes_120"],
    weekly_cap: ["cap_1", "cap_2", "cap_3"],
    results_per_search: ["results_5", "results_10", "results_20"],
    fit_bar: ["fit_60", "fit_70", "fit_80", "fit_90"],
  };
  return table[key] ?? null;
}

/** The kinds a described job may start as (the API's catalogue has no `payment_reminders` in v1 and `custom` has no template to start from). */
export const TELL_KINDS: readonly JobKind[] = JOB_KINDS.filter((k) => k !== "payment_reminders" && k !== "custom");

/** The values the form starts with: what the API settled ("on"/"off" for a yes/no); a key it could not settle or never heard is empty (empty = "I could not tell", or "keep the usual" when the key is not in `unclear`). */
export function startValues(draft: TellDraft): Record<string, string> {
  const out: Record<string, string> = {};
  if (!draft.kind) return out;
  for (const key of KIND_KEYS[draft.kind]) {
    const f = draft.fields.find((x) => x.key === key);
    out[key] = f === undefined ? "" : typeof f.value === "boolean" ? (f.value ? "on" : "off") : f.value;
  }
  return out;
}
/** The keys still to be chosen by the owner: the API's `unclear` ones that the form does not hold a value for yet. */
export const stillUnclear = (draft: TellDraft, values: Readonly<Record<string, string>>): string[] => draft.unclear.filter((k) => (values[k] ?? "") === "" && draft.kind !== null && KIND_KEYS[draft.kind].includes(k));

/** The `settings` of `PATCH /jobs/{id}`: only the keys the form holds a value for, as the wire wants them (a choice as its word, a yes/no as a boolean). Anything not in the kind's list or not one of its options is left out. */
export function settingsPatch(kind: JobKind, values: Readonly<Record<string, string>>): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (const key of KIND_KEYS[kind]) {
    const v = values[key] ?? "";
    const options = optionsOf(kind, key);
    if (v === "" || options === null) continue;
    if (options === "toggle") {
      if (v === "on" || v === "off") out[key] = v === "on";
    } else if (options.includes(v)) out[key] = v;
  }
  return out;
}

/** The made-up reading of the mock screen (TELL_SCREENS=mock): nothing is sent anywhere. It looks at a few words of the sentence and the chosen mode; always one `unclear` key for a call job, so the highlight can be seen. */
export function mockDraft(text: string, mode: TellMode | null): TellDraft {
  const said = text.toLowerCase();
  if (said.trim().length < TELL_TEXT_MIN) return { understood: false, templateId: null, kind: null, goal: null, fields: [], unclear: [], nearest: [], unclearWords: null };
  if (/xyz|asdf|qwer/.test(said)) return { understood: false, templateId: null, kind: null, goal: null, fields: [], unclear: [], nearest: ["call_new_enquiries", "answer_my_calls", "remind_about_quotes"], unclearWords: null };
  const byWords: JobKind = /answer|incoming|busy|\bcalls? me\b|రావ|ఫోన్/.test(said) ? "answer_calls" : /remind|quote|follow|price|ధర/.test(said) ? "followups" : /visit|store|shop|రండి/.test(said) ? "store_visits" : /offer|festival|diwali/.test(said) ? "offers" : "speed_to_lead";
  // the chosen mode decides first (it is what the owner pointed at); the words decide only when none is chosen
  const kind: JobKind = mode === "incoming" ? "answer_calls" : mode === "list" ? "offers" : mode === "enquiry" ? (byWords === "followups" ? "followups" : "speed_to_lead") : byWords;
  if (kind === "speed_to_lead") {
    return {
      understood: true,
      templateId: "call_new_enquiries",
      kind,
      goal: "answer_every_enquiry",
      fields: [
        { key: "when", value: /10 min/.test(said) ? "after_10_min" : "right_away", words: "When: right away" },
        { key: "thank_you_whatsapp", value: false, words: "Thank you whatsapp: off" },
      ],
      unclear: ["language"],
      nearest: [],
      unclearWords: "A few things were not clear from what you said: language. Please choose them yourself.",
    };
  }
  if (kind === "followups") return { understood: true, templateId: "remind_about_quotes", kind, goal: "bring_customers_back", fields: [{ key: "nudges", value: "nudges_2", words: "Nudges: 2" }], unclear: [], nearest: [], unclearWords: null };
  if (kind === "store_visits") return { understood: true, templateId: "book_store_visits", kind, goal: "fill_your_visits", fields: [], unclear: ["from_hour"], nearest: [], unclearWords: "A few things were not clear from what you said: from hour. Please choose them yourself." };
  if (kind === "offers") return { understood: true, templateId: "festival_offer", kind, goal: "bring_customers_back", fields: [{ key: "weekly_cap", value: "cap_1", words: "Weekly cap: 1" }], unclear: [], nearest: [], unclearWords: null };
  return { understood: true, templateId: "answer_my_calls", kind, goal: "answer_every_enquiry", fields: [], unclear: [], nearest: [], unclearWords: null };
}
