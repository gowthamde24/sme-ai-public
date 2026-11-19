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
