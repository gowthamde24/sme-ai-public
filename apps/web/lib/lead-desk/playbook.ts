import { bad, bool, list, optIso, optStr, rec, str, word } from "@/lib/api/shape";

/**
 * The lead PLAYBOOK of a workspace (night 4, part A1; contract-leads-pack.md section 2): what the assistant says and asks for this kind of business: the goal sentence, the questions (a subset and an order of the business type's
 * contact fields, at most 8), the answers to common objections, the follow-up timings and the outcome reasons. The owner edits the goal and the questions; the rest is shown. The safety rules are the type's and the platform's and cannot be
 * edited. A playbook states NO price and NO promise (prices only come from approved facts). Pure types, parsing and the checks a form makes before it asks the API.
 */
export type PlaybookQuestion = { field: string; ask: string; required: boolean };
export type Objection = { code: string; hears: readonly string[]; answer: string };
export type Followup = { when: string; afterMinutes: number; channel: string; maxAttempts: number; message: string | null };
export type PlaybookBody = { goalAsk: string; questions: readonly PlaybookQuestion[]; objections: readonly Objection[]; followups: readonly Followup[]; /** What the API sent, kept so a save sends back everything it did not let the owner change. */ raw: Readonly<Record<string, unknown>> };
export type PlaybookRead = { templatePack: string | null; saved: boolean; playbook: PlaybookBody | null; defaults: PlaybookBody | null; safety: readonly string[]; updatedAt: string | null };
export const MAX_QUESTIONS = 8;
export type PlaybookRefusal = "mfa" | "read_only" | "invalid" | "price_or_promise" | "no_template" | "forbidden" | "not_available" | "down";
export type PDone<T> = { ok: true; value: T } | { ok: false; error: PlaybookRefusal };

/** The same price-or-promise words the API refuses (so the form can say it before sending). */
export const PRICE_OR_PROMISE = /₹|\brs\.?\s?\d|\d\s?%|\d+\s*(lakh|crore|rupees)|(?<!not )(?<!cannot )(?<!never )(?<!n't )(?<!no )\b(guarantee|guaranteed|promise|promised|assure|assured|warranty)\b/i;

const en = (v: unknown, what: string): string => str(rec(v, what).en, what, 400);

function body(v: unknown): PlaybookBody {
  const x = rec(v, "playbook");
  return {
    goalAsk: en(x.goal_ask, "goal_ask"),
    questions: list(x.questions ?? [], "questions", 20).map((q) => {
      const r = rec(q, "question");
      return { field: word(r.field, "field", 40), ask: en(r.ask, "ask"), required: bool(r.required ?? false, "required") };
    }),
    objections: list(x.objections ?? [], "objections", 20).map((o) => {
      const r = rec(o, "objection");
      return { code: word(r.code, "code", 40), hears: list(r.hears ?? [], "hears", 10).map((h) => str(h, "hears", 120)), answer: en(r.answer, "answer") };
    }),
    followups: list(x.followups ?? [], "followups", 20).map((f) => {
      const r = rec(f, "followup");
      const n = r.after_minutes;
      return { when: word(r.when, "when", 20), afterMinutes: typeof n === "number" && Number.isFinite(n) ? n : bad("after_minutes"), channel: word(r.channel, "channel", 20), maxAttempts: typeof r.max_attempts === "number" ? r.max_attempts : 1, message: r.message === null || r.message === undefined ? null : en(r.message, "message") };
    }),
    raw: x,
  };
}

export function parsePlaybook(json: unknown): PlaybookRead {
  const x = rec(json, "lead playbook");
  return {
    templatePack: optStr(x.template_pack, "template_pack", 40),
    saved: x.saved === true,
    playbook: x.playbook === null || x.playbook === undefined ? null : body(x.playbook),
    defaults: x.defaults === null || x.defaults === undefined ? null : body(x.defaults),
    safety: list(x.safety ?? [], "safety", 50).map((s) => str(s, "safety", 400)),
    updatedAt: optIso(x.updated_at, "updated_at"),
  };
}

/** What the owner's edit sends: everything the API sent, with the goal sentence and the questions replaced. */
export function playbookPutBody(current: PlaybookBody, edit: { goalAsk: string; questions: readonly PlaybookQuestion[] }): Record<string, unknown> {
  return { ...current.raw, goal_ask: { en: edit.goalAsk }, questions: edit.questions.map((q) => ({ field: q.field, ask: { en: q.ask }, required: q.required })) };
}

/** A goal sentence or a question as a form sends it: 5 to 400 characters, no markup, no price and no promise. */
export function cleanLine(value: unknown): { ok: true; text: string } | { ok: false; error: "invalid" | "price_or_promise" } {
  if (typeof value !== "string") return { ok: false, error: "invalid" };
  const t = value.trim().replace(/\s+/g, " ");
  if (t.length < 5 || t.length > 400 || /[<>{}\u0000-\u001f\u007f]/.test(t)) return { ok: false, error: "invalid" };
  return PRICE_OR_PROMISE.test(t) ? { ok: false, error: "price_or_promise" } : { ok: true, text: t };
}

/** The edit of a playbook as a form sends it, checked: the goal sentence, 1 to 8 questions that each name one of the business type's fields once. */
export function parseEdit(value: unknown, allowedFields: ReadonlySet<string> | null): { ok: true; goalAsk: string; questions: PlaybookQuestion[] } | { ok: false; error: "invalid" | "price_or_promise" } {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return { ok: false, error: "invalid" };
  const v = value as Record<string, unknown>;
  const goal = cleanLine(v.goalAsk);
  if (!goal.ok) return goal;
  if (!Array.isArray(v.questions) || v.questions.length < 1 || v.questions.length > MAX_QUESTIONS) return { ok: false, error: "invalid" };
  const seen = new Set<string>();
  const questions: PlaybookQuestion[] = [];
  for (const q of v.questions) {
    if (typeof q !== "object" || q === null) return { ok: false, error: "invalid" };
    const r = q as Record<string, unknown>;
    const ask = cleanLine(r.ask);
    if (!ask.ok) return ask;
    if (typeof r.field !== "string" || !/^[a-z][a-z0-9_]{1,39}$/.test(r.field) || seen.has(r.field) || (allowedFields !== null && !allowedFields.has(r.field))) return { ok: false, error: "invalid" };
    seen.add(r.field);
    questions.push({ field: r.field, ask: ask.text, required: r.required === true });
  }
  return { ok: true, goalAsk: goal.text, questions };
}
