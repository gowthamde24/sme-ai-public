import { CALL_LANGS, type CallLang } from "@/lib/assistant/types";

/**
 * "How I talk to customers" (C1's docs/contracts/talk-training.md, owner 5 Nov 2026): what the Owner teaches the assistant about speaking on calls. One whole document, saved at once. These limits are the contract's; the API checks them again and
 * also refuses any amount, percentage or promise (`price_or_promise`), which only it can judge. Pure: no fetch, no React.
 */
export const ADDRESSES = ["plain", "sir_madam", "garu", "ji"] as const;
export type Address = (typeof ADDRESSES)[number];
export type Pair = { a: string; b: string };
/** "Say it like this" (app v4, C1 #392): the business's own word, and optionally the word it replaces ("pattu cheera" instead of "silk saree"). */
export type SayLike = { say: string; insteadOf: string | null };
export type TalkTraining = {
  greeting: Partial<Record<CallLang, string>>;
  address: Address;
  questions: string[];
  neverSay: string[];
  /** {a: what the customer says, b: the answer} */
  objections: Pair[];
  /** {a: the customer's line, b: the Owner's good answer} */
  examples: Pair[];
  /** at most 20; an API that predates the field is read as none */
  sayLike: SayLike[];
};
export type TalkTrainingState = { training: TalkTraining; saved: boolean; defaults: TalkTraining; rules: string[]; updatedAt: string | null };

export const LIMITS = {
  greeting: { min: 2, max: 200 },
  question: { min: 2, max: 160, count: 8 },
  neverSay: { min: 2, max: 80, count: 20 },
  // the contract gives no length for these: a generous bound, so a default the API writes is never refused here
  objection: { min: 2, max: 500, count: 8 },
  example: { min: 2, max: 500, count: 5 },
  sayLike: { min: 2, max: 80, count: 20 },
} as const;

export const REASONS = ["price_or_promise", "too_many_questions", "too_many_never_say", "too_many_objections", "too_many_examples", "too_many_say_like", "duplicate", "invalid"] as const;
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
function sayLikes(v: unknown): SayLike[] | null {
  if (!Array.isArray(v) || v.length > LIMITS.sayLike.count) return null;
  const out: SayLike[] = [];
  for (const p of v) {
    if (!isRecord(p) || !sized(p.say, LIMITS.sayLike.min, LIMITS.sayLike.max)) return null;
    if (p.instead_of !== null && p.instead_of !== undefined && !sized(p.instead_of, LIMITS.sayLike.min, LIMITS.sayLike.max)) return null;
    out.push({ say: p.say as string, insteadOf: typeof p.instead_of === "string" ? p.instead_of : null });
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
  const sayLike = sayLikes(v.say_like ?? []);
  if (!address || !questions || !neverSay || !objections || !examples || !sayLike) return null;
  return { greeting, address, questions, neverSay, objections, examples, sayLike };
}

export const toApi = (t: TalkTraining) => ({
  greeting: t.greeting,
  address: t.address,
  questions: t.questions,
  never_say: t.neverSay,
  objections: t.objections.map((p) => ({ hears: p.a, answer: p.b })),
  examples: t.examples.map((p) => ({ customer: p.a, answer: p.b })),
  say_like: t.sayLike.map((p) => ({ say: p.say, instead_of: p.insteadOf })),
});

/** How "Say it like this" goes into the call's instructions (the contract: one line per item, under "SAY IT LIKE THIS"): shown read-only so the Owner sees what the assistant is told. */
export const sayLikeLine = (p: SayLike): string => (p.insteadOf ? `"${p.say}" (not "${p.insteadOf}")` : `"${p.say}"`);

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
  // "Say it like this": trimmed; a row with no word to say is dropped; an empty "instead of" is none
  const s0 = Array.isArray(input.sayLike)
    ? input.sayLike.flatMap((p) => {
        if (!isRecord(p)) return [p];
        const say = typeof p.say === "string" ? p.say.trim() : p.say;
        const insteadOf = typeof p.insteadOf === "string" ? p.insteadOf.trim() || null : (p.insteadOf ?? null);
        return say === "" ? [] : [{ say, instead_of: insteadOf }];
      })
    : (input.sayLike ?? []);
  if (Array.isArray(q) && q.length > LIMITS.question.count) return { ok: false, error: "too_many_questions" };
  if (Array.isArray(n) && n.length > LIMITS.neverSay.count) return { ok: false, error: "too_many_never_say" };
  if (Array.isArray(o) && o.length > LIMITS.objection.count) return { ok: false, error: "too_many_objections" };
  if (Array.isArray(e) && e.length > LIMITS.example.count) return { ok: false, error: "too_many_examples" };
  if (Array.isArray(s0) && s0.length > LIMITS.sayLike.count) return { ok: false, error: "too_many_say_like" };
  // only the six call languages are read (a key the browser sends is never used as a property name); any other key refuses the whole
  const sent = isRecord(input.greeting) ? input.greeting : {};
  if (Object.keys(sent).some((l) => !(CALL_LANGS as readonly string[]).includes(l))) return { ok: false, error: "invalid" };
  const greeting: Partial<Record<CallLang, string>> = {};
  for (const l of CALL_LANGS) {
    const v = sent[l];
    if (typeof v === "string" && v.trim() !== "") greeting[l] = v.trim();
  }
  const doc = fromApi({ greeting, address: input.address, questions: q, never_say: n, objections: Array.isArray(o) ? o.map((p) => (isRecord(p) ? { hears: p.a, answer: p.b } : p)) : o, examples: Array.isArray(e) ? e.map((p) => (isRecord(p) ? { customer: p.a, answer: p.b } : p)) : e, say_like: s0 });
  if (!doc) return { ok: false, error: "invalid" };
  const said = doc.neverSay.map(sameWords);
  const asked = doc.questions.map(sameWords);
  const says = doc.sayLike.map((p) => p.say.toLowerCase());
  if (new Set(said).size !== said.length || new Set(asked).size !== asked.length || new Set(says).size !== says.length) return { ok: false, error: "duplicate" };
  return { ok: true, data: doc };
}
