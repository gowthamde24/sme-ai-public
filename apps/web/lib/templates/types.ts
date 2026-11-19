import type { Category, Draft, DraftLang, Message } from "./meta-checks";

/**
 * THE OWN WHATSAPP MESSAGES (JOBS; owner decision 19 Nov 2026: "Own WhatsApp templates: say what you want -> the assistant writes it -> live preview -> automatic checks -> submit with one tap (second step) -> status").
 * The owner never sees the words "template", "variable" or "namespace": a template is "a message", a variable is the customer's "Name". The shapes here are what the screens read; the ONE place that reads the API's wire shape is
 * `lib/api/template-builder-parse.ts` (C1 has not published it: `contracts/template-builder-web-needs.md` holds the proposal), so a change of the contract is an edit there.
 */
/** What WhatsApp says about a message the shop sent in: Waiting (WhatsApp is checking), Approved (jobs may send it), Needs a change (refused, with the reason). The API's own list (draft, submitted, approved, rejected, paused, disabled) is folded into these three by C1. */
export const OWN_STATUSES = ["waiting", "approved", "needs_change"] as const;
export type OwnStatus = (typeof OWN_STATUSES)[number];

/** Why WhatsApp sent a message back, the closed list the web has a plain sentence for (`jobs.tb.why.<code>`); a code the web does not know reads as `other` (the owner still gets a sentence and the way to change the message). */
export const REJECTION_CODES = ["category_mismatch", "price_or_offer", "variable_edge", "capitals", "too_long", "format", "abusive", "scam_like", "opt_out_missing", "quality_paused", "other"] as const;
export type RejectionCode = (typeof REJECTION_CODES)[number];
export type Rejection = { code: RejectionCode; params: Readonly<Record<string, string | number>> };

/** The name of a message in the languages the owner reads (`en` always; `te` when the assistant wrote one). */
export type OwnTitle = { en: string; te: string | null };

/** One message the shop sent to WhatsApp (or is about to): `submittedAt` is an ISO moment; `reason` only when it needs a change. */
export type OwnMessage = { id: string; title: OwnTitle; category: Category; status: OwnStatus; submittedAt: string | null; decidedAt: string | null; reason: Rejection | null };

/** What the assistant wrote from a sentence: the two drafts (the customer's name is `{name}`), the group WhatsApp will put it in, and a short name for the list. */
export type WrittenMessage = Message & { title: OwnTitle };
/** The assistant could not write it from that sentence (`unclear`): the screen says so in plain words and keeps the box. */
export type DraftAnswer = { kind: "written"; message: WrittenMessage } | { kind: "unclear" };

/** What the screen sends to ask for a draft: the sentence, and the message so far when the owner is changing it by saying it. */
export type DraftInput = { text: string; previous?: Message | null };
export const DRAFT_TEXT_MIN = 3;
export const DRAFT_TEXT_MAX = 500;

/** The submit: the checked message and the short name. The server runs the checks again and refuses a message that fails any (`checks_failed`). */
export type SubmitInput = { title: OwnTitle; message: Message };

export type { Category, Draft, DraftLang, Message };

/** A moment as the shop says it ("19 Nov, 10:42 am"): India time, the words of the person's language. */
export function momentText(iso: string | null, lang: string): string {
  const ms = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(ms)) return "";
  const loc = lang === "te" ? "te-IN" : lang === "hi" ? "hi-IN" : lang === "kn" ? "kn-IN" : "en-IN";
  return new Intl.DateTimeFormat(loc, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" }).format(ms);
}

/* ---- what a server action reads from the browser: never trusted, checked down to the letter ---- */
const BRACES = /[{}]/;
const textOk = (v: unknown, max: number): v is string => typeof v === "string" && v.length <= max && !BRACES.test(v.split("{name}").join(""));
function readDraft(v: unknown): Draft | null {
  if (typeof v !== "object" || v === null) return null;
  const x = v as Record<string, unknown>;
  const buttons = x.buttons;
  if (!textOk(x.body, 1100) || (x.header !== null && !textOk(x.header, 80)) || (x.footer !== null && !textOk(x.footer, 80)) || !Array.isArray(buttons) || buttons.length > 3 || !buttons.every((b) => textOk(b, 40))) return null;
  return { header: x.header as string | null, body: x.body, footer: x.footer as string | null, buttons: buttons as string[] };
}
/** A message from outside: both languages, a closed group, only `{name}` as a variable, every part within WhatsApp's own limits of the wire. */
export function readMessage(v: unknown): Message | null {
  if (typeof v !== "object" || v === null) return null;
  const x = v as { category?: unknown; drafts?: unknown };
  const d = x.drafts as Record<string, unknown> | null;
  if ((x.category !== "utility" && x.category !== "marketing") || typeof d !== "object" || d === null) return null;
  const te = readDraft(d.te);
  const en = readDraft(d.en);
  return te && en ? { category: x.category, drafts: { te, en } } : null;
}
export function readSubmit(v: unknown): SubmitInput | null {
  if (typeof v !== "object" || v === null) return null;
  const x = v as { title?: unknown; message?: unknown };
  const t = x.title as { en?: unknown; te?: unknown } | null;
  const message = readMessage(x.message);
  if (!t || typeof t.en !== "string" || t.en.trim() === "" || t.en.length > 60 || (t.te !== null && t.te !== undefined && (typeof t.te !== "string" || t.te.length > 60)) || !message) return null;
  return { title: { en: t.en.trim(), te: typeof t.te === "string" && t.te.trim() !== "" ? t.te.trim() : null }, message };
}
