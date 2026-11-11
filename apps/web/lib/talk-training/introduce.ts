/**
 * "Introduce as" (C1's docs/contracts/talk-training.md, 11 Nov 2026; staging only): how the assistant introduces itself on the Owner's own TEST call. `business` (the default: "the AI assistant of <business>"), `owner` (the owner's
 * name: "Gowtham's AI assistant") or `custom` (the owner's own words, which must say "AI assistant"). The API refuses the same things with a 422; these checks are the same rules in the same words, so the form can say what is wrong
 * as the owner types. It is NOT used on inbound calls or on Lead Desk calls to customers (they keep the business name until the owner says the lawyer agreed otherwise). Pure: no fetch, no React.
 */
export const INTRODUCE_KINDS = ["business", "owner", "custom"] as const;
export type IntroduceKind = (typeof INTRODUCE_KINDS)[number];
export type IntroduceAs = { kind: IntroduceKind; text: string | null };
export const INTRODUCE_LIMITS = { owner: { min: 2, max: 40 }, custom: { min: 8, max: 60 } } as const;
export const INTRODUCE_DEFAULT: IntroduceAs = { kind: "business", text: null };

export type IntroduceProblem = "short" | "long" | "letters" | "no_ai" | "digit" | "link" | "braces" | "human" | "business_text";

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const chars = (s: string): number => [...s].length;
// "never the words human / person (or their equivalents)": the English words and the ones the app's other languages use for them
const HUMAN = /\b(humans?|persons?|people|human being)\b|మనిషి|వ్యక్తి|ವ್ಯಕ್ತಿ|ಮನುಷ್ಯ|इंसान|इन्सान|व्यक्ति|आदमी|मानव/iu;
const LINK = /@|:\/\/|\bwww\.|\b[\w-]+\.(com|in|org|net|co|io|app|me)\b/iu;
const INDIC = /[\p{Script=Telugu}\p{Script=Kannada}\p{Script=Devanagari}]/u;

/**
 * What is wrong with the way the owner wants to be introduced, or null. `business` takes no text. `owner`: letters only (spaces between names are fine), 2 to 40 characters. `custom`: 8 to 60 characters, must say "AI assistant"
 * (in Latin letters here; text in the languages' own scripts is left to the API, which knows their words), no digit of any script, no link or e-mail address, no braces, never the words human / person.
 */
export function introduceProblem(v: IntroduceAs): IntroduceProblem | null {
  if (v.kind === "business") return v.text === null || v.text === "" ? null : "business_text";
  const t = (v.text ?? "").trim();
  const lim = INTRODUCE_LIMITS[v.kind];
  if (chars(t) < lim.min) return "short";
  if (chars(t) > lim.max) return "long";
  if (v.kind === "owner") return /^[\p{L}\p{M}]+(?: [\p{L}\p{M}]+)*$/u.test(t) ? null : /\p{Nd}/u.test(t) ? "digit" : "letters";
  if (/[{}]/.test(t)) return "braces";
  if (/\p{Nd}/u.test(t)) return "digit";
  if (LINK.test(t)) return "link";
  if (HUMAN.test(t)) return "human";
  if (!/\bAI\s+assistant\b/i.test(t) && !INDIC.test(t)) return "no_ai";
  return null;
}

/** The text as it is sent: trimmed, runs of spaces made one; `business` has none. */
export function cleanIntroduce(v: IntroduceAs): IntroduceAs {
  return v.kind === "business" ? INTRODUCE_DEFAULT : { kind: v.kind, text: (v.text ?? "").trim().replace(/\s+/g, " ") };
}

/** From the API (`{kind, text}`): null when it is not that (an older API has no such field, and then nothing of it is shown or sent). */
export function parseIntroduceAs(v: unknown): IntroduceAs | null {
  if (!isRecord(v) || !(INTRODUCE_KINDS as readonly unknown[]).includes(v.kind)) return null;
  const kind = v.kind as IntroduceKind;
  if (kind === "business") return INTRODUCE_DEFAULT;
  if (typeof v.text !== "string" || chars(v.text) > 200) return null;
  return { kind, text: v.text };
}

export const introduceToApi = (v: IntroduceAs): { kind: IntroduceKind; text: string | null } => ({ kind: v.kind, text: v.kind === "business" ? null : (v.text ?? "") });

/**
 * The live preview, from the words of the person's language: `tpl` holds the three sentences with {name}, {business} and {text}. "Hello, this is Gowtham's AI assistant." An empty name or text shows the sentence's own place, never a blank.
 */
export function introducePreview(v: IntroduceAs, business: string | null, tpl: { business: string; owner: string; custom: string }): string {
  if (v.kind === "business") return tpl.business.replace("{business}", business ?? "…");
  const t = (v.text ?? "").trim().replace(/\s+/g, " ");
  if (v.kind === "owner") return tpl.owner.replace("{name}", t === "" ? "…" : t);
  return tpl.custom.replace("{text}", t === "" ? "…" : t);
}
