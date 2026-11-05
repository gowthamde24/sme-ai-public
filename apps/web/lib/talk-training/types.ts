import { CALL_LANGS, type CallLang } from "@/lib/assistant/types";

/**
 * "How I talk to customers" (C1's docs/contracts/talk-training.md, owner 5 Nov 2026): what the Owner teaches the assistant about speaking on calls. One whole document, saved at once. These limits are the contract's; the API checks them again and
 * also refuses any amount, percentage or promise (`price_or_promise`), which only it can judge. Pure: no fetch, no React.
 */
export const ADDRESSES = ["plain", "sir_madam", "garu", "ji"] as const;
export type Address = (typeof ADDRESSES)[number];
export type Pair = { a: string; b: string };
export type TalkTraining = {
  greeting: Partial<Record<CallLang, string>>;
  address: Address;
  questions: string[];
  neverSay: string[];
  /** {a: what the customer says, b: the answer} */
  objections: Pair[];
  /** {a: the customer's line, b: the Owner's good answer} */
  examples: Pair[];
};
export type TalkTrainingState = { training: TalkTraining; saved: boolean; defaults: TalkTraining; rules: string[]; updatedAt: string | null };

export const LIMITS = {
  greeting: { min: 2, max: 200 },
  question: { min: 2, max: 160, count: 8 },
  neverSay: { min: 2, max: 80, count: 20 },
  // the contract gives no length for these: a generous bound, so a default the API writes is never refused here
  objection: { min: 2, max: 500, count: 8 },
  example: { min: 2, max: 500, count: 5 },
} as const;

export const REASONS = ["price_or_promise", "too_many_questions", "too_many_never_say", "too_many_objections", "too_many_examples", "duplicate", "invalid"] as const;
export type Reason = (typeof REASONS)[number];
export type TalkError = Reason | "forbidden" | "mfa" | "read_only" | "not_available" | "down";

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const sized = (v: unknown, min: number, max: number): v is string => typeof v === "string" && v.trim().length >= min && v.length <= max;
/** "Too costly" and "too  costly." are the same phrase (the API compares without case, spaces or punctuation). */
export const sameWords = (s: string): string => s.toLowerCase().replace(/[\p{P}\p{S}]/gu, " ").replace(/\s+/g, " ").trim();

function pairs(v: unknown, keys: [string, string], max: number, count: number): Pair[] | null {
  if (!Array.isArray(v) || v.length > count) return null;
  const out: Pair[] = [];
  for (const p of v) {
    if (!isRecord(p) || !sized(p[keys[0]], 2, max) || !sized(p[keys[1]], 2, max)) return null;
    out.push({ a: p[keys[0]] as string, b: p[keys[1]] as string });
  }
  return out;
}
function strings(v: unknown, min: number, max: number, count: number): string[] | null {
  if (!Array.isArray(v) || v.length > count || !v.every((s) => sized(s, min, max))) return null;
  return v as string[];
}

/** The document as the API writes it (snake_case, `hears`/`answer`, `customer`/`answer`) -> the screen's shape. Languages the screens do not have are left out; anything else that is wrong refuses the whole. */
export function fromApi(v: unknown): TalkTraining | null {
  if (!isRecord(v)) return null;
  const greeting: TalkTraining["greeting"] = {};
  if (v.greeting !== undefined && v.greeting !== null) {
    if (!isRecord(v.greeting)) return null;
    for (const [l, text] of Object.entries(v.greeting)) {
      if (!(CALL_LANGS as readonly string[]).includes(l)) continue;
      if (!sized(text, LIMITS.greeting.min, LIMITS.greeting.max)) return null;
      greeting[l as CallLang] = text;
    }
  }
  const address = (ADDRESSES as readonly unknown[]).includes(v.address) ? (v.address as Address) : null;
  const questions = strings(v.questions ?? [], LIMITS.question.min, LIMITS.question.max, LIMITS.question.count);
  const neverSay = strings(v.never_say ?? [], LIMITS.neverSay.min, LIMITS.neverSay.max, LIMITS.neverSay.count);
  const objections = pairs(v.objections ?? [], ["hears", "answer"], LIMITS.objection.max, LIMITS.objection.count);
  const examples = pairs(v.examples ?? [], ["customer", "answer"], LIMITS.example.max, LIMITS.example.count);
  if (!address || !questions || !neverSay || !objections || !examples) return null;
  return { greeting, address, questions, neverSay, objections, examples };
}

export const toApi = (t: TalkTraining) => ({
  greeting: t.greeting,
  address: t.address,
  questions: t.questions,
  never_say: t.neverSay,
  objections: t.objections.map((p) => ({ hears: p.a, answer: p.b })),
  examples: t.examples.map((p) => ({ customer: p.a, answer: p.b })),
});

/**
 * What the browser sends, checked again on the server: trimmed, empty rows dropped, every limit of the contract. Answers the document or the closed reason the screen shows (the same words as the API's refusals). The amounts and promises are
 * left to the API (it alone knows the business's words for them).
 */
export function cleanEdit(input: unknown): { ok: true; data: TalkTraining } | { ok: false; error: Reason } {
  if (!isRecord(input)) return { ok: false, error: "invalid" };
  const trimList = (v: unknown): unknown => (Array.isArray(v) ? v.map((s) => (typeof s === "string" ? s.trim() : s)).filter((s) => s !== "") : v);
  const trimPairs = (v: unknown): unknown => (Array.isArray(v) ? v.map((p) => (isRecord(p) ? { a: typeof p.a === "string" ? p.a.trim() : p.a, b: typeof p.b === "string" ? p.b.trim() : p.b } : p)).filter((p) => !(isRecord(p) && p.a === "" && p.b === "")) : v);
  const q = trimList(input.questions);
  const n = trimList(input.neverSay);
  const o = trimPairs(input.objections);
  const e = trimPairs(input.examples);
  if (Array.isArray(q) && q.length > LIMITS.question.count) return { ok: false, error: "too_many_questions" };
  if (Array.isArray(n) && n.length > LIMITS.neverSay.count) return { ok: false, error: "too_many_never_say" };
  if (Array.isArray(o) && o.length > LIMITS.objection.count) return { ok: false, error: "too_many_objections" };
  if (Array.isArray(e) && e.length > LIMITS.example.count) return { ok: false, error: "too_many_examples" };
  const greeting: Record<string, unknown> = {};
  if (isRecord(input.greeting)) for (const [l, v] of Object.entries(input.greeting)) if (typeof v === "string" && v.trim() !== "") greeting[l] = v.trim();
  const doc = fromApi({ greeting, address: input.address, questions: q, never_say: n, objections: Array.isArray(o) ? o.map((p) => (isRecord(p) ? { hears: p.a, answer: p.b } : p)) : o, examples: Array.isArray(e) ? e.map((p) => (isRecord(p) ? { customer: p.a, answer: p.b } : p)) : e });
  if (!doc || Object.keys(greeting).some((l) => !(CALL_LANGS as readonly string[]).includes(l))) return { ok: false, error: "invalid" };
  const said = doc.neverSay.map(sameWords);
  const asked = doc.questions.map(sameWords);
  if (new Set(said).size !== said.length || new Set(asked).size !== asked.length) return { ok: false, error: "duplicate" };
  return { ok: true, data: doc };
}
