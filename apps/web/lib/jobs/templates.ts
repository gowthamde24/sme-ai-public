import type { JobKind } from "./types";

/**
 * JOB TEMPLATES (decision-ai-team.md, "Job templates and the New job sheet"; owner 19 Nov 2026). The shapes the New job sheet and the live preview cards read. They follow C1's `packages/packs/<pack>/jobs.json`
 * (services/ai-api/app/jobs/packdata.py: the closed lists below are the same words); the ONE place that reads the API's wire shape is `lib/api/job-templates.ts` (contract 1.1 lands on 22 Nov: a change is an edit there).
 * The words of a template (title, benefit, the sentence to say, the WhatsApp text, the call lines) come from the DATA in the owner's language (English when a language is missing); the words around them are ours (`jobs.tpl.*`).
 */
export const TEMPLATE_KINDS = ["speed_to_lead", "answer_calls", "followups", "store_visits", "offers", "researcher", "custom"] as const satisfies readonly JobKind[];
export type TemplateKind = (typeof TEMPLATE_KINDS)[number];
/** The goals the sheet groups its ideas by. `get_paid` is LATER (planner, 19 Nov): its templates are never drawn. */
export const TEMPLATE_GOALS = ["answer_every_enquiry", "bring_customers_back", "fill_your_visits", "get_paid", "find_new_customers"] as const;
export type TemplateGoal = (typeof TEMPLATE_GOALS)[number];
/** The groups of "More ideas", in this order (Get paid is not one of them until payment reminders are switched on). */
export const SHEET_GOALS = ["answer_every_enquiry", "bring_customers_back", "fill_your_visits", "find_new_customers"] as const satisfies readonly TemplateGoal[];
export type SheetGoal = (typeof SHEET_GOALS)[number];
/** What a job needs before it can run: a short line each on the card (`jobs.tpl.needs.<code>`). */
export const TEMPLATE_NEEDS = ["whatsapp", "phone_number", "catalogue_item", "visit_hours", "lead_source"] as const;
export type TemplateNeed = (typeof TEMPLATE_NEEDS)[number];
export const TEMPLATE_FINDS = ["need", "quantity", "when", "visit", "budget_range", "still_interested"] as const;
export const TEMPLATE_SEASONS = ["diwali", "wedding_season", "new_year", "none"] as const;
export type TemplateSeason = (typeof TEMPLATE_SEASONS)[number];
export const TEMPLATE_LANGS = ["en", "te", "hi", "kn"] as const;
export type TemplateLang = (typeof TEMPLATE_LANGS)[number];

/** A text in the languages the data has: `en` is always there, the others may be missing (the web falls back to English). */
export type Texts = { en: string } & Partial<Record<TemplateLang, string>>;
/** The text in this language, else English. */
export const textIn = (texts: Texts, lang: string): string => (TEMPLATE_LANGS.includes(lang as TemplateLang) ? texts[lang as TemplateLang] : undefined) ?? texts.en;

/** An invented example prospect of a Lead Finder template: always labelled "Example" on screen. `fit` is a 0-100 score when the data has one (it comes from the prospects API, never made up by the web). */
export type TemplateExample = { name: string; area: string; why: Texts; fit: number | null };

export type JobTemplate = {
  id: string;
  kind: TemplateKind;
  goal: TemplateGoal;
  /** The pack's editorial "popular" flag (an order of the people who wrote the pack, not usage). */
  popular: boolean;
  /** Owner-facing lines: no placeholders in them. */
  title: Texts;
  benefit: Texts;
  /** The sentence that starts the job exactly as if the owner had typed it ("Call every new saree enquiry right away"). */
  ask: Texts;
  /** Customer-facing lines with {business} {customer} {item} {assistant} in them; a call is exactly two lines (the first says it is an AI). null = this template has no such preview. */
  whatsapp: Texts | null;
  call: Texts | null;
  /** The 10-second voice sample: a link the player plays, or null (no sample yet: the player is not drawn). */
  sampleAudio: string | null;
  examples: TemplateExample[];
  needs: TemplateNeed[];
  findsOut: string[];
  season: TemplateSeason;
};

export type PackJobs = { pack: string; status: string; version: number; templates: JobTemplate[] };

/** The answer of the New job sheet's one read: the shop's own business type (its name is a short noun phrase: "saree shops"), what an {item} reads like for it, its templates, and the templates of the other business types ("Ideas from other businesses"). */
export type NewJobSheetData = {
  businessType: { pack: string; name: Texts };
  sampleItem: Texts | null;
  own: PackJobs;
  others: { pack: string; name: Texts; jobs: PackJobs }[];
};

/** What the server hands the sheet: the data and the facts the previews are filled with (the shop's name, the main assistant's name, the person's language). */
export type SheetLoad = { data: NewJobSheetData; lang: string; business: string; assistant: string | null };

/** The festival calendar (data per region from C1: never written in the web): one dated entry per festival the shop may prepare for. `season` is the word a template's `season` carries. */
export type Festival = { season: Exclude<TemplateSeason, "none">; name: Texts; date: string };

/** Payment reminders are LATER (planner, 19 Nov: "Get paid stays later"): such a template is hidden everywhere, also when the data marks it popular. */
export const isLater = (t: JobTemplate): boolean => t.goal === "get_paid";
export const shown = (set: PackJobs): JobTemplate[] => set.templates.filter((t) => !isLater(t));
/** The popular cards of a business type, at most four, in the pack's order. */
export const popularOf = (set: PackJobs): JobTemplate[] => shown(set).filter((t) => t.popular).slice(0, 4);
/** "More ideas": every template (popular or not) grouped by goal, in the goals' order; a goal with none is not there. */
export function groupByGoal(set: PackJobs): { goal: SheetGoal; templates: JobTemplate[] }[] {
  const all = shown(set);
  return SHEET_GOALS.map((goal) => ({ goal, templates: all.filter((t) => t.goal === goal) })).filter((g) => g.templates.length > 0);
}
/** The template of a festival season in a pack (the first), or null. */
export const forSeason = (set: PackJobs, season: TemplateSeason): JobTemplate | null => (season === "none" ? null : (shown(set).find((t) => t.season === season) ?? null));

/** What fills a customer-facing line: the four placeholders the data may use. */
export type FillValues = { business: string; customer: string; item: string; assistant: string };
export function fillText(text: string, v: FillValues): string {
  return text.replace(/\{([a-z_]+)\}/g, (whole, key: string) => (key in v ? v[key as keyof FillValues] : whole));
}

/** A call preview is two lines (the assistant opens with its name and "AI assistant of {business}"); a text that is not exactly two lines is shown as it is, in one block. */
export const callLines = (text: string): string[] => text.split("\n").map((l) => l.trim()).filter((l) => l !== "");
/** The calendar day in India (`YYYY-MM-DD`) of an instant: the server runs in UTC, and between 00:00 and 05:30 in India it is still the day before there. */
const indiaDay = (at: Date): string => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
/** The whole days from today in India (the calendar day of the instant `from`, in Asia/Kolkata whatever the server's zone) to the calendar day of `to` (an ISO date or timestamp, its date part): 0 = today, negative = past. */
export function daysUntil(to: string, from: Date): number {
  const [y, m, d] = to.slice(0, 10).split("-").map(Number);
  const [fy, fm, fd] = indiaDay(from).split("-").map(Number);
  return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(fy, fm - 1, fd)) / 86_400_000);
}
